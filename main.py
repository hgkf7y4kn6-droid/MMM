"""
Financial Integration API
    pip install -r requirements.txt
    playwright install chromium --with-deps
    uvicorn main:app --reload

Requires: Postgres (Neon) via DATABASE_URL, Redis for Celery, a Plaid app,
and a Tiingo API key. See .env.example for the full list.

Run a worker alongside this for sync/scraping to actually process:
    celery -A tasks worker --loglevel=info
"""
import os
import logging
from datetime import date, timedelta
from dotenv import load_dotenv

load_dotenv()

import plaid
from fastapi import FastAPI, HTTPException, Depends, Body, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import engine, Base, get_db
from models import PlaidItem, Account, Transaction, InvestmentTransaction, TransferEvent
from crypto import encrypt
import plaid_service
import market_data
import dividend_analytics
from tasks import (
    sync_user_transactions_task,
    sync_accounts_task,
    sync_investment_transactions_task,
    scrape_esg_data_task,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("finance-api")

Base.metadata.create_all(bind=engine)  # fine for dev; use Alembic migrations in production

app = FastAPI(title="Fintech App API", version="1.0.0")

# CORS — the original snippet paired allow_origins=["*"] with
# allow_credentials=True. Browsers actually reject that combination once
# credentials are involved (and if they didn't, it'd be wide open). Read
# specific allowed origins from the environment instead.
_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins or ["http://localhost:8081"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PublicTokenExchangeRequest(BaseModel):
    user_id: str
    public_token: str

class WebhookPayload(BaseModel):
    webhook_type: str
    webhook_code: str
    item_id: str
    new_transactions: int = 0


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
        return {"status": "connected", "database": "Neon Postgres"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database connection failed: {str(e)}")


# ------------------------------------------------------------------
# 1. Account linking
# ------------------------------------------------------------------

@app.post("/api/plaid/create-link-token")
async def create_link_token(user_id: str):
    try:
        request = plaid_service.build_link_token_request(user_id)
        response = await run_in_threadpool(plaid_service.client.link_token_create, request)
        return {"link_token": response["link_token"]}
    except plaid.ApiException as e:
        log.warning("link_token_create failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not create link token.")


@app.post("/api/plaid/exchange-public-token")
async def exchange_public_token(payload: PublicTokenExchangeRequest, db: Session = Depends(get_db)):
    try:
        req = plaid_service.build_exchange_request(payload.public_token)
        response = await run_in_threadpool(plaid_service.client.item_public_token_exchange, req)

        item = db.query(PlaidItem).filter(PlaidItem.user_id == payload.user_id).first()
        if item is None:
            item = PlaidItem(user_id=payload.user_id)
            db.add(item)
        item.item_id = response["item_id"]
        item.access_token_encrypted = encrypt(response["access_token"])  # never store plaintext
        item.cursor = None
        db.commit()

        # Don't wait for the first webhook to fire — pull an initial snapshot
        # right away so accounts/transactions/dividends show up immediately
        # after the user finishes Plaid Link instead of after the next
        # scheduled sync.
        sync_accounts_task.delay(payload.user_id)
        sync_user_transactions_task.delay(payload.user_id)
        sync_investment_transactions_task.delay(payload.user_id)

        return {"status": "success", "item_id": response["item_id"]}
    except plaid.ApiException as e:
        log.warning("token exchange failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not link account.")


# ------------------------------------------------------------------
# 2. Webhook — now verified and queued onto Celery instead of run inline
# ------------------------------------------------------------------

def verify_plaid_webhook(plaid_verification_header: str) -> bool:
    """Stub — the original endpoint acted on any POST claiming to be Plaid.
    Wire in Plaid's JWT verification (docs: Plaid-Verification header +
    /webhook_verification_key/get) before trusting a payload."""
    return bool(plaid_verification_header)


@app.post("/api/plaid/webhook")
async def plaid_webhook(
    payload: WebhookPayload,
    db: Session = Depends(get_db),
    plaid_verification: str = Header(None, alias="Plaid-Verification"),
):
    if not verify_plaid_webhook(plaid_verification or ""):
        raise HTTPException(status_code=401, detail="Unverified webhook.")

    item = db.query(PlaidItem).filter(PlaidItem.item_id == payload.item_id).first()
    if not item:
        return {"status": "received"}

    if payload.webhook_type == "TRANSACTIONS" and payload.webhook_code == "SYNC_UPDATES_AVAILABLE":
        sync_user_transactions_task.delay(item.user_id)
    elif payload.webhook_type == "INVESTMENTS_TRANSACTIONS":
        # Plaid fires DEFAULT_UPDATE as new investment transactions (including
        # dividend payouts) post; HISTORICAL_UPDATE once the initial backfill
        # finishes. Both mean "go re-pull and re-filter for dividends."
        sync_investment_transactions_task.delay(item.user_id)
    elif payload.webhook_type == "ITEM" and payload.webhook_code == "PENDING_EXPIRATION":
        log.warning("Plaid item for user %s needs re-auth soon.", item.user_id)

    return {"status": "received"}


# ------------------------------------------------------------------
# 2b. Confirmed data — read what Celery has already synced from Plaid
# ------------------------------------------------------------------

@app.get("/api/accounts/{user_id}")
async def list_accounts(user_id: str, db: Session = Depends(get_db)):
    """Checking, savings, credit cards, and loans in one list. `credit_limit`
    is only non-null on credit accounts — the frontend uses that to decide
    whether to render a utilization bar."""
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
    limit: int = 200, db: Session = Depends(get_db),
):
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
async def list_confirmed_dividends(user_id: str, months: int = 24, db: Session = Depends(get_db)):
    """Actual dividend cash payouts and DRIP reinvestments from Plaid's
    /investments/transactions/get, filtered to is_dividend=True at sync time
    — replaces the projected/estimated income figures with confirmed
    brokerage data wherever a linked investment account covers that period."""
    cutoff = date.today() - timedelta(days=30 * months)
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
async def get_market_data(symbol: str):
    try:
        return await market_data.get_ticker_price(symbol)
    except Exception as e:
        log.warning("Tiingo fetch failed for %s: %s", symbol, e)
        raise HTTPException(status_code=502, detail="Market data temporarily unavailable.")


@app.get("/api/market/dividend-analytics/{symbol}")
async def get_dividend_analytics(symbol: str, cost_basis: float = None):
    """Dividend CAGR (1/3/5/10y), current yield, yield on cost, share price
    appreciation CAGR (1/3/5/10y), and appreciation vs. the S&P 500 (SPY).
    Distribution history comes from Tiingo's Corporate Actions endpoint
    (ex-date, payment date, frequency) when available, falling back to the
    EOD endpoint's divCash field otherwise — see dividend_analytics.py.
    `cost_basis` is the per-share cost basis, optional — omit it and
    yield_on_cost_pct comes back null instead of erroring."""
    try:
        return await dividend_analytics.get_dividend_analytics(symbol, cost_basis)
    except Exception as e:
        log.warning("Dividend analytics failed for %s: %s", symbol, e)
        raise HTTPException(status_code=502, detail="Dividend analytics temporarily unavailable.")


# ------------------------------------------------------------------
# 4. Alt-data scraping — queued on Celery, polled for results
# ------------------------------------------------------------------

@app.post("/api/alt-data/scrape")
async def trigger_scraping_job(target_url: str = Body(..., embed=True)):
    task = scrape_esg_data_task.delay(target_url)
    return {"status": "queued", "task_id": task.id}


@app.get("/api/alt-data/scrape/{task_id}")
async def get_scrape_result(task_id: str):
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
    user_id: str
    account_id: str
    type: str              # "credit" (transfer IN to the user) | "debit" (transfer OUT)
    amount: str             # string, e.g. "25.00" — not a float, to avoid cent rounding errors
    legal_name: str
    network: str = "ach"
    ach_class: str = "web"

class TransferCreateBody(BaseModel):
    user_id: str
    account_id: str
    authorization_id: str
    amount: str
    description: str
    type: str
    network: str = "ach"
    ach_class: str = "web"

class TransferMigrateBody(BaseModel):
    user_id: str
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


@app.post("/api/transfer/authorize")
async def authorize_transfer(payload: TransferAuthorizeRequest, db: Session = Depends(get_db)):
    access_token = _get_access_token_for_user(payload.user_id, db)
    try:
        req = plaid_service.build_transfer_authorization_request(
            access_token, payload.account_id, payload.type, payload.amount,
            payload.legal_name, payload.network, payload.ach_class,
        )
        response = await run_in_threadpool(plaid_service.client.transfer_authorization_create, req)
        auth = response["authorization"]

        db.add(TransferEvent(
            id=auth["id"], kind="authorization", user_id=payload.user_id, account_id=payload.account_id,
            type=payload.type, network=payload.network, amount=payload.amount,
            status=auth["decision"], decision_rationale=str(auth.get("decision_rationale")),
        ))
        db.commit()
        return {"authorization_id": auth["id"], "decision": auth["decision"], "decision_rationale": auth.get("decision_rationale")}
    except plaid.ApiException as e:
        log.warning("transfer authorization failed: %s", e)
        raise HTTPException(status_code=400, detail="Transfer authorization failed.")


@app.post("/api/transfer/create")
async def create_transfer(payload: TransferCreateBody, db: Session = Depends(get_db)):
    access_token = _get_access_token_for_user(payload.user_id, db)
    try:
        req = plaid_service.build_transfer_create_request(
            access_token, payload.account_id, payload.authorization_id, payload.amount,
            payload.description, payload.type, payload.network, payload.ach_class,
        )
        response = await run_in_threadpool(plaid_service.client.transfer_create, req)
        transfer = response["transfer"]

        db.add(TransferEvent(
            id=transfer["id"], kind="transfer", user_id=payload.user_id, account_id=payload.account_id,
            type=payload.type, network=payload.network, amount=payload.amount, status=transfer["status"],
        ))
        db.commit()
        return {"transfer_id": transfer["id"], "status": transfer["status"]}
    except plaid.ApiException as e:
        log.warning("transfer create failed: %s", e)
        raise HTTPException(status_code=400, detail="Transfer could not be created.")


@app.get("/api/transfer/capabilities/{account_id}")
async def get_transfer_capabilities(account_id: str, transfer_type: str = "credit", network: str = "ach"):
    try:
        req = plaid_service.build_transfer_capabilities_request(account_id, transfer_type, network)
        response = await run_in_threadpool(plaid_service.client.transfer_capabilities_get, req)
        return response.to_dict() if hasattr(response, "to_dict") else dict(response)
    except plaid.ApiException as e:
        log.warning("transfer capabilities check failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not check transfer capabilities for this account.")


@app.post("/api/transfer/migrate-account")
async def migrate_transfer_account(payload: TransferMigrateBody, db: Session = Depends(get_db)):
    """Brings a pre-verified account/routing number pair over from another
    processor. Returns a brand-new Plaid access_token — stored exactly like
    one from item_public_token_exchange (encrypted, as a PlaidItem row),
    since it's just as much a live credential to that account."""
    try:
        req = plaid_service.build_transfer_migrate_account_request(
            payload.account_number, payload.routing_number, payload.account_type, payload.legal_name,
        )
        response = await run_in_threadpool(plaid_service.client.transfer_migrate_account, req)

        item = db.query(PlaidItem).filter(PlaidItem.user_id == payload.user_id).first()
        if item is None:
            item = PlaidItem(user_id=payload.user_id)
            db.add(item)
        item.item_id = response["request_id"]  # migrate_account doesn't return a conventional item_id; request_id anchors this row
        item.access_token_encrypted = encrypt(response["access_token"])
        db.commit()

        return {"status": "success", "account_id": response["account_id"]}
    except plaid.ApiException as e:
        log.warning("transfer account migration failed: %s", e)
        raise HTTPException(status_code=400, detail="Account migration failed.")
