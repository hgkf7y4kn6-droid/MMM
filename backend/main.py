"""
Mindful Money API
    pip install -r requirements.txt
    uvicorn main:app --reload

Postgres (Neon) via DATABASE_URL, Redis for Celery, a Plaid app, Clerk for
sign-in, Tiingo for market data, Stripe / RevenueCat for Pro. Everything but
the database is optional in development; see .env.example and docs/DEPLOYMENT.md.

Run a worker alongside this for syncs to actually process:
    celery -A tasks worker --loglevel=info

Every /api/ route except health checks and the (signature-verified) webhooks
needs a signed-in user; per-user data is always scoped to the verified user.
"""
import hashlib
import hmac
import os
import logging
import time
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv()

import jwt
import plaid
from fastapi import FastAPI, HTTPException, Depends, Body, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import engine, Base, get_db
from models import PlaidItem, Account, Transaction, InvestmentTransaction, TransferEvent
from crypto import encrypt
from auth import User, current_user, is_admin, require_self, sign_in_required
import api_account
import api_portfolio
import api_stocks
import api_subscriptions
import guard
import plaid_service
import market_data
import dividend_analytics
from providers.base import ProviderUnavailable, SymbolNotFound
from tasks import (
    sync_user_transactions_task,
    sync_accounts_task,
    sync_investment_transactions_task,
    scrape_esg_data_task,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("finance-api")

Base.metadata.create_all(bind=engine)  # creates missing tables; column changes go through migrations/
sign_in_required()                      # refuses to start with REQUIRE_SIGN_IN=0 in production

app = FastAPI(title="Mindful Money API", version="1.1.0")

# CORS — the original snippet paired allow_origins=["*"] with
# allow_credentials=True. Browsers actually reject that combination once
# credentials are involved (and if they didn't, it'd be wide open). Read
# specific allowed origins from the environment instead.
_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins or ["http://localhost:8081"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_middleware(guard.GuardMiddleware)   # outermost: rate limits and body caps (guard.py)
app.include_router(api_stocks.router)
app.include_router(api_portfolio.router)
app.include_router(api_account.router)
app.include_router(api_subscriptions.router)


def _plaid():
    if plaid_service.client is None:
        raise HTTPException(status_code=503, detail="Bank linking isn't configured on this server.")
    return plaid_service.client


class PublicTokenExchangeRequest(BaseModel):
    user_id: str | None = None      # legacy field; the verified caller is used, and a mismatch is refused
    public_token: str


def _caller(claimed: str | None, user: User) -> str:
    if claimed is not None:
        require_self(claimed, user)
    return user.id


# ------------------------------------------------------------------
# Health
# ------------------------------------------------------------------

@app.get("/")
def read_root():
    return {"status": "healthy", "message": "FastAPI FinTech Backend Running"}


@app.get("/api/health/db")
def test_db_connection(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "connected"}
    except Exception as e:
        log.error("database health check failed: %s", e)   # details stay in the log, not the response
        raise HTTPException(status_code=500, detail="Database connection failed.")


# ------------------------------------------------------------------
# 1. Account linking
# ------------------------------------------------------------------

@app.post("/api/plaid/create-link-token")
async def create_link_token(user_id: str | None = None, user: User = Depends(current_user)):
    try:
        request = plaid_service.build_link_token_request(_caller(user_id, user))
        response = await run_in_threadpool(_plaid().link_token_create, request)
        return {"link_token": response["link_token"]}
    except plaid.ApiException as e:
        log.warning("link_token_create failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not create link token.")


@app.post("/api/plaid/exchange-public-token")
async def exchange_public_token(payload: PublicTokenExchangeRequest, db: Session = Depends(get_db),
                                user: User = Depends(current_user)):
    user_id = _caller(payload.user_id, user)
    try:
        req = plaid_service.build_exchange_request(payload.public_token)
        response = await run_in_threadpool(_plaid().item_public_token_exchange, req)

        item = db.query(PlaidItem).filter(PlaidItem.user_id == user_id).first()
        if item is None:
            item = PlaidItem(user_id=user_id)
            db.add(item)
        item.item_id = response["item_id"]
        item.access_token_encrypted = encrypt(response["access_token"])  # never store plaintext
        item.cursor = None
        db.commit()

        # Don't wait for the first webhook to fire — pull an initial snapshot
        # right away so accounts/transactions/dividends show up immediately
        # after the user finishes Plaid Link instead of after the next
        # scheduled sync.
        sync_accounts_task.delay(user_id)
        sync_user_transactions_task.delay(user_id)
        sync_investment_transactions_task.delay(user_id)

        return {"status": "success", "item_id": response["item_id"]}
    except plaid.ApiException as e:
        log.warning("token exchange failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not link account.")


# ------------------------------------------------------------------
# 2. Webhook -- verified (Plaid's signed JWT) and queued onto Celery
# ------------------------------------------------------------------

_PLAID_KEYS: dict[str, tuple[float, object]] = {}
WEBHOOK_MAX_AGE_SECONDS = 300


async def verify_plaid_webhook(plaid_verification: str | None, body: bytes) -> bool:
    """Plaid signs each webhook with an ES256 JWT in the Plaid-Verification
    header: its key comes from /webhook_verification_key/get (by `kid`), it
    must be under 5 minutes old, and its request_body_sha256 claim must match
    the raw body. Anything else is rejected."""
    if not plaid_verification or plaid_service.client is None:
        return False
    try:
        header = jwt.get_unverified_header(plaid_verification)
        if header.get("alg") != "ES256" or not header.get("kid"):
            return False
        kid = header["kid"]
        cached = _PLAID_KEYS.get(kid)
        if not cached or time.time() - cached[0] > 3600:
            resp = await run_in_threadpool(plaid_service.client.webhook_verification_key_get,
                                           plaid_service.build_webhook_key_request(kid))
            key = resp["key"].to_dict() if hasattr(resp["key"], "to_dict") else dict(resp["key"])
            if key.get("expired_at"):
                return False
            cached = (time.time(), jwt.algorithms.ECAlgorithm.from_jwk(key))
            _PLAID_KEYS[kid] = cached
        claims = jwt.decode(plaid_verification, cached[1], algorithms=["ES256"], options={"verify_aud": False})
        if time.time() - claims.get("iat", 0) > WEBHOOK_MAX_AGE_SECONDS:
            return False
        return hmac.compare_digest(hashlib.sha256(body).hexdigest(), claims.get("request_body_sha256", ""))
    except Exception as exc:
        log.warning("plaid webhook verification failed: %s", exc)
        return False


@app.post("/api/plaid/webhook")
async def plaid_webhook(
    request: Request,
    db: Session = Depends(get_db),
    plaid_verification: str = Header(None, alias="Plaid-Verification"),
):
    body = await request.body()
    if not await verify_plaid_webhook(plaid_verification, body):
        raise HTTPException(status_code=401, detail="Unverified webhook.")
    payload = await request.json()
    webhook_type, webhook_code = payload.get("webhook_type"), payload.get("webhook_code")

    item = db.query(PlaidItem).filter(PlaidItem.item_id == payload.get("item_id")).first()
    if not item:
        return {"status": "received"}

    if webhook_type == "TRANSACTIONS" and webhook_code == "SYNC_UPDATES_AVAILABLE":
        sync_user_transactions_task.delay(item.user_id)
    elif webhook_type == "INVESTMENTS_TRANSACTIONS":
        # Plaid fires DEFAULT_UPDATE as new investment transactions (including
        # dividend payouts) post; HISTORICAL_UPDATE once the initial backfill
        # finishes. Both mean "go re-pull and re-filter for dividends."
        sync_investment_transactions_task.delay(item.user_id)
    elif webhook_type == "ITEM" and webhook_code == "PENDING_EXPIRATION":
        log.warning("Plaid item for user %s needs re-auth soon.", item.user_id)

    return {"status": "received"}


# ------------------------------------------------------------------
# 2b. Confirmed data — read what Celery has already synced from Plaid
# ------------------------------------------------------------------

@app.get("/api/accounts/{user_id}")
async def list_accounts(user_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Checking, savings, credit cards, and loans in one list. `credit_limit`
    is only non-null on credit accounts — the frontend uses that to decide
    whether to render a utilization bar."""
    require_self(user_id, user)
    rows = db.query(Account).filter(Account.user_id == user_id).all()
    return [{
        "account_id": a.account_id, "name": a.name, "official_name": a.official_name,
        "mask": a.mask, "type": a.type, "subtype": a.subtype,
        "current_balance": a.current_balance, "available_balance": a.available_balance,
        "credit_limit": a.credit_limit, "iso_currency_code": a.iso_currency_code,
    } for a in rows]


@app.get("/api/transactions/{user_id}")
async def list_transactions(
    user_id: str, account_id: str = None, start_date: str = None, end_date: str = None,
    limit: int = 200, db: Session = Depends(get_db), user: User = Depends(current_user),
):
    require_self(user_id, user)
    q = db.query(Transaction).filter(Transaction.user_id == user_id)
    if account_id:
        q = q.filter(Transaction.account_id == account_id)
    if start_date:
        q = q.filter(Transaction.date >= start_date)
    if end_date:
        q = q.filter(Transaction.date <= end_date)
    rows = q.order_by(Transaction.date.desc()).limit(min(limit, 1000)).all()
    return [{
        "transaction_id": t.transaction_id, "account_id": t.account_id, "date": str(t.date),
        "amount": t.amount, "merchant_name": t.merchant_name,
        "category_primary": t.category_primary, "category_detailed": t.category_detailed,
        "city": t.city, "region": t.region, "pending": t.pending,
    } for t in rows]


@app.get("/api/dividends/confirmed/{user_id}")
async def list_confirmed_dividends(user_id: str, months: int = 24, db: Session = Depends(get_db),
                                   user: User = Depends(current_user)):
    """Actual dividend cash payouts and DRIP reinvestments from Plaid's
    /investments/transactions/get, filtered to is_dividend=True at sync time
    — replaces the projected/estimated income figures with confirmed
    brokerage data wherever a linked investment account covers that period."""
    require_self(user_id, user)
    cutoff = date.today() - timedelta(days=30 * min(max(months, 1), 120))
    rows = (
        db.query(InvestmentTransaction)
        .filter(InvestmentTransaction.user_id == user_id)
        .filter(InvestmentTransaction.is_dividend == True)  # noqa: E712
        .filter(InvestmentTransaction.date >= cutoff)
        .order_by(InvestmentTransaction.date.desc())
        .all()
    )
    return [{
        "ticker": t.ticker, "date": str(t.date), "amount": abs(t.amount),
        "subtype": t.subtype, "account_id": t.account_id,
    } for t in rows]


# ------------------------------------------------------------------
# 3. Market data — Tiingo
# ------------------------------------------------------------------

@app.get("/api/market/ticker/{symbol}")
async def get_market_data(symbol: str, _: User = Depends(current_user)):
    try:
        return await market_data.get_ticker_price(symbol)
    except SymbolNotFound:
        raise HTTPException(status_code=404, detail=f"Unknown ticker {symbol}.")
    except ProviderUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        log.warning("Tiingo fetch failed for %s: %s", symbol, e)
        raise HTTPException(status_code=502, detail="Market data temporarily unavailable.")


@app.get("/api/market/dividend-analytics/{symbol}")
async def get_dividend_analytics(symbol: str, cost_basis: float = None, _: User = Depends(current_user)):
    """Dividend CAGR (1/3/5/10y), current yield, yield on cost, share price
    appreciation CAGR (1/3/5/10y), and appreciation vs. the S&P 500 (SPY).
    Distribution history comes from Tiingo's Corporate Actions endpoint
    (ex-date, payment date, frequency) when available, falling back to the
    EOD endpoint's divCash field otherwise — see dividend_analytics.py.
    `cost_basis` is the per-share cost basis, optional — omit it and
    yield_on_cost_pct comes back null instead of erroring."""
    try:
        return await dividend_analytics.get_dividend_analytics(symbol, cost_basis)
    except SymbolNotFound:
        raise HTTPException(status_code=404, detail=f"Unknown ticker {symbol}.")
    except ProviderUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        log.warning("Dividend analytics failed for %s: %s", symbol, e)
        raise HTTPException(status_code=502, detail="Dividend analytics temporarily unavailable.")


# ------------------------------------------------------------------
# 4. Alt-data scraping — queued on Celery, polled for results
# ------------------------------------------------------------------

def _require_admin(user: User) -> None:
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only.")


@app.post("/api/alt-data/scrape")
async def trigger_scraping_job(target_url: str = Body(..., embed=True), user: User = Depends(current_user)):
    _require_admin(user)         # it makes the server fetch a URL; only allow-listed hosts, only admins
    task = scrape_esg_data_task.delay(target_url)
    return {"status": "queued", "task_id": task.id}


@app.get("/api/alt-data/scrape/{task_id}")
async def get_scrape_result(task_id: str, user: User = Depends(current_user)):
    _require_admin(user)
    result = scrape_esg_data_task.AsyncResult(task_id)
    if not result.ready():
        return {"status": result.status}
    return {"status": "success", "result": result.result}


# ------------------------------------------------------------------
# 5. Transfer — move real money in/out of a linked account (ACH/RTP)
#
# Sequence is fixed by Plaid, not by this code: authorize -> create.
# Skipping straight to create() will fail — authorization_id is required
# and only comes from a successful (or at least completed) authorization
# call, which is Plaid's real-time risk/NSF check on that specific transfer.
#
# plaid_service.client's method names below (transfer_authorization_create,
# transfer_create, transfer_capabilities_get, transfer_migrate_account)
# follow the SDK's snake_case-of-endpoint-path convention seen elsewhere in
# this file (transactions_sync, investments_transactions_get) — verify they
# exist on your installed plaid-python version, same as the request classes
# imported in plaid_service.py.
# ------------------------------------------------------------------

class TransferAuthorizeRequest(BaseModel):
    user_id: str | None = None      # legacy; must match the verified caller
    account_id: str
    type: str              # "credit" (transfer IN to the user) | "debit" (transfer OUT)
    amount: str             # string, e.g. "25.00" — not a float, to avoid cent rounding errors
    legal_name: str
    network: str = "ach"
    ach_class: str = "web"

class TransferCreateBody(BaseModel):
    user_id: str | None = None
    account_id: str
    authorization_id: str
    amount: str
    description: str
    type: str
    network: str = "ach"
    ach_class: str = "web"

class TransferMigrateBody(BaseModel):
    user_id: str | None = None
    account_number: str
    routing_number: str
    account_type: str = "checking"
    legal_name: str


def _get_access_token_for_user(user_id: str, db: Session) -> str:
    from crypto import decrypt
    item = db.query(PlaidItem).filter(PlaidItem.user_id == user_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="No linked Plaid item for this user.")
    return decrypt(item.access_token_encrypted)


def _plain(value) -> str:
    """Plaid's SDK returns enum-like model objects; store their string value."""
    return str(getattr(value, "value", value))


def _owned_account(db: Session, user_id: str, account_id: str) -> None:
    """A transfer may only touch an account synced for this user."""
    if not db.query(Account).filter(Account.account_id == account_id, Account.user_id == user_id).first():
        raise HTTPException(status_code=404, detail="Account not found.")


@app.post("/api/transfer/authorize")
async def authorize_transfer(payload: TransferAuthorizeRequest, db: Session = Depends(get_db),
                             user: User = Depends(current_user)):
    user_id = _caller(payload.user_id, user)
    _owned_account(db, user_id, payload.account_id)
    access_token = _get_access_token_for_user(user_id, db)
    try:
        req = plaid_service.build_transfer_authorization_request(
            access_token, payload.account_id, payload.type, payload.amount,
            payload.legal_name, payload.network, payload.ach_class,
        )
        response = await run_in_threadpool(_plaid().transfer_authorization_create, req)
        auth = response["authorization"]

        db.add(TransferEvent(
            id=auth["id"], kind="authorization", user_id=user_id, account_id=payload.account_id,
            type=payload.type, network=payload.network, amount=payload.amount,
            status=_plain(auth["decision"]), decision_rationale=str(auth.get("decision_rationale")),
        ))
        db.commit()
        return {"authorization_id": auth["id"], "decision": _plain(auth["decision"]),
                "decision_rationale": str(auth.get("decision_rationale")) if auth.get("decision_rationale") else None}
    except plaid.ApiException as e:
        log.warning("transfer authorization failed: %s", e)
        raise HTTPException(status_code=400, detail="Transfer authorization failed.")


@app.post("/api/transfer/create")
async def create_transfer(payload: TransferCreateBody, db: Session = Depends(get_db),
                          user: User = Depends(current_user)):
    user_id = _caller(payload.user_id, user)
    _owned_account(db, user_id, payload.account_id)
    authorization = db.get(TransferEvent, payload.authorization_id)
    if not authorization or authorization.user_id != user_id or authorization.kind != "authorization" \
            or authorization.status != "approved":
        raise HTTPException(status_code=400, detail="That transfer wasn't authorized for this account.")
    access_token = _get_access_token_for_user(user_id, db)
    try:
        req = plaid_service.build_transfer_create_request(
            access_token, payload.account_id, payload.authorization_id, payload.amount,
            payload.description, payload.type, payload.network, payload.ach_class,
        )
        response = await run_in_threadpool(_plaid().transfer_create, req)
        transfer = response["transfer"]

        db.add(TransferEvent(
            id=transfer["id"], kind="transfer", user_id=user_id, account_id=payload.account_id,
            type=payload.type, network=payload.network, amount=payload.amount, status=_plain(transfer["status"]),
        ))
        db.commit()
        return {"transfer_id": transfer["id"], "status": _plain(transfer["status"])}
    except plaid.ApiException as e:
        log.warning("transfer create failed: %s", e)
        raise HTTPException(status_code=400, detail="Transfer could not be created.")


@app.get("/api/transfer/capabilities/{account_id}")
async def get_transfer_capabilities(account_id: str, transfer_type: str = "credit", network: str = "ach",
                                    db: Session = Depends(get_db), user: User = Depends(current_user)):
    _owned_account(db, user.id, account_id)
    try:
        req = plaid_service.build_transfer_capabilities_request(account_id, transfer_type, network)
        response = await run_in_threadpool(_plaid().transfer_capabilities_get, req)
        return response.to_dict() if hasattr(response, "to_dict") else dict(response)
    except plaid.ApiException as e:
        log.warning("transfer capabilities check failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not check transfer capabilities for this account.")


@app.post("/api/transfer/migrate-account")
async def migrate_transfer_account(payload: TransferMigrateBody, db: Session = Depends(get_db),
                                   user: User = Depends(current_user)):
    """Brings a pre-verified account/routing number pair over from another
    processor. Returns a brand-new Plaid access_token — stored exactly like
    one from item_public_token_exchange (encrypted, as a PlaidItem row),
    since it's just as much a live credential to that account."""
    try:
        req = plaid_service.build_transfer_migrate_account_request(
            payload.account_number, payload.routing_number, payload.account_type, payload.legal_name,
        )
        user_id = _caller(payload.user_id, user)
        response = await run_in_threadpool(_plaid().transfer_migrate_account, req)

        item = db.query(PlaidItem).filter(PlaidItem.user_id == user_id).first()
        if item is None:
            item = PlaidItem(user_id=user_id)
            db.add(item)
        item.item_id = response["request_id"]  # migrate_account doesn't return a conventional item_id; request_id anchors this row
        item.access_token_encrypted = encrypt(response["access_token"])
        db.commit()

        return {"status": "success", "account_id": response["account_id"]}
    except plaid.ApiException as e:
        log.warning("transfer account migration failed: %s", e)
        raise HTTPException(status_code=400, detail="Account migration failed.")
