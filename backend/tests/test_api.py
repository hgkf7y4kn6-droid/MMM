"""Entitlements, billing integrity and per-user isolation, through the real app."""
import hashlib
import hmac
import json
import time
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import main
from auth import User, current_user
from database import Base, SessionLocal, engine
from models import BillingEvent, InvestmentTransaction, Subscription

PRO_ENDPOINTS = ["/api/stocks/DEMO-LITE/fcf", "/api/stocks/DEMO-LITE/roic", "/api/stocks/DEMO-LITE/dividend-growth",
                 "/api/stocks/DEMO-LITE/capital-allocation", "/api/stocks/DEMO-LITE/export.csv",
                 "/api/portfolio/performance?source=demo", "/api/portfolio/income?source=demo"]


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    main.app.dependency_overrides.clear()


def client_as(user_id: str | None):
    if user_id is not None:
        main.app.dependency_overrides[current_user] = lambda: User(user_id)
    return TestClient(main.app)


def set_sub(user_id, status, period_end_days, **kw):
    db = SessionLocal()
    db.merge(Subscription(user_id=user_id, provider="stripe", status=status,
                          current_period_end=datetime.now(timezone.utc) + timedelta(days=period_end_days), **kw))
    db.commit()
    db.close()


# ---------------------------------------------------------------- auth
def test_api_requires_sign_in():
    c = client_as(None)
    assert c.get("/api/stocks/DEMO-LITE/matrix").status_code == 401
    assert c.get("/api/me").status_code == 401
    assert c.get("/").status_code == 200


def test_legacy_routes_only_serve_the_caller():
    c = client_as("alice")
    for path in ("/api/accounts/bob", "/api/transactions/bob", "/api/dividends/confirmed/bob"):
        assert c.get(path).status_code == 403, path
    assert c.get("/api/accounts/alice").status_code == 200


def test_linked_portfolio_is_scoped_to_the_caller():
    db = SessionLocal()
    db.add(InvestmentTransaction(investment_transaction_id="t1", account_id="a", user_id="bob", ticker="DEMO-LITE",
                                 date=date(2024, 1, 2), amount=1000, type="buy", subtype="buy", quantity=10, price=100))
    db.commit()
    db.close()
    for u in ("alice", "bob"):                    # linked accounts are Pro
        set_sub(u, "active", 20)
    r = client_as("alice").get("/api/portfolio/overview?source=linked")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "no_portfolio"
    assert client_as("bob").get("/api/portfolio/overview?source=linked").status_code == 200


def test_linked_accounts_are_pro():
    c = client_as("free-user")
    r = c.get("/api/portfolio/overview?source=linked")
    assert r.status_code == 402 and r.json()["detail"]["feature"] == "account_linking"
    for path in ("/api/plaid/create-link-token", "/api/plaid/sync", "/api/plaid/reconnected", "/api/imports/linked"):
        assert c.post(path).status_code == 402, path
    assert c.post("/api/plaid/exchange-public-token", json={"public_token": "x"}).status_code == 402
    status = c.get("/api/plaid/status").json()
    assert status["allowed"] is False and status["linked"] is False


# ---------------------------------------------------------- free vs pro
def test_free_gets_the_matrix():
    r = client_as("free-user").get("/api/stocks/DEMO-LITE/matrix")
    assert r.status_code == 200
    body = r.json()
    assert [s["key"] for s in body["sections"]] == ["historical_growth", "projected_growth", "capital_intensity",
                                                    "balance_sheet", "dividends"]
    assert body["provenance"]["demo"] is True


@pytest.mark.parametrize("path", PRO_ENDPOINTS)
def test_free_users_cannot_retrieve_pro_data(path):
    r = client_as("free-user").get(path)
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert detail["code"] == "pro_required"
    assert set(r.json()) == {"detail"}              # no analytics in the body


@pytest.mark.parametrize("path", PRO_ENDPOINTS)
def test_pro_users_get_pro_data(path):
    set_sub("pro-user", "active", 20)
    assert client_as("pro-user").get(path).status_code == 200


