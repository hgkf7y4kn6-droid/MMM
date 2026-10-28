"""Fixes from the baseline audit: no phantom short positions, dividend run-rate,
money-movement routes off by default, Plaid credential revocation, sync status."""
import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace as Row

import pytest
from fastapi.testclient import TestClient

import main
import plaid_service
import tasks
from analytics import income, portfolio as p
from analytics.models import Ledger, LedgerTxn as T, PricePoint
from auth import User, current_user
from crypto import encrypt
from database import Base, SessionLocal, engine
from models import Account, InvestmentTransaction, PlaidItem
from plaid_ledger import to_ledger
from providers.tiingo import indicated_annual_dividend


@pytest.fixture(autouse=True)
def clean_db(monkeypatch):
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
    db.commit()
    db.close()


# ------------------------------------------------------------ oversold positions
def weekdays(start, end):
    out, d = [], start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def row(i, d, t, sub, ticker=None, amount=0.0, qty=None, price=None):
    return Row(investment_transaction_id=f"t{i}", date=d, type=t, subtype=sub, ticker=ticker, amount=amount,
               quantity=qty, price=price, fees=0.0)


def test_sale_of_shares_bought_before_the_history_is_left_out_and_noted():
    rows = [row(1, date(2025, 1, 10), "sell", "sell", "AAA", -5000, -100, 50),
            row(2, date(2025, 1, 10), "buy", "buy", "BBB", 1000, 10, 100)]
    txns, notes = to_ledger(rows)
    assert [t.type for t in txns] == ["buy"]
    assert any("AAA" in n and "before the available history" in n for n in notes)


def test_partial_oversell_is_limited_to_shares_held():
    rows = [row(1, date(2025, 1, 2), "buy", "buy", "AAA", 1000, 10, 100),
            row(2, date(2025, 2, 3), "sell", "sell", "AAA", -2000, -20, 100)]
    txns, _ = to_ledger(rows)
    assert [(t.type, t.quantity) for t in txns] == [("buy", 10), ("sell", 10)]


def test_dividend_on_untracked_shares_is_dropped():
    rows = [row(1, date(2025, 2, 3), "cash", "dividend", "AAA", -40)]
    txns, notes = to_ledger(rows)
    assert txns == [] and notes


def test_replay_never_goes_short_and_both_engines_agree():
    cal = weekdays(date(2025, 1, 6), date(2025, 3, 31))
    prices = {"AAA": {d: PricePoint(d, 50.0 + i, 50.0 + i) for i, d in enumerate(cal)}}
    led = Ledger.from_txns([T(cal[0], "deposit", amount=1000), T(cal[0], "buy", "AAA", 10, 50),
                            T(cal[5], "sell", "AAA", 100, 55)])        # 90 more than held
    rp = p.replay(led, cal, prices)
    assert rp.final_shares == {}                                      # flat, not -90
    assert rp.final_cash == pytest.approx(1000 - 500 + 10 * 55)
    assert any("AAA" in n and "exceeded" in n for n in rp.notes)
    assert income.Positions(led).shares_on("AAA", cal[-1], before=False) == 0


# ------------------------------------------------------------ dividend run-rate
END = date(2025, 6, 30)


def quarterly(*days_ago, amount=1.0):
    return [(END - timedelta(days=d), amount) for d in days_ago]


def test_special_dividend_is_not_annualized():
    divs = quarterly(300, 210, 120) + [(END - timedelta(days=30), 5.0)]
    assert indicated_annual_dividend(divs, END) == pytest.approx(4.0)


def test_five_payments_in_a_year_is_still_quarterly():
    assert indicated_annual_dividend(quarterly(362, 271, 180, 90, 2), END) == pytest.approx(4.0)


def test_a_late_payment_does_not_cut_the_run_rate():
    assert indicated_annual_dividend(quarterly(330, 240, 150, 55), END) == pytest.approx(4.0)   # window caught 4 of a shifted 4
    assert indicated_annual_dividend(quarterly(240, 150, 55), END) == pytest.approx(4.0)         # only 3 in the window


def test_raise_cut_monthly_annual_and_none():
    assert indicated_annual_dividend(quarterly(270, 180, 90, 2, amount=1.0)[:3] + [(END - timedelta(days=2), 1.1)], END) == pytest.approx(4.4)
    assert indicated_annual_dividend([(END - timedelta(days=30 * k), 0.2) for k in range(1, 12)], END) == pytest.approx(2.4)
    assert indicated_annual_dividend([(END - timedelta(days=100), 3.0)], END) == pytest.approx(3.0)
    assert indicated_annual_dividend([(END - timedelta(days=400), 3.0)], END) == 0.0
    assert indicated_annual_dividend([], END) == 0.0


