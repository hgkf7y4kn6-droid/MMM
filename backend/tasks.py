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
from datetime import date, timedelta
from urllib.parse import urlparse

import httpx
from celery import Celery

from crypto import decrypt
from database import SessionLocal
from models import Account, InvestmentTransaction, PlaidItem, Transaction

log = logging.getLogger("tasks")

celery_app = Celery("mmm", broker=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
                    backend=os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
celery_app.conf.update(task_always_eager=os.environ.get("CELERY_EAGER") == "1", task_acks_late=True,
                       task_reject_on_worker_lost=True, result_expires=3600)

INVESTMENT_HISTORY_DAYS = 730
RETRY = {"autoretry_for": (Exception,), "retry_backoff": True, "retry_backoff_max": 600, "max_retries": 5}


def _item(db, user_id: str) -> PlaidItem | None:
    return db.query(PlaidItem).filter(PlaidItem.user_id == user_id).first()


@celery_app.task(**RETRY)
def sync_accounts_task(user_id: str) -> int:
    import plaid_service

    db = SessionLocal()
    try:
        item = _item(db, user_id)
        if not item:
            return 0
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
    finally:
        db.close()


@celery_app.task(**RETRY)
def sync_investment_transactions_task(user_id: str) -> int:
    """/investments/transactions/get for the last 24 months, paged by offset.
    Stores quantity, price and fees so portfolio returns can be rebuilt."""
    import plaid_service
    from plaid_service import DIVIDEND_SUBTYPES

    db = SessionLocal()
    try:
        item = _item(db, user_id)
        if not item:
            return 0
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
        db.commit()
        return stored
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
    resp = httpx.get(target_url, timeout=20, follow_redirects=False, headers={"User-Agent": "MMM-research/1.0"})
    resp.raise_for_status()
    html = resp.text[:500_000]
    import re

    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I))
    return {"url": target_url, "title": title.group(1).strip() if title else None,
            "excerpt": " ".join(text.split())[:2000], "fetched_at": date.today().isoformat()}
