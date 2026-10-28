"""Portfolio valuation and performance versus a benchmark.

Replay
    The ledger (analytics.models.Ledger) is replayed onto the benchmark's
    trading calendar. Events on a non-trading day apply on the next trading
    day. Each day's value is cash + Σ shares × raw close; splits come from the
    ledger, so raw (unadjusted) closes are the right price to multiply by.

Time-weighted return (TWR)
    r_t = (V_t − F_t) ÷ V_{t−1} − 1, linked geometrically, where F_t is the
    day's net external flow (deposits, withdrawals and securities transferred
    in or out at market value), treated as arriving at the end of the day.
    New money therefore never counts as performance. Dividends are income
    inside the portfolio (they raise V_t as cash or shares), not flows, so
    they're counted once.

Money-weighted return (MWR)
    The IRR of: −V_start at the start, −F for each flow, +V_end at the end --
    the investor's own experience, which depends on when money was added.

Benchmark
    The benchmark's adjusted close: split- and dividend-adjusted, i.e. a
    total-return series with distributions reinvested (for SPY, net of the
    fund's expense ratio). A price-only benchmark is labeled as such.
"""
from __future__ import annotations

import math
from calendar import monthrange
from dataclasses import dataclass, field
from datetime import date, timedelta

from analytics.models import Ledger, PricePoint

WINDOWS = (("1D", "1 day"), ("1W", "1 week"), ("1M", "1 month"), ("3M", "3 months"), ("6M", "6 months"),
           ("YTD", "Year to date"), ("1Y", "1 year"), ("3Y", "3 years"), ("5Y", "5 years"))
ANNUALIZED_WINDOWS = ("3Y", "5Y")
MWR_WINDOWS = ("1Y", "3Y", "5Y")
MAX_PRICE_STALENESS = 5          # trading days a missing close may be carried forward
CHART_POINTS = 120
EXTERNAL = {"deposit", "withdrawal", "transfer_in", "transfer_out"}


def minus_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 - months, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, monthrange(year, month)[1]))


