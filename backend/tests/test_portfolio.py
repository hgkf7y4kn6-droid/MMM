from datetime import date, timedelta

import pytest

from analytics import income, portfolio as p
from analytics.models import BenchmarkAggregates, Ledger, LedgerTxn as T, PricePoint, Provenance


def weekdays(start: date, end: date) -> list[date]:
    out, d = [], start
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def flat(days, price, adj=None):
    return {d: PricePoint(d, price, adj if adj is not None else price) for d in days}


def growing(days, start_price, daily):
    out, px = {}, start_price
    for d in days:
        out[d] = PricePoint(d, px, px)
        px *= 1 + daily
    return out


CAL = weekdays(date(2020, 1, 1), date(2025, 6, 30))
END = CAL[-1]


# ---------------------------------------------------------------- replay
def test_deposit_is_not_performance():
    """Doubling the money in the account with a deposit must not double the return."""
    prices = {"AAA": flat(CAL, 100.0)}
    led = Ledger.from_txns([
        T(CAL[0], "deposit", amount=1000), T(CAL[0], "buy", "AAA", 10, 100),
        T(CAL[300], "deposit", amount=5000), T(CAL[300], "buy", "AAA", 50, 100),
    ])
    perf = p.performance(led, CAL, prices, flat(CAL, 400.0))
    one_year = next(w for w in perf["windows"] if w["key"] == "1Y")
    assert one_year["portfolio_return"] == pytest.approx(0.0, abs=1e-12)
    assert one_year["benchmark_return"] == pytest.approx(0.0)


def test_twr_matches_price_growth_regardless_of_flows():
    bench = growing(CAL, 100.0, 0.0004)
    prices = {"AAA": growing(CAL, 50.0, 0.0004)}
    led = Ledger.from_txns([
        T(CAL[0], "deposit", amount=10_000), T(CAL[0], "buy", "AAA", 200, 50.0),
        # a big deposit mid-way, invested at that day's price
        T(CAL[500], "deposit", amount=50_000),
        T(CAL[500], "buy", "AAA", 50_000 / prices["AAA"][CAL[500]].close, prices["AAA"][CAL[500]].close),
        T(CAL[900], "sell", "AAA", 5_000 / prices["AAA"][CAL[900]].close, prices["AAA"][CAL[900]].close),
        T(CAL[900], "withdrawal", amount=5_000),
    ])
    perf = p.performance(led, CAL, prices, bench)
    for w in perf["windows"]:
        if w["status"] != "ok":
            continue
        # fully invested throughout (the sale funds the withdrawal), so it tracks the benchmark exactly
        assert w["portfolio_return"] == pytest.approx(w["benchmark_return"], rel=1e-6), w["key"]
        assert w["excess_return_pp"] == pytest.approx(0, abs=1e-6)


def test_all_nine_windows_and_annualization():
    bench = growing(CAL, 100.0, 0.0003)
    prices = {"AAA": growing(CAL, 10.0, 0.0005)}
    led = Ledger.from_txns([T(CAL[0], "deposit", amount=1000), T(CAL[0], "buy", "AAA", 100, 10.0)])
    perf = p.performance(led, CAL, prices, bench)
    keys = [w["key"] for w in perf["windows"]]
    assert keys == ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"]
    by = {w["key"]: w for w in perf["windows"]}
    assert all(w["status"] == "ok" for w in by.values())
    assert "portfolio_annualized" in by["5Y"] and "portfolio_annualized" not in by["1W"]
    assert "portfolio_annualized" not in by["1D"]
    assert by["5Y"]["portfolio_return"] > by["5Y"]["benchmark_return"]
    assert by["5Y"]["outcome"] == "outperformed"
    five = by["5Y"]
    years = five["days"] / 365.25
    assert five["portfolio_annualized"] == pytest.approx((1 + five["portfolio_return"]) ** (1 / years) - 1)
    # 1D is the previous trading day
    assert by["1D"]["start"] == CAL[-2].isoformat()
    # YTD starts on the last trading day of the prior year
    assert by["YTD"]["start"] == date(2024, 12, 31).isoformat()
    assert by["5Y"]["volatility"] > 0 and by["5Y"]["max_drawdown"] <= 0
    assert by["1Y"]["money_weighted_annualized"] is not None