# ------------------------------------------------------------ transfers are off
@pytest.mark.parametrize("method,path", [("post", "/api/transfer/authorize"), ("post", "/api/transfer/create"),
                                         ("post", "/api/transfer/migrate-account"),
                                         ("get", "/api/transfer/capabilities/acc")])
def test_transfer_routes_are_off_by_default_even_for_admins(monkeypatch, method, path):
    monkeypatch.setenv("ADMIN_USER_IDS", "root")
    monkeypatch.delenv("ENABLE_TRANSFERS", raising=False)
    for uid in ("alice", "root"):
        assert getattr(client_as(uid), method)(path, **({"json": {}} if method == "post" else {})).status_code == 404


def test_transfer_routes_need_flag_and_admin(monkeypatch):
    monkeypatch.setenv("ADMIN_USER_IDS", "root")
    monkeypatch.setenv("ENABLE_TRANSFERS", "1")
    assert client_as("alice").get("/api/transfer/capabilities/acc").status_code == 404
    # An admin gets past the gate (then fails on ownership of the account, not on the route).
    assert client_as("root").get("/api/transfer/capabilities/acc").status_code == 404


# ------------------------------------------------------------ revoking the bank link
def test_delete_revokes_the_bank_token_before_forgetting_it(monkeypatch):
    link()
    seen = []
    monkeypatch.setattr(plaid_service, "revoke_item", lambda token: seen.append(token) or True)
    res = client_as("alice").delete("/api/me")
    assert res.status_code == 200 and res.json()["bank_link_revoked"] is True and seen == ["access-secret"]
    db = SessionLocal()
    assert db.get(PlaidItem, "alice") is None
    db.close()


def test_delete_changes_nothing_when_plaid_cannot_revoke(monkeypatch):
    link()
    db = SessionLocal()
    db.add(InvestmentTransaction(investment_transaction_id="t", account_id="a", user_id="alice", date=date(2025, 1, 2),
                                 amount=1))
    db.commit()
    db.close()
    monkeypatch.setattr(plaid_service, "revoke_item", lambda token: False)
    res = client_as("alice").delete("/api/me")
    assert res.status_code == 502
    db = SessionLocal()
    assert db.get(PlaidItem, "alice") is not None and db.query(InvestmentTransaction).count() == 1
    db.close()


def test_delete_without_a_bank_link_still_works():
    assert client_as("alice").delete("/api/me").json()["bank_link_revoked"] is None


def test_relinking_another_institution_revokes_the_old_one_and_clears_its_data(monkeypatch):
    link()
    db = SessionLocal()
    db.add(Account(account_id="old", user_id="alice", item_id="item-alice"))
    db.add(InvestmentTransaction(investment_transaction_id="t", account_id="old", user_id="alice",
                                 date=date(2025, 1, 2), amount=1))
    db.commit()
    db.close()
    revoked = []
    monkeypatch.setattr(plaid_service, "revoke_item", lambda token: revoked.append(token) or True)
    monkeypatch.setattr(plaid_service, "client", Row(item_public_token_exchange=lambda req: {
        "item_id": "item-new", "access_token": "new-secret"}))
    queued = []
    monkeypatch.setattr(main, "enqueue", lambda task, uid: queued.append(task.name))
    res = client_as("alice").post("/api/plaid/exchange-public-token", json={"public_token": "public-x"})
    assert res.status_code == 200 and revoked == ["access-secret"] and len(queued) == 3
    db = SessionLocal()
    assert db.query(Account).count() == 0 and db.query(InvestmentTransaction).count() == 0
    assert db.get(PlaidItem, "alice").item_id == "item-new"
    db.close()


def test_revoke_item_semantics(monkeypatch):
    import plaid
    assert plaid_service.revoke_item("t") is True                       # Plaid not configured: nothing to revoke

    class Gone(plaid.ApiException):
        def __init__(self, code):
            self.body = '{"error_code": "%s"}' % code

    def boom(code):
        def f(req):
            raise Gone(code)
        return f
    monkeypatch.setattr(plaid_service, "client", Row(item_remove=boom("ITEM_NOT_FOUND")))
    assert plaid_service.revoke_item("t") is True
    monkeypatch.setattr(plaid_service, "client", Row(item_remove=boom("INTERNAL_SERVER_ERROR")))
    assert plaid_service.revoke_item("t") is False


