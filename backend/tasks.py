"""Background jobs (Celery): Plaid syncs and alt-data fetches.

    celery -A tasks worker --loglevel=info

REDIS_URL      broker and result backend
CELERY_EAGER=1 run tasks inline in the API process (local development, no Redis)

Every sync is an upsert keyed by Plaid's own ids, so re-running a job (a
retried webhook, a manual re-sync) never duplicates a row.
"""
from __future__ import annotations

import logging
import os
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from celery import Celery

from crypto import decrypt
from database import SessionLocal
from models import Account, Holding, InvestmentTransaction, PlaidItem, Transaction

log = logging.getLogger("tasks")

celery_app = Celery("kaventafi", broker=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
                    backend=os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
celery_app.conf.update(task_always_eager=os.environ.get("CELERY_EAGER") == "1", task_acks_late=True,
                       task_reject_on_worker_lost=True, result_expires=3600)

celery_app.conf.beat_schedule = {
    # Fallback for missed webhooks. Runs only where a beat scheduler is started:
    #   celery -A tasks worker -B --loglevel=info     (-B embeds it in the worker)
    "resync-linked-accounts": {"task": "tasks.sync_all_items_task", "schedule": 6 * 3600},
}

INVESTMENT_HISTORY_DAYS = 730
STALE_AFTER = timedelta(hours=12)           # a linked account not synced this long is refreshed on next use
ATTEMPT_COOLDOWN = timedelta(minutes=30)    # ...but not retried more often than this
RETRY = {"autoretry_for": (Exception,), "retry_backoff": True, "retry_backoff_max": 600, "max_retries": 5}


def _item(db, user_id: str) -> PlaidItem | None:
    return db.query(PlaidItem).filter(PlaidItem.user_id == user_id).first()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)   # SQLite drops tzinfo


@contextmanager
def _plaid_errors(db, item: PlaidItem):
    """Plaid errors that only the user can fix (expired login, revoked access)
    are recorded on the item -- the app then asks them to reconnect -- and end
    the task without a retry. Anything else propagates so Celery retries it."""
    import plaid
    import plaid_service

    try:
        yield
    except plaid.ApiException as exc:
        code = plaid_service.plaid_error_code(exc)
        status = plaid_service.ITEM_NEEDS_USER.get(code)
        db.rollback()
        if status is None:
            raise
        item.status, item.last_error = status, code
        db.commit()
        log.warning("plaid item %s needs the user: %s", item.item_id, code)


def enqueue(task, *args) -> str:
    """Run a sync task on the worker when there is one (REDIS_URL set or eager
    mode), else in a background thread of this process, so syncing still works
    on a deployment with no worker. Either way the task is an idempotent upsert."""
    if os.environ.get("REDIS_URL") or celery_app.conf.task_always_eager:
        try:
            task.delay(*args)
            return "queued"
        except Exception as exc:                       # broker unreachable
            log.warning("couldn't queue %s (%s); running it in-process", task.name, exc)

    def run():
        try:
            task.apply(args=args, throw=True)
        except Exception:
            log.exception("in-process %s failed", task.name)

    threading.Thread(target=run, daemon=True).start()
    return "inline"


def resync_if_stale(db, item: PlaidItem, now: datetime | None = None) -> bool:
    """Refresh a linked account whose data is old, when nothing else has (a missed
    webhook, no scheduler). Throttled by ATTEMPT_COOLDOWN; skipped when the user
    has to reconnect first."""
    now = now or _now()
    if item.status != "active":
        return False
    synced, tried = _aware(item.last_synced_at), _aware(item.last_attempt_at)
    if synced is not None and now - synced < STALE_AFTER:
        return False
    if tried is not None and now - tried < ATTEMPT_COOLDOWN:
        return False
    item.last_attempt_at = now
    db.commit()
    for task in (sync_accounts_task, sync_user_transactions_task, sync_investment_transactions_task):
        enqueue(task, item.user_id)
    return True


@celery_app.task(**RETRY)
def sync_accounts_task(user_id: str) -> int:
    import plaid_service

    db = SessionLocal()
    try:
        item = _item(db, user_id)
        if not item:
            return 0
        with _plaid_errors(db, item):
            resp = plaid_service.client.accounts_get(plaid_service.build_accounts_request(decrypt(item.access_token_encrypted)))
            for a in resp["accounts"]:
                row = db.get(Account, a["account_id"]) or Account(account_id=a["account_id"])
                b = a["balances"]
                row.user_id, row.item_id = user_id, item.item_id
                row.name, row.official_name, row.mask = a.get("name"), a.get("official_name"), a.get("mask")
                row.type, row.subtype = str(a.get("type") or ""), str(a.get("subtype") or "") or None
                row.current_balance, row.available_balance = b.get("current"), b.get("available")
                row.credit_limit, row.iso_currency_code = b.get("limit"), b.get("iso_currency_code")
                db.merge(row)
            db.commit()
            return len(resp["accounts"])
        return 0
    finally:
        db.close()