def test_young_portfolio_has_limited_history():
    prices = {"AAA": flat(CAL, 10.0)}
    led = Ledger.from_txns([T(date(2025, 1, 6), "deposit", amount=100), T(date(2025, 1, 6), "buy", "AAA", 10, 10)])
    by = {w["key"]: w for w in p.performance(led, CAL, prices, flat(CAL, 1.0))["windows"]}
    assert by["1Y"]["status"] == "insufficient_history" and "portfolio_return" not in by["1Y"]
    assert by["3M"]["status"] == "ok"


def test_dividends_count_once():
    days = CAL[:30]
    prices = {"AAA": flat(days, 100.0)}
    led = Ledger.from_txns([T(days[0], "deposit", amount=1000), T(days[0], "buy", "AAA", 10, 100),
                            T(days[10], "dividend", "AAA", amount=10)])
    rp = p.replay(led, days, prices)
    rets = p.daily_returns(rp.days)
    growth = 1.0
    for r in rets[1:]:
        growth *= 1 + r
    assert growth - 1 == pytest.approx(0.01)
    assert sum(d.dividends for d in rp.days) == 10


def test_drip_reinvestment_counts_once():
    days = CAL[:30]
    prices = {"AAA": flat(days, 100.0)}
    led = Ledger.from_txns([T(days[0], "deposit", amount=1000), T(days[0], "buy", "AAA", 10, 100),
                            T(days[10], "reinvest", "AAA", 0.1, 100)])
    rp = p.replay(led, days, prices)
    assert rp.days[-1].value == pytest.approx(1010)
    assert sum(d.flow for d in rp.days) == pytest.approx(1000)


def test_split_does_not_change_value():
    days = CAL[:10]
    px = {d: PricePoint(d, 100.0 if i < 5 else 50.0, 50.0) for i, d in enumerate(days)}
    led = Ledger.from_txns([T(days[0], "deposit", amount=1000), T(days[0], "buy", "AAA", 10, 100),
                            T(days[5], "split", "AAA", ratio=2.0)])
    rp = p.replay(led, days, {"AAA": px})
    assert [round(d.value, 6) for d in rp.days] == [1000.0] * 10


def test_buys_without_deposits_are_treated_as_new_capital():
    days = CAL[:10]
    led = Ledger.from_txns([T(days[0], "buy", "AAA", 10, 100), T(days[5], "buy", "AAA", 10, 100)])
    rp = p.replay(led, days, {"AAA": flat(days, 100.0)})
    assert rp.implicit_funding == pytest.approx(2000) and rp.notes
    assert all(r is None or r == pytest.approx(0) for r in p.daily_returns(rp.days))


def test_missing_price_history_is_reported_not_guessed():
    days = CAL[:40]
    px = {d: PricePoint(d, 10.0, 10.0) for d in days[:10]}   # history stops after 10 days
    led = Ledger.from_txns([T(days[0], "deposit", amount=100), T(days[0], "buy", "AAA", 10, 10)])
    rp = p.replay(led, days, {"AAA": px})
    assert rp.days[12].value is not None and rp.days[12].stale_symbols == ("AAA",)   # carried forward briefly
    assert rp.days[20].value is None and rp.days[20].missing_symbols == ("AAA",)


def test_duplicate_transactions_dropped():
    t = T(CAL[0], "dividend", "AAA", amount=5, id="plaid-1")
    led = Ledger.from_txns([t, t])
    assert len(led.txns) == 1 and led.duplicates_dropped == 1


def test_weekend_events_apply_next_trading_day():
    sat = date(2020, 1, 4)
    days = weekdays(date(2020, 1, 1), date(2020, 1, 10))
    led = Ledger.from_txns([T(sat, "deposit", amount=100)])
    rp = p.replay(led, days, {})
    monday = next(d for d in rp.days if d.day == date(2020, 1, 6))
    assert monday.flow == 100


def test_xirr_known_value():
    r = p.xirr([(date(2020, 1, 1), -1000), (date(2021, 1, 1), 1100)])
    assert r == pytest.approx(0.1, abs=1e-3)
    assert p.xirr([(date(2020, 1, 1), 100)]) is None


def test_price_only_benchmark_is_labeled():
    days = CAL[:30]
    led = Ledger.from_txns([T(days[0], "deposit", amount=100)])
    perf = p.performance(led, days, {}, flat(days, 1.0), benchmark_method="price_return")
    assert "Price return only" in perf["benchmark"]["label"]


# --------------------------------------------------------------- income
def bench():
    return BenchmarkAggregates(
        name="S&P 500", fcf_per_index_share={}, roic={}, dividend_yield=0.013,
        dps_per_index_share={2020: 58.0, 2021: 60.0, 2022: 66.0, 2023: 70.0, 2024: 74.0},
        provenance=Provenance("test", "2025-01-01T00:00:00Z", demo=True))