def test_client_cannot_claim_pro():
    c = client_as("free-user")
    r = c.get("/api/stocks/DEMO-LITE/roic", headers={"X-Plan": "pro"}, params={"plan": "pro"})
    assert r.status_code == 402


@pytest.mark.parametrize("status,days,extra,expected", [
    ("active", 10, {}, 200),
    ("trialing", 5, {}, 200),
    ("active", -2, {}, 200),                       # renewal webhook late, inside GRACE_DAYS
    ("active", -10, {}, 402),                      # renewal never confirmed
    ("canceled", 5, {}, 200),                      # paid through the period end
    ("canceled", -1, {}, 402),
    ("past_due", -1, {}, 200),                     # grace
    ("past_due", -30, {}, 402),
    ("expired", 30, {}, 402),
    ("paused", 30, {}, 402),
])
def test_subscription_states(status, days, extra, expected):
    set_sub("u", status, days, **extra)
    assert client_as("u").get("/api/stocks/DEMO-LITE/roic").status_code == expected


def test_me_reports_plan_and_features():
    set_sub("u", "canceled", 5, cancel_at_period_end=True)
    ent = client_as("u").get("/api/me").json()["entitlement"]
    assert ent["plan"] == "pro" and ent["status"] == "canceled" and ent["features"]["roic"] is True


def test_compare_limit():
    c = client_as("free-user")
    assert c.get("/api/stocks/compare?symbols=DEMO-LITE,DEMO-GRID").status_code == 200
    assert c.get("/api/stocks/compare?symbols=DEMO-LITE,DEMO-GRID,DEMO-CASH").status_code == 402


# ------------------------------------------------------------- billing
SECRET = "whsec_test"


def stripe_post(c, event, secret=SECRET, ts=None):
    payload = json.dumps(event).encode()
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return c.post("/api/billing/webhook/stripe", content=payload, headers={"Stripe-Signature": f"t={ts},v1={sig}"})


def sub_event(eid, user, status, created, period_end_days=30):
    return {"id": eid, "type": "customer.subscription.updated", "created": created,
            "data": {"object": {"id": "sub_1", "customer": "cus_1", "status": status, "metadata": {"user_id": user},
                                "items": {"data": [{"current_period_end": int(time.time()) + period_end_days * 86400}]}}}}


