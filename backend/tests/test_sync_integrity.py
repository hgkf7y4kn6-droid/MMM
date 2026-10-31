"""Aggregation robustness: reconnecting keeps history (Plaid Link update mode), sync drift
(holdings and new-account webhooks, trades Plaid later cancels), and transfers flagged so
they aren't read as spending."""
from datetime import date, timedelta
from types import SimpleNamespace as Row

import pytest
from fastapi.testclient import TestClient

import main
import plaid_service
import tasks
from auth import User, current_user
from crypto import encrypt
from database import Base, SessionLocal, engine
from models import Account, Holding, InvestmentTransaction, PlaidItem


@pytest.fixture(autouse=True)
def clean_db(monkeypatch):
    # Linking accounts is Pro; these tests exercise the linking flows themselves.
    monkeypatch.setenv("COMPLIMENTARY_PRO_USER_IDS", "alice,bob")
    monkeypatch.setenv("FERNET_KEY", "x" * 43 + "=")
    import crypto
    crypto._fernet.cache_clear()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    main.app.dependency_overrides.clear()
    crypto._fernet.cache_clear()


def client_as(uid):
    main.app.dependency_overrides[current_user] = lambda: User(uid)
    return TestClient(main.app)


def link(uid="alice", **kw):
    db = SessionLocal()
    db.add(PlaidItem(user_id=uid, item_id=f"item-{uid}", access_token_encrypted=encrypt("access-secret"), **kw))
    db.add(Account(account_id=f"acct-{uid}", user_id=uid, item_id=f"item-{uid}"))
    db.add(InvestmentTransaction(investment_transaction_id=f"old-{uid}", account_id=f"acct-{uid}", user_id=uid,
                                 date=date.today() - timedelta(days=30), amount=100, type="buy"))
    db.commit()
    db.close()


def capture_link_tokens(monkeypatch):
    seen = []
    monkeypatch.setattr(plaid_service, "client", Row(
        link_token_create=lambda req: seen.append(req.to_dict()) or {"link_token": "link-x"}))
    return seen


def get_item(uid="alice"):
    db = SessionLocal()
    try:
        return db.get(PlaidItem, uid)
    finally:
        db.close()


async def _ok(*_):
    return True


def post_webhook(monkeypatch, body):
    monkeypatch.setattr(main, "verify_plaid_webhook", _ok)
    return TestClient(main.app).post("/api/plaid/webhook", json=body, headers={"Plaid-Verification": "x"})


# ------------------------------------------------------------ reconnect keeps history
def test_update_mode_token_reuses_the_existing_item(monkeypatch):
    link(status="login_required", last_error="ITEM_LOGIN_REQUIRED")
    seen = capture_link_tokens(monkeypatch)
    res = client_as("alice").post("/api/plaid/create-link-token?mode=update")
    assert res.status_code == 200 and res.json()["mode"] == "update"
    req = seen[0]
    assert req["access_token"] == "access-secret" and "products" not in req
    assert "update" not in req                                   # account selection only when asked for


def test_new_accounts_notice_enables_account_selection(monkeypatch):
    link(last_error="NEW_ACCOUNTS_AVAILABLE")
    seen = capture_link_tokens(monkeypatch)
    client_as("alice").post("/api/plaid/create-link-token?mode=update")
    assert seen[0]["update"]["account_selection_enabled"] is True


def test_new_mode_is_still_the_default(monkeypatch):
    seen = capture_link_tokens(monkeypatch)
    assert client_as("alice").post("/api/plaid/create-link-token").status_code == 200
    assert "access_token" not in seen[0] and seen[0].get("products")


def test_update_mode_needs_a_repairable_link(monkeypatch):
    capture_link_tokens(monkeypatch)
    assert client_as("alice").post("/api/plaid/create-link-token?mode=update").status_code == 404
    link(status="revoked")
    res = client_as("alice").post("/api/plaid/create-link-token?mode=update")
    assert res.status_code == 409 and res.json()["detail"]["code"] == "relink_required"
    assert client_as("bob").post("/api/plaid/create-link-token?mode=update").status_code == 404   # not alice's


def test_reconnected_clears_the_error_and_keeps_the_history(monkeypatch):
    link(status="login_required", last_error="ITEM_LOGIN_REQUIRED")
    queued = []
    monkeypatch.setattr(main, "enqueue", lambda task, uid: queued.append((task.name, uid)))
    assert client_as("alice").post("/api/plaid/reconnected").status_code == 200
    item = get_item()
    assert item.status == "active" and item.last_error is None and item.item_id == "item-alice"
    assert len(queued) == 3 and {u for _, u in queued} == {"alice"}
    db = SessionLocal()
    assert db.query(InvestmentTransaction).count() == 1 and db.query(Account).count() == 1   # nothing wiped
    db.close()


def test_reconnected_refuses_a_revoked_link(monkeypatch):
    link(status="revoked")
    monkeypatch.setattr(main, "enqueue", lambda *a: None)
    assert client_as("alice").post("/api/plaid/reconnected").status_code == 409
    assert client_as("bob").post("/api/plaid/reconnected").status_code == 404