def quarterly_divs(symbol, year, dps_annual, shares):
    return [T(date(year, m, 15), "dividend", symbol, amount=dps_annual / 4 * shares) for m in (3, 6, 9, 12)]


def test_income_growth_separates_organic_from_new_money():
    txns = [T(date(2021, 1, 4), "deposit", amount=10_000), T(date(2021, 1, 4), "buy", "AAA", 100, 50)]
    txns += quarterly_divs("AAA", 2021, 2.00, 100)
    # 2022: dividend raised 10%, and 100 more shares bought on 1 July (new money)
    txns += [T(date(2022, 7, 1), "deposit", amount=5_000), T(date(2022, 7, 1), "buy", "AAA", 100, 50)]
    txns += [T(date(2022, m, 15), "dividend", "AAA", amount=0.55 * (100 if m < 7 else 200)) for m in (3, 6, 9, 12)]
    out = income.analyze(Ledger.from_txns(txns), as_of=date(2023, 3, 1), benchmark=bench(),
                         forward_dps={"AAA": 2.2}, prices={"AAA": 55.0})
    y2022 = next(r for r in out["annual"] if r["year"] == 2022)
    assert y2022["income"] == pytest.approx(0.55 * 100 * 2 + 0.55 * 200 * 2)
    assert y2022["actual_growth"] == pytest.approx(330 / 200 - 1)
    assert y2022["organic_growth"] == pytest.approx(0.10)              # the raise, not the purchase
    att = y2022["attribution"]
    assert att["dividend_rate_changes"] == pytest.approx(100 * (2.2 - 2.0))
    assert att["share_count_changes"] == pytest.approx(130 - 20)
    assert sum(v for k, v in att.items() if k != "total_change") == pytest.approx(att["total_change"])
    assert out["forward"]["total"] == pytest.approx(200 * 2.2)
    assert out["forward"]["portfolio_yield"] == pytest.approx(2.2 / 55)
    assert out["objective"]["status"] == "meeting_objective"
    assert out["benchmark"]["annual_growth"][2022] == pytest.approx(66 / 60 - 1)


def test_new_positions_are_not_organic():
    txns = [T(date(2021, 1, 4), "buy", "AAA", 100, 50)] + quarterly_divs("AAA", 2021, 2.0, 100)
    txns += quarterly_divs("AAA", 2022, 2.0, 100)
    txns += [T(date(2022, 2, 1), "buy", "BBB", 100, 10)] + quarterly_divs("BBB", 2022, 1.0, 100)
    out = income.analyze(Ledger.from_txns(txns), as_of=date(2023, 1, 10))
    y = next(r for r in out["annual"] if r["year"] == 2022)
    assert y["organic_growth"] == pytest.approx(0.0)
    assert y["comparable_holdings"] == ["AAA"]
    assert y["attribution"]["new_or_partial_positions"] == pytest.approx(100)


def test_split_adjusted_dps_keeps_organic_growth_flat():
    txns = [T(date(2021, 1, 4), "buy", "AAA", 100, 50)] + quarterly_divs("AAA", 2021, 2.0, 100)
    txns += [T(date(2022, 1, 10), "split", "AAA", ratio=2.0)] + quarterly_divs("AAA", 2022, 1.0, 200)
    out = income.analyze(Ledger.from_txns(txns), as_of=date(2023, 1, 10))
    y = next(r for r in out["annual"] if r["year"] == 2022)
    assert y["organic_growth"] == pytest.approx(0.0)
    assert y["actual_growth"] == pytest.approx(0.0)


def test_partial_first_year_is_not_a_complete_year():
    txns = [T(date(2021, 6, 1), "buy", "AAA", 100, 50)] + quarterly_divs("AAA", 2021, 2.0, 100)[2:]
    txns += quarterly_divs("AAA", 2022, 2.0, 100)
    out = income.analyze(Ledger.from_txns(txns), as_of=date(2023, 1, 10))
    assert [r["year"] for r in out["annual"]] == [2022]
    assert out["annual"][0]["actual_growth"] is None


def test_no_dividends():
    out = income.analyze(Ledger.from_txns([T(date(2021, 1, 4), "buy", "AAA", 1, 1)]), as_of=date(2022, 1, 1))
    assert out["status"] == "insufficient_data"