# ------------------------------------------------------------ sync status
def test_status_for_unlinked_and_linked_users(monkeypatch):
    monkeypatch.setattr(main, "resync_if_stale", lambda db, item: False)
    assert client_as("alice").get("/api/plaid/status").json()["linked"] is False
    link(last_synced_at=datetime(2025, 1, 1, tzinfo=timezone.utc))
    body = client_as("alice").get("/api/plaid/status").json()
    assert body["linked"] and body["status"] == "active" and not body["needs_reconnect"]
    assert body["last_synced_at"].startswith("2025-01-01")
    assert client_as("bob").get("/api/plaid/status").json()["linked"] is False       # not alice's


@pytest.mark.parametrize("code,status", [("ERROR", "error"), ("USER_PERMISSION_REVOKED", "revoked")])
def test_item_webhooks_set_status(monkeypatch, code, status):
    link()
    async def ok(*_):
        return True
    monkeypatch.setattr(main, "verify_plaid_webhook", ok)
    body = {"webhook_type": "ITEM", "webhook_code": code, "item_id": "item-alice"}
    assert TestClient(main.app).post("/api/plaid/webhook", json=body, headers={"Plaid-Verification": "x"}).status_code == 200
    db = SessionLocal()
    assert db.get(PlaidItem, "alice").status == status
    db.close()


def test_login_required_error_code_needs_reconnect(monkeypatch):
    link()
    async def ok(*_):
        return True
    monkeypatch.setattr(main, "verify_plaid_webhook", ok)
    body = {"webhook_type": "ITEM", "webhook_code": "ERROR", "item_id": "item-alice",
            "error": {"error_code": "ITEM_LOGIN_REQUIRED"}}
    TestClient(main.app).post("/api/plaid/webhook", json=body, headers={"Plaid-Verification": "x"})
    monkeypatch.setattr(main, "resync_if_stale", lambda db, item: False)
    assert client_as("alice").get("/api/plaid/status").json()["needs_reconnect"] is True
    assert client_as("alice").post("/api/plaid/sync").status_code == 409


def test_user_fixable_plaid_error_marks_item_and_does_not_retry(monkeypatch):
    import plaid

    class LoginRequired(plaid.ApiException):
        def __init__(self):
            self.body = '{"error_code": "ITEM_LOGIN_REQUIRED"}'

    def fail(req):
        raise LoginRequired()
    link()
    monkeypatch.setattr(plaid_service, "client", Row(investments_transactions_get=fail))
    assert tasks.sync_investment_transactions_task.apply(args=("alice",), throw=True).result == 0
    db = SessionLocal()
    item = db.get(PlaidItem, "alice")
    assert item.status == "login_required" and item.last_error == "ITEM_LOGIN_REQUIRED" and item.last_synced_at is None
    db.close()


def test_other_plaid_errors_still_propagate_for_retry(monkeypatch):
    import plaid

    class Down(plaid.ApiException):
        def __init__(self):
            self.body = '{"error_code": "INTERNAL_SERVER_ERROR"}'

    def fail(req):
        raise Down()
    link()
    monkeypatch.setattr(plaid_service, "client", Row(investments_transactions_get=fail))
    with pytest.raises(plaid.ApiException):
        tasks.sync_investment_transactions_task.run("alice")


def test_stale_accounts_are_refreshed_once_per_cooldown(monkeypatch):
    queued = []
    monkeypatch.setattr(tasks, "enqueue", lambda task, uid: queued.append(task.name))
    link(last_synced_at=datetime.now(timezone.utc) - timedelta(hours=30))
    db = SessionLocal()
    item = db.get(PlaidItem, "alice")
    assert tasks.resync_if_stale(db, item) is True and len(queued) == 3
    assert tasks.resync_if_stale(db, item) is False                       # cooldown
    fresh = PlaidItem(user_id="b", item_id="i", access_token_encrypted="x", last_synced_at=datetime.now(timezone.utc))
    assert tasks.resync_if_stale(db, fresh) is False                      # recent
    broken = PlaidItem(user_id="c", item_id="j", access_token_encrypted="x", status="login_required")
    assert tasks.resync_if_stale(db, broken) is False                     # user must reconnect first
    db.close()


def test_enqueue_runs_in_process_without_a_worker(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    ran = []

    class FakeTask:
        name = "fake"
        def apply(self, args, throw):
            ran.append(args)
    import threading
    assert tasks.enqueue(FakeTask(), "alice") == "inline"
    for t in threading.enumerate():
        if t is not threading.main_thread() and t.daemon:
            t.join(2)
    assert ran == [("alice",)]