def test_stripe_webhook_grants_once_and_ignores_replays(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    c = client_as(None)
    now = int(time.time())
    assert stripe_post(c, sub_event("evt_1", "carol", "active", now)).json()["outcome"] == "applied"
    assert stripe_post(c, sub_event("evt_1", "carol", "active", now)).json()["outcome"] == "duplicate"
    db = SessionLocal()
    assert db.query(BillingEvent).count() == 1 and db.get(BillingEvent, "evt_1").attempts == 2
    db.close()
    assert client_as("carol").get("/api/stocks/DEMO-LITE/roic").status_code == 200


def test_out_of_order_webhook_cannot_roll_back(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    c = client_as(None)
    now = int(time.time())
    stripe_post(c, sub_event("evt_new", "dan", "canceled", now, period_end_days=-1))
    assert stripe_post(c, sub_event("evt_old", "dan", "active", now - 3600)).json()["outcome"] == "stale"
    assert client_as("dan").get("/api/stocks/DEMO-LITE/roic").status_code == 402


@pytest.mark.parametrize("kind", ["bad_sig", "old", "missing"])
def test_unverified_stripe_webhooks_are_rejected(monkeypatch, kind):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    c = client_as(None)
    ev = sub_event("evt_x", "mallory", "active", int(time.time()))
    if kind == "bad_sig":
        r = stripe_post(c, ev, secret="whsec_wrong")
    elif kind == "old":
        r = stripe_post(c, ev, ts=int(time.time()) - 3600)
    else:
        r = c.post("/api/billing/webhook/stripe", content=json.dumps(ev))
    assert r.status_code == 400
    assert client_as("mallory").get("/api/stocks/DEMO-LITE/roic").status_code == 402


def test_revenuecat_lifecycle(monkeypatch):
    monkeypatch.setenv("REVENUECAT_WEBHOOK_AUTH", "Bearer rc-secret")
    c = client_as(None)
    ms = int(time.time() * 1000)

    def ev(eid, type_, ts, exp_days):
        return {"event": {"id": eid, "type": type_, "app_user_id": "erin", "event_timestamp_ms": ts,
                          "expiration_at_ms": ms + exp_days * 86400_000}}
    assert c.post("/api/billing/webhook/revenuecat", json=ev("rc1", "INITIAL_PURCHASE", ms, 30),
                  headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.post("/api/billing/webhook/revenuecat", json=ev("rc1", "INITIAL_PURCHASE", ms, 30),
                  headers={"Authorization": "Bearer rc-secret"}).json()["outcome"] == "applied"
    assert client_as("erin").get("/api/stocks/DEMO-LITE/roic").status_code == 200
    c.post("/api/billing/webhook/revenuecat", json=ev("rc2", "EXPIRATION", ms + 1000, -1),
           headers={"Authorization": "Bearer rc-secret"})
    assert client_as("erin").get("/api/stocks/DEMO-LITE/roic").status_code == 402


def test_checkout_rejects_foreign_return_urls():
    r = client_as("u").post("/api/billing/checkout", json={"success_url": "https://evil.example/x",
                                                          "cancel_url": "kaventafi://pro"})
    assert r.status_code == 400


# -------------------------------------------------------------- portfolio
def test_demo_portfolio_performance_has_nine_windows():
    set_sub("pro-user", "active", 20)
    body = client_as("pro-user").get("/api/portfolio/performance?source=demo").json()
    assert [w["key"] for w in body["windows"]] == ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"]
    assert body["demo"] is True and body["benchmark"]["method"] == "total_return"
    assert all(w["status"] == "ok" for w in body["windows"])


def test_demo_income_analysis():
    set_sub("pro-user", "active", 20)
    body = client_as("pro-user").get("/api/portfolio/income?source=demo").json()
    assert body["status"] == "ok" and body["annual"] and body["benchmark"]["measure"].startswith("S&P 500")
    years = [r for r in body["annual"] if r["attribution"]]
    for r in years:
        a = r["attribution"]
        assert sum(v for k, v in a.items() if k != "total_change") == pytest.approx(a["total_change"])


def test_posted_ledger_validation():
    set_sub("pro-user", "active", 20)
    c = client_as("pro-user")
    future = (date.today() + timedelta(days=3)).isoformat()
    assert c.post("/api/portfolio/performance", json={"transactions": [{"day": future, "type": "deposit", "amount": 1}]}
                  ).status_code == 422
    assert c.post("/api/portfolio/performance", json={"transactions": [{"day": "2024-01-02", "type": "buy",
                                                                        "symbol": "DEMO-LITE"}]}).status_code == 422
    ok = c.post("/api/portfolio/performance?windows=1M,1Y", json={"transactions": [
        {"day": "2023-01-03", "type": "deposit", "amount": 1000},
        {"day": "2023-01-03", "type": "buy", "symbol": "DEMO-LITE", "quantity": 5, "price": 100}]})
    assert ok.status_code == 200 and [w["key"] for w in ok.json()["windows"]] == ["1M", "1Y"]


# ------------------------------------------------------------- data rights
def test_export_and_delete_own_data():
    db = SessionLocal()
    for uid in ("alice", "bob"):
        db.add(InvestmentTransaction(investment_transaction_id=f"t-{uid}", account_id="a", user_id=uid, ticker="X",
                                     date=date(2024, 1, 2), amount=1, type="cash", subtype="dividend"))
    db.commit()
    db.close()
    c = client_as("alice")
    exported = c.get("/api/me/export").json()
    assert [t["investment_transaction_id"] for t in exported["investment_transactions"]] == ["t-alice"]
    assert c.delete("/api/me").json()["deleted"]["investment_transactions"] == 1
    db = SessionLocal()
    assert db.query(InvestmentTransaction).filter_by(user_id="bob").count() == 1
    db.close()
