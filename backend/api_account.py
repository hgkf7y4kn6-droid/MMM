"""The caller's account: plan, data export and deletion, and billing.

Export and deletion are available on every plan -- a user's own data is
theirs regardless of subscription status.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import billing
from auth import User, current_user
from database import get_db
from entitlements import FREE_FEATURES, PRO_FEATURES, resolve
from models import Account, BillingEvent, InvestmentTransaction, PlaidItem, Subscription, Transaction, TransferEvent

log = logging.getLogger("account")
router = APIRouter(prefix="/api", tags=["account"])


def _row(obj) -> dict:
    out = {}
    for col in obj.__table__.columns:
        if col.name == "access_token_encrypted":
            continue                       # a credential, not the user's data
        v = getattr(obj, col.name)
        out[col.name] = v.isoformat() if hasattr(v, "isoformat") else v
    return out


@router.get("/me")
async def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ent = resolve(user, db)
    return {"user_id": user.id, "entitlement": ent.to_dict(),
            "pricing": {"display": os.environ.get("PRO_PRICE_DISPLAY") or None,
                        "web_checkout": bool(os.environ.get("STRIPE_SECRET_KEY") and os.environ.get("STRIPE_PRICE_ID")),
                        "in_app_purchase": bool(os.environ.get("REVENUECAT_WEBHOOK_AUTH"))},
            "features": {"free": FREE_FEATURES, "pro": PRO_FEATURES}}


@router.get("/me/export")
async def export(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everything stored for the caller, as JSON (Settings > Export my data)."""
    def rows(model):
        return [_row(r) for r in db.query(model).filter(model.user_id == user.id).all()]
    item = db.get(PlaidItem, user.id)
    sub = db.get(Subscription, user.id)
    return {"exported_at": datetime.now(timezone.utc).isoformat(), "user_id": user.id,
            "linked_institution": _row(item) if item else None, "accounts": rows(Account),
            "transactions": rows(Transaction), "investment_transactions": rows(InvestmentTransaction),
            "transfers": rows(TransferEvent), "subscription": _row(sub) if sub else None}


@router.delete("/me")
async def delete_account(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Deletes the caller's stored financial data and linked-account credential.
    The billing record is kept only as long as an active paid subscription
    needs it to be honored (cancel first to remove it); events are anonymized."""
    counts = {}
    for model in (Transaction, InvestmentTransaction, Account, TransferEvent, PlaidItem):
        counts[model.__tablename__] = db.query(model).filter(model.user_id == user.id).delete()
    sub = db.get(Subscription, user.id)
    kept_subscription = bool(sub and resolve(user, db).status in ("active", "trialing", "grace"))
    if sub and not kept_subscription:
        db.delete(sub)
    db.query(BillingEvent).filter(BillingEvent.user_id == user.id).update({"user_id": None})
    db.commit()
    return {"deleted": counts, "subscription_kept": kept_subscription,
            "note": "Cancel your subscription in Manage billing to remove it too." if kept_subscription else None}


# ----------------------------------------------------------------- billing
class CheckoutIn(BaseModel):
    success_url: str
    cancel_url: str


def _allowed_return(url: str) -> bool:
    allowed = [u.strip() for u in os.environ.get("BILLING_RETURN_URLS", "mmmapp://").split(",") if u.strip()]
    return any(url.startswith(prefix) for prefix in allowed)


@router.post("/billing/checkout")
async def checkout(body: CheckoutIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not (_allowed_return(body.success_url) and _allowed_return(body.cancel_url)):
        raise HTTPException(status_code=400, detail="Return URL not allowed.")
    if resolve(user, db).status in ("active", "trialing"):
        raise HTTPException(status_code=409, detail="You already have Pro. Use Manage billing to change your plan.")
    sub = db.get(Subscription, user.id)
    try:
        url = billing.stripe_checkout_url(user.id, sub.customer_id if sub else None, body.success_url, body.cancel_url)
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        log.warning("checkout failed: %s", exc)
        raise HTTPException(status_code=502, detail="Checkout is temporarily unavailable.") from exc
    return {"url": url}


@router.post("/billing/portal")
async def portal(body: CheckoutIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub = db.get(Subscription, user.id)
    if not sub or sub.provider != "stripe" or not sub.customer_id:
        raise HTTPException(status_code=404, detail="No web subscription to manage. App Store and Google Play "
                                                    "subscriptions are managed in the store's settings.")
    if not _allowed_return(body.success_url):
        raise HTTPException(status_code=400, detail="Return URL not allowed.")
    try:
        return {"url": billing.stripe_portal_url(sub.customer_id, body.success_url)}
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Billing portal is temporarily unavailable.") from exc


@router.post("/billing/sync")
async def sync(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Restore access: re-reads a web subscription straight from Stripe, for a
    webhook that never arrived. (Store purchases restore through the app's
    store SDK, which triggers RevenueCat's webhook.)"""
    sub = db.get(Subscription, user.id)
    secret = os.environ.get("STRIPE_SECRET_KEY")
    if sub and sub.provider == "stripe" and sub.customer_id and secret:
        try:
            resp = httpx.get(f"{billing.STRIPE_API}/subscriptions", params={"customer": sub.customer_id, "status": "all",
                                                                           "limit": 1}, auth=(secret, ""), timeout=20)
            resp.raise_for_status()
            latest = (resp.json().get("data") or [None])[0]
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Couldn't reach billing. Try again shortly.") from exc
        if latest:
            event = {"id": f"sync-{latest['id']}-{int(time.time())}", "type": "customer.subscription.updated",
                     "created": int(time.time()), "data": {"object": {**latest, "metadata": {"user_id": user.id}}}}
            billing.apply(db, billing.parse_stripe(event))
    return resolve(user, db).to_dict()


@router.post("/billing/webhook/stripe", include_in_schema=False)
async def stripe_webhook(request: Request, db: Session = Depends(get_db),
                         stripe_signature: str | None = Header(None, alias="Stripe-Signature")):
    payload = await request.body()
    try:
        event = billing.verify_stripe(payload, stripe_signature, os.environ.get("STRIPE_WEBHOOK_SECRET"))
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except billing.WebhookRejected as exc:
        log.warning("stripe webhook rejected: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid signature.") from exc
    return {"outcome": billing.apply(db, billing.parse_stripe(event))}


@router.post("/billing/webhook/revenuecat", include_in_schema=False)
async def revenuecat_webhook(request: Request, db: Session = Depends(get_db),
                             authorization: str | None = Header(None)):
    try:
        billing.verify_revenuecat(authorization, os.environ.get("REVENUECAT_WEBHOOK_AUTH"))
    except billing.BillingNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except billing.WebhookRejected as exc:
        raise HTTPException(status_code=401, detail="Unauthorized.") from exc
    body = await request.json()
    if (body.get("event") or {}).get("type") == "TEST":
        return {"outcome": "ignored"}
    return {"outcome": billing.apply(db, billing.parse_revenuecat(body))}