# ------------------------------------------------------------ webhooks
def test_new_accounts_webhook_is_surfaced_in_status(monkeypatch):
    link()
    post_webhook(monkeypatch, {"webhook_type": "ITEM", "webhook_code": "NEW_ACCOUNTS_AVAILABLE", "item_id": "item-alice"})
    monkeypatch.setattr(main, "resync_if_stale", lambda db, item: False)
    body = client_as("alice").get("/api/plaid/status").json()
    assert body["new_accounts_available"] is True and body["needs_reconnect"] is False


def test_new_accounts_webhook_does_not_hide_an_expiry_warning(monkeypatch):
    link(last_error="PENDING_EXPIRATION")
    post_webhook(monkeypatch, {"webhook_type": "ITEM", "webhook_code": "NEW_ACCOUNTS_AVAILABLE", "item_id": "item-alice"})
    assert get_item().last_error == "PENDING_EXPIRATION"


def test_holdings_webhook_queues_an_investment_sync(monkeypatch):
    link()
    queued = []
    monkeypatch.setattr(main, "enqueue", lambda task, uid: queued.append((task.name, uid)))
    post_webhook(monkeypatch, {"webhook_type": "HOLDINGS", "webhook_code": "DEFAULT_UPDATE", "item_id": "item-alice"})
    assert queued == [(tasks.sync_investment_transactions_task.name, "alice")]


# ------------------------------------------------------------ cancelled / corrected trades
def plaid_txn(tid, days_ago):
    return {"investment_transaction_id": tid, "account_id": "acct-alice", "security_id": None,
            "date": date.today() - timedelta(days=days_ago), "amount": 10.0, "type": "buy", "subtype": "buy",
            "quantity": 1.0, "price": 10.0, "fees": 0.0}


def fake_investments(monkeypatch, txns, total=None):
    monkeypatch.setattr(plaid_service, "client", Row(
        investments_transactions_get=lambda req: {"securities": [],
                                                  "investment_transactions": txns if req.options.offset == 0 else [],
                                                  "total_investment_transactions": len(txns) if total is None else total},
        investments_holdings_get=lambda req: {"securities": [], "holdings": []}))


def stored_ids():
    db = SessionLocal()
    try:
        return sorted(r.investment_transaction_id for r in db.query(InvestmentTransaction).all())
    finally:
        db.close()


def test_trades_plaid_no_longer_reports_are_removed(monkeypatch):
    link()                                                        # stores "old-alice" 30 days ago
    db = SessionLocal()
    db.add(InvestmentTransaction(investment_transaction_id="ancient", account_id="acct-alice", user_id="alice",
                                 date=date.today() - timedelta(days=tasks.INVESTMENT_HISTORY_DAYS + 40), amount=1))
    db.add(InvestmentTransaction(investment_transaction_id="bobs", account_id="b", user_id="bob",
                                 date=date.today() - timedelta(days=5), amount=1))
    db.commit()
    db.close()
    fake_investments(monkeypatch, [plaid_txn("kept", 3)])
    tasks.sync_investment_transactions_task.run("alice")
    # the cancelled trade inside the window is gone; older history and other users are untouched
    assert stored_ids() == ["ancient", "bobs", "kept"]


def test_an_incomplete_fetch_removes_nothing(monkeypatch):
    link()
    fake_investments(monkeypatch, [plaid_txn("kept", 3)], total=5)     # Plaid says 5, only 1 arrived
    tasks.sync_investment_transactions_task.run("alice")
    assert stored_ids() == ["kept", "old-alice"]


def test_an_empty_response_removes_nothing(monkeypatch):
    link()
    fake_investments(monkeypatch, [])
    tasks.sync_investment_transactions_task.run("alice")
    assert stored_ids() == ["old-alice"]


def test_sync_keeps_the_new_accounts_notice(monkeypatch):
    link(last_error="NEW_ACCOUNTS_AVAILABLE")
    fake_investments(monkeypatch, [plaid_txn("kept", 3)])
    tasks.sync_investment_transactions_task.run("alice")
    item = get_item()
    assert item.last_error == "NEW_ACCOUNTS_AVAILABLE" and item.last_synced_at is not None


# ------------------------------------------------------------ transfers aren't spending
@pytest.mark.parametrize("primary,detailed,expected", [
    ("TRANSFER_OUT", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS", True),
    ("TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER", True),
    ("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", True),
    ("LOAN_PAYMENTS", "LOAN_PAYMENTS_MORTGAGE_PAYMENT", False),
    ("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", False),
    (None, None, False),
])
def test_internal_movements_are_flagged(primary, detailed, expected):
    assert main.is_internal_movement(primary, detailed) is expected


def test_transactions_api_carries_the_transfer_flag():
    from models import Transaction
    db = SessionLocal()
    db.add(Transaction(transaction_id="t1", account_id="a", user_id="alice", date=date(2026, 1, 5), amount=1000,
                       category_primary="TRANSFER_OUT", category_detailed="TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"))
    db.add(Transaction(transaction_id="t2", account_id="a", user_id="alice", date=date(2026, 1, 6), amount=42,
                       category_primary="FOOD_AND_DRINK", category_detailed="FOOD_AND_DRINK_GROCERIES"))
    db.commit()
    db.close()
    rows = {r["transaction_id"]: r["is_transfer"] for r in client_as("alice").get("/api/transactions/alice").json()}
    assert rows == {"t1": True, "t2": False}
