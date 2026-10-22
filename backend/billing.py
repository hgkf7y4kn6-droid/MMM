"""Billing provider adapters and idempotent webhook processing.

Product code never talks to a payment provider: providers turn their
webhooks into a normalized BillingUpdate, and `apply()` writes it to the
Subscription row that entitlements.py reads. Adding a provider means adding
an adapter here, nothing else.

Adapters
    stripe       web checkout. Signature: Stripe-Signature HMAC-SHA256 over
                 "{t}.{body}" with STRIPE_WEBHOOK_SECRET, 5-minute tolerance.
                 Checkout and portal sessions via the REST API (STRIPE_SECRET_KEY,
                 STRIPE_PRICE_ID). The user id rides in client_reference_id and
                 subscription metadata, set by this server at checkout -- never
                 taken from the client's request body.
    revenuecat   App Store / Google Play in-app purchases (required by store
                 rules for digital subscriptions bought inside the app). Webhook
                 auth: the Authorization header must equal REVENUECAT_WEBHOOK_AUTH.
                 app_user_id must be the Clerk user id (Purchases.logIn(userId)).

Integrity
    - Unverified webhooks are rejected before parsing.
    - Each provider event id is recorded once (billing_events); a redelivery
      is acknowledged without being applied again.
    - An event older than the last one applied for that user is recorded as
      "stale" and ignored, so out-of-order delivery can't roll back state.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import BillingEvent, Subscription

log = logging.getLogger("billing")
STRIPE_API = "https://api.stripe.com/v1"
SIGNATURE_TOLERANCE_SECONDS = 300


class WebhookRejected(Exception):
    pass


class BillingNotConfigured(Exception):
    pass


@dataclass(frozen=True)
class BillingUpdate:
    provider: str
    event_id: str
    event_type: str
    occurred_at: datetime
    user_id: str | None
    status: str | None = None                 # our status vocabulary; None = no state change
    current_period_end: datetime | None = None
    grace_until: datetime | None = None
    cancel_at_period_end: bool | None = None
    customer_id: str | None = None
    subscription_id: str | None = None


def _ts(seconds: float | None) -> datetime | None:
    return datetime.fromtimestamp(seconds, tz=timezone.utc) if seconds else None


# ------------------------------------------------------------------ Stripe
STRIPE_STATUS = {"active": "active", "trialing": "trialing", "past_due": "past_due", "canceled": "canceled",
                 "unpaid": "expired", "incomplete": "incomplete", "incomplete_expired": "expired", "paused": "paused"}


def verify_stripe(payload: bytes, header: str | None, secret: str | None, now: float | None = None) -> dict:
    if not secret:
        raise BillingNotConfigured("STRIPE_WEBHOOK_SECRET isn't set.")
    if not header:
        raise WebhookRejected("missing Stripe-Signature")
    parts = [p.split("=", 1) for p in header.split(",") if "=" in p]
    t = next((v for k, v in parts if k == "t"), None)
    sigs = [v for k, v in parts if k == "v1"]
    if not t or not sigs:
        raise WebhookRejected("malformed Stripe-Signature")
    try:
        t_int = int(t)
    except ValueError as exc:
        raise WebhookRejected("malformed timestamp") from exc
    if abs((now or time.time()) - t_int) > SIGNATURE_TOLERANCE_SECONDS:
        raise WebhookRejected("timestamp outside tolerance")
    expected = hmac.new(secret.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, s) for s in sigs):
        raise WebhookRejected("signature mismatch")
    return json.loads(payload)


def parse_stripe(event: dict) -> BillingUpdate:
    obj = (event.get("data") or {}).get("object") or {}
    etype = event.get("type", "")
    base = dict(provider="stripe", event_id=event["id"], event_type=etype, occurred_at=_ts(event.get("created")) or
                datetime.now(timezone.utc))
    if etype == "checkout.session.completed":
        return BillingUpdate(**base, user_id=obj.get("client_reference_id"), customer_id=obj.get("customer"),
                             subscription_id=obj.get("subscription"))
    if etype.startswith("customer.subscription."):
        items = ((obj.get("items") or {}).get("data") or [{}])
        period_end = obj.get("current_period_end") or items[0].get("current_period_end")  # moved to items in 2025 API versions
        status = STRIPE_STATUS.get(obj.get("status", ""), "expired")
        if etype == "customer.subscription.deleted":
            status = "canceled"
        return BillingUpdate(**base, user_id=(obj.get("metadata") or {}).get("user_id"), status=status,
                             current_period_end=_ts(period_end), cancel_at_period_end=bool(obj.get("cancel_at_period_end")),
                             customer_id=obj.get("customer"), subscription_id=obj.get("id"))
    return BillingUpdate(**base, user_id=None)


def stripe_checkout_url(user_id: str, customer_id: str | None, success_url: str, cancel_url: str) -> str:
    secret, price = os.environ.get("STRIPE_SECRET_KEY"), os.environ.get("STRIPE_PRICE_ID")
    if not secret or not price:
        raise BillingNotConfigured("Checkout isn't configured (STRIPE_SECRET_KEY, STRIPE_PRICE_ID).")
    form = {"mode": "subscription", "line_items[0][price]": price, "line_items[0][quantity]": "1",
            "success_url": success_url, "cancel_url": cancel_url, "client_reference_id": user_id,
            "subscription_data[metadata][user_id]": user_id, "allow_promotion_codes": "true"}
    if customer_id:
        form["customer"] = customer_id
    resp = httpx.post(f"{STRIPE_API}/checkout/sessions", data=form, auth=(secret, ""), timeout=20,
                      headers={"Idempotency-Key": f"checkout-{user_id}-{int(time.time() // 60)}"})
    resp.raise_for_status()
    return resp.json()["url"]


def stripe_portal_url(customer_id: str, return_url: str) -> str:
    secret = os.environ.get("STRIPE_SECRET_KEY")
    if not secret:
        raise BillingNotConfigured("Billing portal isn't configured (STRIPE_SECRET_KEY).")
    resp = httpx.post(f"{STRIPE_API}/billing_portal/sessions", data={"customer": customer_id, "return_url": return_url},
                      auth=(secret, ""), timeout=20)
    resp.raise_for_status()
    return resp.json()["url"]


# -------------------------------------------------------------- RevenueCat
REVENUECAT_STATUS = {"INITIAL_PURCHASE": "active", "RENEWAL": "active", "UNCANCELLATION": "active",
                     "PRODUCT_CHANGE": "active", "CANCELLATION": "canceled", "EXPIRATION": "expired",
                     "BILLING_ISSUE": "past_due", "SUBSCRIPTION_PAUSED": "paused"}


def verify_revenuecat(authorization: str | None, secret: str | None) -> None:
    if not secret:
        raise BillingNotConfigured("REVENUECAT_WEBHOOK_AUTH isn't set.")
    if not authorization or not hmac.compare_digest(authorization.encode(), secret.encode()):
        raise WebhookRejected("bad Authorization")


def parse_revenuecat(body: dict) -> BillingUpdate:
    ev = body.get("event") or {}
    etype = ev.get("type", "")
    status = REVENUECAT_STATUS.get(etype)
    if ev.get("period_type") == "TRIAL" and status == "active":
        status = "trialing"
    expires = _ts((ev.get("expiration_at_ms") or 0) / 1000)
    grace = _ts((ev.get("grace_period_expiration_at_ms") or 0) / 1000)
    if etype == "CANCELLATION":
        # Store cancellations keep access until expiration (unlike Stripe's deleted).
        return BillingUpdate(provider="revenuecat", event_id=ev["id"], event_type=etype,
                             occurred_at=_ts((ev.get("event_timestamp_ms") or 0) / 1000) or datetime.now(timezone.utc),
                             user_id=ev.get("app_user_id"), status="canceled", current_period_end=expires,
                             cancel_at_period_end=True)
    return BillingUpdate(provider="revenuecat", event_id=ev["id"], event_type=etype,
                         occurred_at=_ts((ev.get("event_timestamp_ms") or 0) / 1000) or datetime.now(timezone.utc),
                         user_id=ev.get("app_user_id"), status=status, current_period_end=expires, grace_until=grace,
                         cancel_at_period_end=False if status == "active" else None)


# ------------------------------------------------------------------- apply
def _aware(dt: datetime | None) -> datetime | None:
    return None if dt is None else dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def apply(db: Session, u: BillingUpdate) -> str:
    """Record and (if new, attributable and not stale) apply one event.
    Returns the outcome: applied | duplicate | ignored | stale."""
    existing = db.get(BillingEvent, u.event_id)
    if existing is not None:
        existing.attempts = (existing.attempts or 1) + 1
        db.commit()
        return "duplicate"
    sub = None
    user_id = u.user_id
    if user_id is None and (u.subscription_id or u.customer_id):
        q = db.query(Subscription)
        sub = (q.filter(Subscription.subscription_id == u.subscription_id).first() if u.subscription_id else None) or \
              (q.filter(Subscription.customer_id == u.customer_id).first() if u.customer_id else None)
        user_id = sub.user_id if sub else None
    outcome = "ignored"
    if user_id:
        sub = sub or db.get(Subscription, user_id)
        last = _aware(sub.last_event_at) if sub else None
        if last and u.occurred_at < last:
            outcome = "stale"
        elif u.status is not None or u.customer_id or u.subscription_id:
            if sub is None:
                sub = Subscription(user_id=user_id, provider=u.provider, status=u.status or "incomplete", plan="pro")
                db.add(sub)
            sub.provider = u.provider
            if u.status is not None:
                sub.status = u.status
            if u.current_period_end is not None:
                sub.current_period_end = u.current_period_end
            if u.grace_until is not None or u.status == "past_due":
                sub.grace_until = u.grace_until
            if u.cancel_at_period_end is not None:
                sub.cancel_at_period_end = u.cancel_at_period_end
            sub.customer_id = u.customer_id or sub.customer_id
            sub.subscription_id = u.subscription_id or sub.subscription_id
            sub.last_event_at = u.occurred_at
            outcome = "applied"
    db.add(BillingEvent(event_id=u.event_id, provider=u.provider, type=u.event_type, user_id=user_id, outcome=outcome))
    try:
        db.commit()
    except IntegrityError:          # the same event raced in on another worker
        db.rollback()
        return "duplicate"
    log.info("billing %s %s user=%s -> %s", u.provider, u.event_type, user_id, outcome)
    return outcome
