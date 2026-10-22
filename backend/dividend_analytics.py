"""Dividend and price analytics for one ticker
(GET /api/market/dividend-analytics/{symbol}).

Response contract (read by the app's dividend analytics view):
    current_yield_pct, yield_source           trailing 12-month distributions ÷ last close
    yield_on_cost_pct                         trailing 12-month distributions ÷ cost basis (null without one)
    dividend_cagr_pct {1y,3y,5y,10y}          complete calendar years N years apart, split-adjusted
    price_appreciation_cagr_pct {...}         split-adjusted close, dividends excluded (price only)
    vs_benchmark_excess_return_pct {...}      price CAGR minus SPY's price CAGR over the same dates
    recent_distributions, distribution_frequency, distribution_source, fetched_at

Percentages are percent numbers here (5.2 = 5.2%), matching the existing
contract; the newer /api/stocks endpoints use fractions.
"""
import time
from collections import defaultdict
from datetime import date, timedelta

from analytics.growth import cagr
from analytics.portfolio import minus_months
from providers.registry import is_demo_symbol, providers
from providers.tiingo import _split_adjusted_dividends

PERIODS = (1, 3, 5, 10)


def _pct(m):
    return round(m.value * 100, 2) if m.ok else None


def _split_adjusted_closes(rows):
    out, factor = {}, 1.0
    for r in reversed(rows):
        d = date.fromisoformat(r["date"][:10])
        out[d] = r["close"] / factor
        if r.get("splitFactor") and r["splitFactor"] != 1:
            factor *= r["splitFactor"]
    return dict(sorted(out.items()))


def _on_or_before(series: dict, target: date):
    days = [d for d in series if d <= target]
    return series[days[-1]] if days else None


def _price_cagrs(closes: dict, end: date) -> dict:
    out = {}
    last = _on_or_before(closes, end)
    for n in PERIODS:
        start = _on_or_before(closes, minus_months(end, 12 * n))
        out[f"{n}y"] = _pct(cagr(start, last, n)) if start and last else None
    return out


async def get_dividend_analytics(symbol: str, cost_basis: float | None = None) -> dict:
    symbol = symbol.strip().upper()
    p = providers()
    end = date.today()
    start = date(end.year - 11, 1, 1)
    if p.mode == "demo" or is_demo_symbol(symbol):
        c = await p.demo.fundamentals(symbol)
        by_year = {fy.fiscal_year: fy.dividends_per_share or 0.0 for fy in c.years}
        closes = {d: pp.close for d, pp in (await p.demo.daily(symbol, start, end)).items()}
        bench = {d: pp.close for d, pp in (await p.demo.daily("SPY", start, end)).items()}
        trailing = c.quote.trailing_dividends_12m or 0.0
        recent, freq, source = [], None, "demo"
    else:
        rows = await p.live._eod(symbol, start, end)
        spy = await p.live._eod("SPY", start, end)
        divs = _split_adjusted_dividends(rows)
        by_year = defaultdict(float)
        for d, a in divs:
            by_year[d.year] += a
        closes, bench = _split_adjusted_closes(rows), _split_adjusted_closes(spy)
        last_year = [a for d, a in divs if d > end - timedelta(days=365)]
        trailing = sum(last_year)
        recent = [{"ex_date": d.isoformat(), "payment_date": None, "amount": round(a, 4)} for d, a in divs[-8:][::-1]]
        freq = {1: "Annual", 2: "Semi-annual", 4: "Quarterly", 12: "Monthly"}.get(len(last_year))
        source = "eod-divcash-fallback"
    last_complete = end.year - 1
    dividend_cagr = {f"{n}y": _pct(cagr(by_year.get(last_complete - n), by_year.get(last_complete), n)) for n in PERIODS}
    price = _price_cagrs(closes, end)
    bench_cagr = _price_cagrs(bench, end)
    excess = {k: (round(price[k] - bench_cagr[k], 2) if price[k] is not None and bench_cagr[k] is not None else None)
              for k in price}
    last_close = _on_or_before(closes, end)
    return {
        "ticker": symbol,
        "current_yield_pct": round(trailing / last_close * 100, 2) if last_close and trailing else None,
        "yield_source": "computed",
        "yield_on_cost_pct": round(trailing / cost_basis * 100, 2) if cost_basis and trailing else None,
        "dividend_cagr_pct": dividend_cagr,
        "price_appreciation_cagr_pct": price,
        "vs_benchmark_excess_return_pct": excess,
        "benchmark": "SPY price return (price vs price; dividends excluded on both sides)",
        "recent_distributions": recent,
        "distribution_frequency": freq,
        "distribution_source": source,
        "fetched_at": int(time.time()),
        "demo": p.mode == "demo" or is_demo_symbol(symbol),
    }
