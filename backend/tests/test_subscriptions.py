"""Tracked subscriptions: per-user isolation, validation, renewal roll-forward and totals."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import main
from api_subscriptions import monthly_cost, next_renewal
from auth import User, current_user
from database import Base, engine


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    main.app.dependency_overrides.clear()


def client_as(user_id: str | None):
    main.app.dependency_overrides.clear()
    if user_id is not None:
        main.app.dependency_overrides[current_user] = lambda: User(user_id)
    return TestClient(main.app)


def body(**kw):
    base = {"name": "Netflix", "price": 15.49, "billing": "monthly",
            "renewal_date": (date.today() + timedelta(days=5)).isoformat(), "category": "Entertainment"}
    return {**base, **kw}


# ------------------------------------------------------------ pure helpers
def test_next_renewal_rolls_forward_by_whole_cycles():
    today = date(2026, 10, 24)
    assert next_renewal(date(2026, 10, 30), "monthly", today) == date(2026, 10, 30)  # future: unchanged
    assert next_renewal(date(2026, 10, 24), "monthly", today) == date(2026, 10, 24)  # today counts
    assert next_renewal(date(2026, 8, 3), "monthly", today) == date(2026, 11, 3)
    assert next_renewal(date(2025, 3, 1), "yearly", today) == date(2027, 3, 1)
    assert next_renewal(date(2026, 10, 1), "weekly", today) == date(2026, 10, 29)
    assert next_renewal(date(2026, 1, 15), "quarterly", today) == date(2027, 1, 15)


def test_month_end_bills_do_not_drift():
    # Jan 31 monthly: Feb 28, then back to Mar 31 (not stuck on the 28th).
    assert next_renewal(date(2026, 1, 31), "monthly", date(2026, 2, 2)) == date(2026, 2, 28)
    assert next_renewal(date(2026, 1, 31), "monthly", date(2026, 3, 2)) == date(2026, 3, 31)


def test_monthly_cost():
    assert monthly_cost(120, "yearly") == 10
    assert monthly_cost(30, "quarterly") == 10
    assert monthly_cost(10, "weekly") == 43.33
    assert monthly_cost(9.99, "monthly") == 9.99


# ------------------------------------------------------------ API
def test_requires_sign_in():
    assert client_as(None).get("/api/subscriptions").status_code == 401


def test_create_list_update_delete():
    c = client_as("alice")
    assert c.get("/api/subscriptions").json() == {
        "subscriptions": [],
        "summary": {"active_count": 0, "currency": None, "monthly_total": 0, "yearly_total": 0, "next_renewal_date": None},
    }
    r = c.post("/api/subscriptions", json=body())
    assert r.status_code == 201
    sub = r.json()
    assert sub["days_until_renewal"] == 5 and sub["monthly_cost"] == 15.49 and sub["status"] == "active"

    c.post("/api/subscriptions", json=body(name="  Adobe  ", price=239.88, billing="yearly",
                                           renewal_date=(date.today() + timedelta(days=40)).isoformat()))
    c.post("/api/subscriptions", json=body(name="Gym", price=40, status="paused"))
    listing = c.get("/api/subscriptions").json()
    names = [s["name"] for s in listing["subscriptions"]]
    assert names == ["Netflix", "Adobe", "Gym"]                       # active by next charge, then paused
    assert listing["summary"]["active_count"] == 2
    assert listing["summary"]["monthly_total"] == round(15.49 + 19.99, 2)
    assert listing["summary"]["currency"] == "USD"
    assert listing["summary"]["next_renewal_date"] == sub["renewal_date"]

    upd = c.put(f"/api/subscriptions/{sub['id']}", json=body(price=17.99, plan="Premium"))
    assert upd.status_code == 200 and upd.json()["price"] == 17.99 and upd.json()["plan"] == "Premium"
    assert c.get(f"/api/subscriptions/{sub['id']}").json()["price"] == 17.99

    assert c.delete(f"/api/subscriptions/{sub['id']}").status_code == 204
    assert c.get(f"/api/subscriptions/{sub['id']}").status_code == 404


def test_other_users_subscriptions_are_invisible():
    sub = client_as("alice").post("/api/subscriptions", json=body()).json()
    bob = client_as("bob")
    assert bob.get("/api/subscriptions").json()["subscriptions"] == []
    assert bob.get(f"/api/subscriptions/{sub['id']}").status_code == 404
    assert bob.put(f"/api/subscriptions/{sub['id']}", json=body(price=0)).status_code == 404
    assert bob.delete(f"/api/subscriptions/{sub['id']}").status_code == 404
    assert client_as("alice").get(f"/api/subscriptions/{sub['id']}").json()["price"] == 15.49


@pytest.mark.parametrize("bad", [
    {"name": ""}, {"name": "   "}, {"price": -1}, {"billing": "daily"}, {"status": "deleted"},
    {"renewal_date": "1999-01-01"}, {"renewal_date": "not a date"}, {"currency": "US"}, {"name": "x" * 81},
])
def test_validation(bad):
    assert client_as("alice").post("/api/subscriptions", json=body(**bad)).status_code == 422


def test_mixed_currencies_do_not_sum():
    c = client_as("alice")
    c.post("/api/subscriptions", json=body())
    c.post("/api/subscriptions", json=body(name="Spotify UK", currency="gbp", price=11.99))
    summary = c.get("/api/subscriptions").json()["summary"]
    assert summary["currency"] is None and summary["monthly_total"] is None and summary["active_count"] == 2


def test_included_in_export_and_deletion():
    c = client_as("alice")
    c.post("/api/subscriptions", json=body())
    client_as("bob").post("/api/subscriptions", json=body(name="Bob's"))
    c = client_as("alice")
    exported = c.get("/api/me/export").json()["tracked_subscriptions"]
    assert [s["name"] for s in exported] == ["Netflix"]
    deleted = c.delete("/api/me").json()["deleted"]
    assert deleted["tracked_subscriptions"] == 1
    assert c.get("/api/subscriptions").json()["subscriptions"] == []
    assert len(client_as("bob").get("/api/subscriptions").json()["subscriptions"]) == 1
