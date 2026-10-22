import asyncio
from datetime import date
from types import SimpleNamespace as Row

import pytest

import billing
import guard
from plaid_ledger import to_ledger
from providers import cache


def test_rate_limiter_window(monkeypatch):
    monkeypatch.delenv("RATE_LIMIT_WRITE", raising=False)
    rl = guard.RateLimiter()
    for i in range(guard.LIMITS["write"]):
        assert rl.check("1.2.3.4", "write", now=100.0 + i * 0.01) == 0
    assert rl.check("1.2.3.4", "write", now=101.0) > 0
    assert rl.check("5.6.7.8", "write", now=101.0) == 0              # other clients unaffected
    assert rl.check("1.2.3.4", "write", now=161.0) == 0              # window slides


def test_buckets_and_exemptions():
    assert guard.bucket("POST", "/api/billing/webhook/stripe") is None
    assert guard.bucket("GET", "/api/portfolio/performance") == "heavy"
    assert guard.bucket("POST", "/api/me") == "write"
    assert guard.bucket("GET", "/") is None


def test_client_ip_prefers_cloudflare():
    assert guard.client_ip({"cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1"}, "2.2.2.2") == "9.9.9.9"
    assert guard.client_ip({"x-forwarded-for": "1.1.1.1, 3.3.3.3"}, None) == "1.1.1.1"


def test_stripe_signature():
    import hashlib, hmac, json
    body = json.dumps({"id": "evt"}).encode()
    sig = hmac.new(b"s", b"1000." + body, hashlib.sha256).hexdigest()
    assert billing.verify_stripe(body, f"t=1000,v1={sig}", "s", now=1010)["id"] == "evt"
    with pytest.raises(billing.WebhookRejected):
        billing.verify_stripe(body, f"t=1000,v1={sig}", "s", now=2000)
    with pytest.raises(billing.WebhookRejected):
        billing.verify_stripe(body + b" ", f"t=1000,v1={sig}", "s", now=1010)
    with pytest.raises(billing.BillingNotConfigured):
        billing.verify_stripe(body, "t=1,v1=x", None)


def test_stripe_period_end_from_items_or_object():
    ev = {"id": "e", "type": "customer.subscription.updated", "created": 1,
          "data": {"object": {"id": "s", "status": "past_due", "current_period_end": 2_000_000_000}}}
    u = billing.parse_stripe(ev)
    assert u.status == "past_due" and u.current_period_end.year == 2033
    ev["type"] = "customer.subscription.deleted"
    assert billing.parse_stripe(ev).status == "canceled"


def row(i, d, t, sub, ticker=None, amount=0.0, qty=None, price=None):
    return Row(investment_transaction_id=f"t{i}", date=d, type=t, subtype=sub, ticker=ticker, amount=amount,
               quantity=qty, price=price, fees=0.0)


def test_plaid_drip_counted_once():
    rows = [row(1, date(2024, 1, 2), "buy", "buy", "AAA", 1000, 10, 100),
            row(2, date(2024, 3, 15), "cash", "dividend", "AAA", -10),
            row(3, date(2024, 3, 15), "buy", "dividend reinvestment", "AAA", 10, 0.1, 100),
            row(4, date(2024, 6, 15), "buy", "dividend reinvestment", "AAA", 11, 0.11, 100)]
    txns, _ = to_ledger(rows)
    kinds = [(t.type, t.amount or (t.quantity or 0) * (t.price or 0)) for t in txns]
    assert kinds == [("buy", 1000), ("dividend", 10), ("buy", pytest.approx(10)), ("reinvest", pytest.approx(11))]


def test_plaid_split_becomes_ratio_and_cash_flows_map():
    rows = [row(1, date(2024, 1, 2), "buy", "buy", "AAA", 1000, 10, 100),
            row(2, date(2024, 2, 1), "transfer", "split", "AAA", 0, 10),
            row(3, date(2024, 1, 1), "cash", "deposit", None, -1000),
            row(4, date(2024, 5, 1), "cash", "withdrawal", None, 50),
            row(5, date(2024, 5, 2), "cancel", "cancel", "AAA", 0)]
    txns, notes = to_ledger(rows)
    split = next(t for t in txns if t.type == "split")
    assert split.ratio == pytest.approx(2.0)
    assert [t.type for t in txns if t.type in ("deposit", "withdrawal")] == ["deposit", "withdrawal"]
    assert notes


def test_cache_dedupes_and_serves_stale():
    calls = {"n": 0}

    async def fetch():
        calls["n"] += 1
        await asyncio.sleep(0.01)
        return calls["n"]

    async def boom():
        raise RuntimeError("down")

    async def run():
        cache.invalidate("t:")
        a, b = await asyncio.gather(cache.cached("t:x", 60, fetch), cache.cached("t:x", 60, fetch))
        assert a.value == b.value == 1 and calls["n"] == 1
        stale = await cache.cached("t:x", 0, boom)                    # expired + provider down
        assert stale.stale and stale.value == 1
        with pytest.raises(RuntimeError):
            await cache.cached("t:none", 60, boom)
    asyncio.run(run())


def test_entitlement_requires_known_feature():
    from entitlements import require_feature
    with pytest.raises(ValueError):
        require_feature("not-a-feature")