def window_target(key: str, end: date) -> date:
    """The calendar date a window starts from, before trading-day alignment."""
    if key == "1D":
        return end - timedelta(days=1)
    if key == "1W":
        return end - timedelta(days=7)
    if key == "YTD":
        return date(end.year - 1, 12, 31)
    months = {"1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36, "5Y": 60}[key]
    return minus_months(end, months)


@dataclass
class DayState:
    day: date
    value: float | None              # None: a held position had no usable price
    flow: float = 0.0                # net external flow, + in / − out
    dividends: float = 0.0
    stale_symbols: tuple[str, ...] = ()
    missing_symbols: tuple[str, ...] = ()


@dataclass
class Replay:
    days: list[DayState]
    implicit_funding: float = 0.0    # buys with no recorded deposit, treated as new capital
    implicit_funding_count: int = 0
    notes: list[str] = field(default_factory=list)
    final_shares: dict[str, float] = field(default_factory=dict)
    final_cash: float = 0.0


def replay(ledger: Ledger, calendar: list[date], prices: dict[str, dict[date, PricePoint]],
           *, implicit_funding: bool = True) -> Replay:
    """Value the ledger on each calendar day from its first event onward.

    With implicit_funding (the default) a buy that would push cash below
    zero is treated as funded by a deposit for the shortfall: user-entered
    ledgers usually list trades without the deposits that paid for them, and
    without this the purchase would look like a 100% gain on zero capital."""
    txns = ledger.txns
    if not txns or not calendar:
        return Replay([])
    first = txns[0].day
    days_cal = [d for d in calendar if d >= first] or []
    if not days_cal:
        return Replay([])
    cash = 0.0
    shares: dict[str, float] = {}
    last_px: dict[str, tuple[int, float]] = {}   # symbol -> (calendar index, close)
    out: list[DayState] = []
    i = 0
    funded, funded_n = 0.0, 0
    oversold: set[str] = set()
    for idx, day in enumerate(days_cal):
        flow = div = 0.0
        while i < len(txns) and txns[i].day <= day:
            t = txns[i]
            i += 1
            if t.type == "deposit":
                cash += t.amount or 0
                flow += t.amount or 0
            elif t.type == "withdrawal":
                cash -= t.amount or 0
                flow -= t.amount or 0
            elif t.type == "fee":
                cash -= t.amount or 0
            elif t.type == "dividend":
                cash += t.amount or 0
                div += t.amount or 0
            elif t.type == "split":
                if t.symbol in shares and t.ratio:
                    shares[t.symbol] *= t.ratio
            elif t.type in ("buy", "reinvest", "transfer_in"):
                qty, px = t.quantity or 0, t.price or 0
                shares[t.symbol] = shares.get(t.symbol, 0) + qty
                if t.type == "transfer_in":
                    flow += qty * px
                elif t.type == "reinvest":
                    div += qty * px            # dividend received and spent in one step
                else:
                    cost = qty * px + t.fee
                    if implicit_funding and cash - cost < -1e-9:
                        shortfall = cost - max(cash, 0.0)
                        cash += shortfall
                        flow += shortfall
                        funded += shortfall
                        funded_n += 1
                    cash -= cost
            elif t.type in ("sell", "transfer_out"):
                qty, px = t.quantity or 0, t.price or 0
                have = max(shares.get(t.symbol, 0.0), 0.0)
                if qty > have + 1e-9:
                    # Never go short: selling shares the ledger never saw bought would
                    # price a position that doesn't exist. Only the held part counts.
                    oversold.add(t.symbol)
                    fee_scale = have / qty if qty else 0.0
                    qty = have
                else:
                    fee_scale = 1.0
                if qty <= 1e-9:
                    continue
                shares[t.symbol] = have - qty
                if t.type == "transfer_out":
                    flow -= qty * px
                else:
                    cash += qty * px - t.fee * fee_scale
                if abs(shares[t.symbol]) < 1e-9:
                    shares.pop(t.symbol)
        value = cash
        stale, missing = [], []
        for sym, qty in shares.items():
            pp = prices.get(sym, {}).get(day)
            if pp is not None:
                last_px[sym] = (idx, pp.close)
                value += qty * pp.close
            elif sym in last_px and idx - last_px[sym][0] <= MAX_PRICE_STALENESS:
                value += qty * last_px[sym][1]
                stale.append(sym)
            else:
                missing.append(sym)
        out.append(DayState(day, None if missing else value, flow, div, tuple(stale), tuple(missing)))
    notes = []
    if funded_n:
        notes.append(f"{funded_n} purchase(s) had no recorded deposit; their cost (${funded:,.2f}) was treated as new "
                     "capital, not performance.")
    if oversold:
        notes.append(f"Sales of {', '.join(sorted(oversold))} exceeded the shares the ledger shows being bought and were "
                     "limited to the shares held; add the earlier purchases or an opening balance for complete results.")
    if ledger.duplicates_dropped:
        notes.append(f"{ledger.duplicates_dropped} duplicate transaction(s) were ignored.")
    return Replay(out, funded, funded_n, notes, {s: q for s, q in shares.items()}, cash)


def daily_returns(days: list[DayState]) -> list[float | None]:
    """r_t for each day (None on the first funded day and where a value is missing)."""
    out: list[float | None] = [None] * len(days)
    for t in range(1, len(days)):
        prev, cur = days[t - 1].value, days[t].value
        if prev is None or cur is None or prev <= 1e-9:
            continue
        out[t] = (cur - days[t].flow) / prev - 1
    return out


def xirr(flows: list[tuple[date, float]]) -> float | None:
    """Annualized IRR of dated cash flows (investor's view: money in negative).
    Bisection on [−99.99%, +1,000,000%] -- slower than Newton but can't diverge."""
    if len(flows) < 2 or not any(a < 0 for _, a in flows) or not any(a > 0 for _, a in flows):
        return None
    t0 = flows[0][0]

    def npv(rate: float) -> float:
        return sum(a / (1 + rate) ** ((d - t0).days / 365.0) for d, a in flows)

    lo, hi = -0.9999, 10000.0
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if abs(f_mid) < 1e-7:
            return mid
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


def _downsample(points: list[dict], n: int = CHART_POINTS) -> list[dict]:
    if len(points) <= n:
        return points
    step = (len(points) - 1) / (n - 1)
    return [points[round(i * step)] for i in range(n)]


def _max_drawdown(index: list[float]) -> float:
    peak, worst = -math.inf, 0.0
    for v in index:
        peak = max(peak, v)
        worst = min(worst, v / peak - 1)
    return worst


def performance(ledger: Ledger, calendar: list[date], prices: dict[str, dict[date, PricePoint]],
                benchmark: dict[date, PricePoint], *, benchmark_name: str = "S&P 500",
                benchmark_method: str = "total_return", windows: list[str] | None = None,
                as_of: date | None = None) -> dict:
    """Portfolio vs benchmark for each requested window (all nine by default)."""
    calendar = sorted(d for d in calendar if d in benchmark and (as_of is None or d <= as_of))
    rp = replay(ledger, calendar, prices)
    if not rp.days:
        return {"status": "insufficient_data", "reason": "No transactions, or no prices on or after the first one.",
                "windows": [], "notes": rp.notes}
    returns = daily_returns(rp.days)
    pos = {s.day: k for k, s in enumerate(rp.days)}
    end = rp.days[-1].day
    inception = next((s.day for s in rp.days if s.value and s.value > 0), None)
    results = []
    for key in windows or [k for k, _ in WINDOWS]:
        label = dict(WINDOWS)[key]
        results.append(_window(key, label, rp, returns, pos, calendar, benchmark, end, inception))
    latest = rp.days[-1]
    return {
        "status": "ok", "as_of": end.isoformat(), "inception": inception.isoformat() if inception else None,
        "current_value": latest.value, "windows": results, "notes": rp.notes,
        "benchmark": {"name": benchmark_name, "method": benchmark_method,
                      "label": ("Total return (distributions reinvested)" if benchmark_method == "total_return"
                                else "Price return only — excludes dividends; not comparable to total return")},
        "methodology": ("Time-weighted return, linked daily, with deposits, withdrawals and transfers removed as "
                        "external flows; dividends stay in the portfolio as income. The benchmark uses the same "
                        "start and end trading days. 3- and 5-year figures are shown cumulative and annualized; "
                        "shorter windows are cumulative only."),
    }


def _window(key, label, rp: Replay, returns, pos, calendar, benchmark, end, inception) -> dict:
    target = window_target(key, end)
    cal = [d for d in calendar if d <= end]
    if key == "1D":
        start = cal[-2] if len(cal) >= 2 else None
    else:
        before = [d for d in cal if d <= target]
        start = before[-1] if before else None
    base = {"key": key, "label": label, "start": start.isoformat() if start else None, "end": end.isoformat()}
    if start is None:
        return {**base, "status": "insufficient_history", "reason": "The benchmark history doesn't reach this far back."}
    if inception is None or inception > start:
        return {**base, "status": "insufficient_history", "inception": inception.isoformat() if inception else None,
                "reason": "The portfolio is younger than this window; returns over unequal periods aren't compared."}
    k0, k1 = pos[start], pos[end]
    seg = rp.days[k0:k1 + 1]
    if any(s.value is None for s in seg):
        missing = sorted({sym for s in seg for sym in s.missing_symbols})
        return {**base, "status": "insufficient_data",
                "reason": f"Missing price history for {', '.join(missing)}; the return can't be calculated reliably."}
    growth = 1.0
    port_index, rets = [1.0], []
    for k in range(k0 + 1, k1 + 1):
        r = returns[k]
        if r is None:
            return {**base, "status": "insufficient_data", "reason": f"No valuation on {rp.days[k].day.isoformat()}."}
        growth *= 1 + r
        rets.append(r)
        port_index.append(growth)
    twr = growth - 1
    b0, b1 = benchmark[start].adj_close, benchmark[end].adj_close
    bench = b1 / b0 - 1
    days = (end - start).days
    flows = sum(s.flow for s in seg[1:])
    dividends = sum(s.dividends for s in seg[1:])
    chart = _downsample([{"date": s.day.isoformat(), "portfolio": port_index[i] - 1,
                          "benchmark": benchmark[s.day].adj_close / b0 - 1, "value": s.value}
                         for i, s in enumerate(seg)])
    out = {
        **base, "status": "ok", "days": days,
        "portfolio_return": twr, "benchmark_return": bench, "excess_return_pp": twr - bench,
        "outcome": "outperformed" if twr > bench else "underperformed" if twr < bench else "matched",
        "start_value": seg[0].value, "end_value": seg[-1].value, "net_external_flows": flows,
        "dividends_received": dividends,
        "dividend_contribution": dividends / seg[0].value if seg[0].value else None,
        "dividend_contribution_note": "Approximate: dividends received ÷ starting value.",
        "chart": chart, "stale_prices": sorted({sym for s in seg for sym in s.stale_symbols}),
    }
    if key in ANNUALIZED_WINDOWS and days > 0:
        years = days / 365.25
        out["portfolio_annualized"] = (1 + twr) ** (1 / years) - 1
        out["benchmark_annualized"] = (1 + bench) ** (1 / years) - 1
        out["excess_annualized_pp"] = out["portfolio_annualized"] - out["benchmark_annualized"]
    if len(rets) >= 20:
        mean = sum(rets) / len(rets)
        sd = math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1))
        bench_series = [benchmark[s.day].adj_close for s in seg]
        b_rets = [bench_series[i] / bench_series[i - 1] - 1 for i in range(1, len(bench_series))]
        b_mean = sum(b_rets) / len(b_rets)
        b_sd = math.sqrt(sum((r - b_mean) ** 2 for r in b_rets) / (len(b_rets) - 1))
        out["volatility"] = sd * math.sqrt(252)
        out["benchmark_volatility"] = b_sd * math.sqrt(252)
        out["max_drawdown"] = _max_drawdown(port_index)
        out["benchmark_max_drawdown"] = _max_drawdown([b / b0 for b in bench_series])
    if key in MWR_WINDOWS:
        cash_flows = [(start, -seg[0].value)] + [(s.day, -s.flow) for s in seg[1:] if s.flow] + [(end, seg[-1].value)]
        out["money_weighted_annualized"] = xirr(cash_flows)
    return out