@celery_app.task(**RETRY)
def sync_user_transactions_task(user_id: str) -> int:
    """/transactions/sync from the stored cursor until has_more is false. If
    Plaid reports the data changed mid-pagination, restart from the cursor the
    run began with (Plaid's documented recovery)."""
    import plaid
    import plaid_service

    db = SessionLocal()
    try:
        item = _item(db, user_id)
        if not item:
            return 0
        with _plaid_errors(db, item):
            token = decrypt(item.access_token_encrypted)
            start_cursor = item.cursor
            for _attempt in range(3):
                cursor, changed = start_cursor, 0
                try:
                    while True:
                        resp = plaid_service.client.transactions_sync(plaid_service.build_sync_request(token, cursor))
                        for t in list(resp["added"]) + list(resp["modified"]):
                            pfc = t.get("personal_finance_category") or {}
                            loc = t.get("location") or {}
                            db.merge(Transaction(
                                transaction_id=t["transaction_id"], account_id=t["account_id"], user_id=user_id,
                                date=t["date"], amount=t["amount"], merchant_name=t.get("merchant_name") or t.get("name"),
                                category_primary=pfc.get("primary"), category_detailed=pfc.get("detailed"),
                                city=loc.get("city"), region=loc.get("region"), pending=bool(t.get("pending"))))
                            changed += 1
                        for r in resp["removed"]:
                            db.query(Transaction).filter(Transaction.transaction_id == r["transaction_id"],
                                                         Transaction.user_id == user_id).delete()
                            changed += 1
                        cursor = resp["next_cursor"]
                        if not resp["has_more"]:
                            break
                except plaid.ApiException as exc:
                    if "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" in str(exc):
                        db.rollback()
                        continue
                    raise
                item.cursor = cursor
                db.commit()
                return changed
            raise RuntimeError("transactions kept changing during sync; will retry")
        return 0
    finally:
        db.close()


def _replace_holdings(db, user_id: str, resp) -> int:
    """Swap the user's stored holdings for Plaid's current ones (same commit as the
    transactions, so the two always describe the same moment). Securities without a
    ticker (cash, some funds) can't be priced and are skipped."""
    securities = {s["security_id"]: s for s in resp["securities"]}
    db.query(Holding).filter(Holding.user_id == user_id).delete()
    n = 0
    for h in resp["holdings"]:
        sec = securities.get(h["security_id"]) or {}
        ticker = sec.get("ticker_symbol")
        if not ticker or sec.get("is_cash_equivalent"):
            continue
        db.add(Holding(user_id=user_id, account_id=h["account_id"], security_id=h["security_id"],
                       ticker=ticker.upper(), quantity=float(h["quantity"])))
        n += 1
    return n


@celery_app.task(**RETRY)
def sync_investment_transactions_task(user_id: str) -> int:
    """/investments/transactions/get for the last 24 months, paged by offset.
    Stores quantity, price and fees so portfolio returns can be rebuilt. A
    completed run stamps `last_synced_at`; the whole page set commits at once, so
    a failure part-way leaves the previous data untouched."""
    import plaid_service
    from plaid_service import DIVIDEND_SUBTYPES

    db = SessionLocal()
    try:
        item = _item(db, user_id)
        if not item:
            return 0
        with _plaid_errors(db, item):
            token = decrypt(item.access_token_encrypted)
            end, start = date.today(), date.today() - timedelta(days=INVESTMENT_HISTORY_DAYS)
            offset, total, stored = 0, None, 0
            while total is None or offset < total:
                resp = plaid_service.client.investments_transactions_get(
                    plaid_service.build_investment_txn_request(token, start, end, offset=offset))
                securities = {s["security_id"]: s for s in resp["securities"]}
                txns = resp["investment_transactions"]
                for t in txns:
                    sec = securities.get(t.get("security_id")) or {}
                    subtype = str(t.get("subtype") or "")
                    db.merge(InvestmentTransaction(
                        investment_transaction_id=t["investment_transaction_id"], account_id=t["account_id"],
                        user_id=user_id, security_id=t.get("security_id"), ticker=sec.get("ticker_symbol"),
                        date=t["date"], amount=t["amount"], type=str(t.get("type") or ""), subtype=subtype,
                        is_dividend=subtype in DIVIDEND_SUBTYPES, quantity=t.get("quantity"), price=t.get("price"),
                        fees=t.get("fees")))
                    stored += 1
                total = resp["total_investment_transactions"]
                offset += len(txns)
                if not txns:
                    break
            _replace_holdings(db, user_id, plaid_service.client.investments_holdings_get(
                plaid_service.build_holdings_request(token)))
            item.status, item.last_synced_at = "active", _now()
            if item.last_error != "PENDING_EXPIRATION":      # that warning lasts until the user reconnects
                item.last_error = None
            db.commit()
            return stored
        return 0
    finally:
        db.close()


@celery_app.task
def sync_all_items_task() -> int:
    """Scheduled fallback: queue a refresh for every linked account that is
    healthy and hasn't synced recently (webhooks normally keep them current)."""
    db = SessionLocal()
    try:
        n = 0
        for item in db.query(PlaidItem).filter(PlaidItem.status == "active").all():
            n += resync_if_stale(db, item)
        return n
    finally:
        db.close()


def _allowed_host(url: str) -> bool:
    allowed = {h.strip().lower() for h in os.environ.get("ALT_DATA_ALLOWED_HOSTS", "").split(",") if h.strip()}
    parsed = urlparse(url)
    return parsed.scheme == "https" and (parsed.hostname or "").lower() in allowed


@celery_app.task(**{**RETRY, "max_retries": 2})
def scrape_esg_data_task(target_url: str) -> dict:
    """Fetches one page from an allow-listed host (ALT_DATA_ALLOWED_HOSTS) and
    returns its title and text excerpt. The allow-list keeps this from being
    used to make the server fetch arbitrary or internal URLs."""
    if not _allowed_host(target_url):
        return {"error": "host not allowed"}
    resp = httpx.get(target_url, timeout=20, follow_redirects=False, headers={"User-Agent": "KaventaFi-research/1.0"})
    resp.raise_for_status()
    html = resp.text[:500_000]
    import re

    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I))
    return {"url": target_url, "title": title.group(1).strip() if title else None,
            "excerpt": " ".join(text.split())[:2000], "fetched_at": date.today().isoformat()}
