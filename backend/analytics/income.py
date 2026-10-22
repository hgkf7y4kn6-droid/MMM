"""Portfolio dividend income: history, growth, attribution and projection.

Three growth measures, never mixed:

Actual income growth
    income(Y) ÷ income(Y−1) − 1 over complete calendar years, from dividends
    actually received (cash and reinvested). Includes the effect of buying
    and selling.

Organic growth (comparable holdings)
    Σ q_i × DPS_i(Y) ÷ Σ q_i × DPS_i(Y−1) − 1 over comparable holdings, with
    q_i fixed at the shares held on 1 Jan Y. A holding is comparable when it
    was owned by 31 Jan Y−1 (a month's grace for a portfolio started on the
    first trading days of January), held continuously through 31 Dec Y, and
    paid the same number of dividends in both years (so a missed or extra
    payment can't masquerade as a rate change).
    It isolates dividend-rate changes; new money and new shares don't count.
    DPS is per share actually received (amount ÷ shares held), split-adjusted.

Projected forward income
    Current shares × indicated annual dividend per share. An estimate, kept
    apart from history.

Attribution of the year's change in income (sums exactly to the change):
    dividend rate changes   comparable holdings: q_i × (DPS_i(Y) − DPS_i(Y−1))
    share-count changes     comparable holdings: the rest of their change
                            (purchases, sales, reinvested dividends)
    new / partial positions holdings not held through both years (rises)
    exited / reduced        holdings not held through both years (falls)
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from analytics.growth import cagr, yoy
from analytics.models import BenchmarkAggregates, Ledger

DEFAULT_TARGET_GROWTH = 0.07
OPEN_GRACE_DAYS = 30        # a holding opened by 31 January counts as held for the whole year
OBJECTIVE_NOTE = ("A 7–10%+ annual income growth objective is a goal for the portfolio, not a guarantee. Dividends "
                  "can be cut or suspended, and past growth doesn't predict future growth.")


@dataclass(frozen=True)
class DividendEvent:
    day: date
    symbol: str
    amount: float
    shares: float           # held when paid, current (split-adjusted) basis
    dps: float              # amount ÷ shares, current basis


class Positions:
    """Share counts through time per symbol, all on the current split basis."""

    def __init__(self, ledger: Ledger):
        self.splits: dict[str, list[tuple[date, float]]] = defaultdict(list)
        for t in ledger.txns:
            if t.type == "split" and t.symbol and t.ratio:
                self.splits[t.symbol].append((t.day, t.ratio))
        # (day, adjusted shares after the event) per symbol, in ledger order
        self.timeline: dict[str, list[tuple[date, float]]] = defaultdict(list)
        self.events: list[DividendEvent] = []
        held: dict[str, float] = defaultdict(float)
        for t in ledger.txns:
            s = t.symbol
            if not s or t.type in ("deposit", "withdrawal", "fee"):
                continue
            f = self.factor_after(s, t.day)
            if t.type == "dividend" and t.amount:
                if held[s] > 1e-9:
                    self.events.append(DividendEvent(t.day, s, t.amount, held[s], t.amount / held[s]))
                continue
            if t.type == "reinvest":
                amount = (t.quantity or 0) * (t.price or 0)
                if held[s] > 1e-9 and amount:
                    self.events.append(DividendEvent(t.day, s, amount, held[s], amount / held[s]))
                held[s] += (t.quantity or 0) * f
            elif t.type in ("buy", "transfer_in"):
                held[s] += (t.quantity or 0) * f
            elif t.type in ("sell", "transfer_out"):
                held[s] = max(0.0, held[s] - (t.quantity or 0) * f)
            elif t.type == "split":
                continue   # the adjusted basis already accounts for it
            self.timeline[s].append((t.day, held[s]))

    def factor_after(self, symbol: str, day: date) -> float:
        """Product of split ratios after `day`: raw shares × factor = current-basis shares."""
        f = 1.0
        for d, r in self.splits.get(symbol, ()):
            if d > day:
                f *= r
        return f

    def shares_on(self, symbol: str, day: date, *, before: bool = True) -> float:
        """Adjusted shares at the start (before=True) or end of `day`."""
        q = 0.0
        for d, after in self.timeline.get(symbol, ()):
            if d < day or (not before and d == day):
                q = after
            else:
                break
        return q

    def held_throughout(self, symbol: str, opened_by: date, end: date) -> bool:
        """Owned at the end of `opened_by` and never fully sold through `end`."""
        if self.shares_on(symbol, opened_by, before=False) <= 1e-9:
            return False
        return all(after > 1e-9 for d, after in self.timeline.get(symbol, ()) if opened_by <= d <= end)


def income_by_year(events: list[DividendEvent]) -> dict[int, float]:
    out: dict[int, float] = defaultdict(float)
    for e in events:
        out[e.day.year] += e.amount
    return dict(out)


def analyze(ledger: Ledger, *, as_of: date, forward_dps: dict[str, float | None] | None = None,
            prices: dict[str, float | None] | None = None, benchmark: BenchmarkAggregates | None = None,
            target_growth: float = DEFAULT_TARGET_GROWTH) -> dict:
    pos = Positions(ledger)
    events = [e for e in pos.events if e.day <= as_of]
    if not events:
        return {"status": "insufficient_data", "reason": "No dividends recorded yet.", "objective_note": OBJECTIVE_NOTE}
    by_year = income_by_year(events)
    complete = {y: v for y, v in by_year.items() if y < as_of.year}
    first_year = min(by_year)
    # A year the portfolio only partly existed in isn't a full year of income.
    first_txn = ledger.txns[0].day
    if first_txn > date(first_year, 1, 1) + timedelta(days=OPEN_GRACE_DAYS):
        complete.pop(first_year, None)
    years = sorted(complete)

    sym_year: dict[tuple[str, int], tuple[float, float, int]] = defaultdict(lambda: (0.0, 0.0, 0))  # (income, dps, payments)
    for e in events:
        inc, dps, n = sym_year[(e.symbol, e.day.year)]
        sym_year[(e.symbol, e.day.year)] = (inc + e.amount, dps + e.dps, n + 1)
    symbols = sorted({e.symbol for e in events} | set(pos.timeline))

    annual = []
    for y in years:
        prev = complete.get(y - 1)
        row = {"year": y, "income": complete[y], "actual_growth": complete[y] / prev - 1 if prev else None,
               "organic_growth": None, "attribution": None, "comparable_holdings": []}
        if prev:
            row.update(_organic_and_attribution(y, pos, sym_year, symbols, complete[y] - prev))
        annual.append(row)

    income_cagr = None
    if len(years) >= 2:
        income_cagr = cagr(complete[years[0]], complete[years[-1]], years[-1] - years[0],
                           period=f"{years[0]}–{years[-1]}").to_dict()
    organic = [r["organic_growth"] for r in annual if r["organic_growth"] is not None]
    organic_avg = None
    if organic:
        g = 1.0
        for r in organic:
            g *= 1 + r
        organic_avg = g ** (1 / len(organic)) - 1

    forward = _forward(pos, as_of, forward_dps or {}, prices or {})
    last_full = complete[years[-1]] if years else None
    projected_growth = (forward["total"] / last_full - 1) if forward["total"] and last_full else None

    bench = _benchmark(benchmark, years) if benchmark else None
    latest_growth = annual[-1]["actual_growth"] if annual else None
    return {
        "status": "ok", "as_of": as_of.isoformat(),
        "annual": annual,
        "current_year_to_date": {"year": as_of.year, "income": by_year.get(as_of.year, 0.0), "partial": True},
        "income_cagr": income_cagr,
        "organic_growth_average": organic_avg,
        "forward": {**forward, "projected_growth_vs_last_full_year": projected_growth, "projected": True,
                    "note": "Projection: current shares × indicated annual dividend. Not a forecast of cuts or raises."},
        "objective": {
            "target_growth": target_growth,
            "latest_actual_growth": latest_growth,
            "latest_organic_growth": organic[-1] if organic else None,
            "status": _objective_status(organic[-1] if organic else latest_growth, target_growth),
            "note": OBJECTIVE_NOTE,
        },
        "benchmark": bench,
        "definitions": {
            "actual_growth": "Change in dividends received, complete calendar years, including purchases and sales.",
            "organic_growth": "Dividend-rate growth on holdings held through both years at a fixed share count.",
            "projected": "Current shares × indicated annual dividend per share.",
        },
        "objective_note": OBJECTIVE_NOTE,
    }


def _organic_and_attribution(y: int, pos: Positions, sym_year, symbols, total_change: float) -> dict:
    opened_by = date(y - 1, 1, 1) + timedelta(days=OPEN_GRACE_DAYS)
    start_y, end_y = date(y, 1, 1), date(y, 12, 31)
    num = den = 0.0
    rate = qty = opened = closed = 0.0
    comparable, contributions = [], []
    for s in symbols:
        inc1, dps1, n1 = sym_year.get((s, y), (0.0, 0.0, 0))
        inc0, dps0, n0 = sym_year.get((s, y - 1), (0.0, 0.0, 0))
        change = inc1 - inc0
        if pos.held_throughout(s, opened_by, end_y) and dps0 > 0 and n0 == n1:
            q = pos.shares_on(s, start_y)
            num += q * dps1
            den += q * dps0
            r = q * (dps1 - dps0)
            rate += r
            qty += change - r
            comparable.append(s)
        elif change >= 0:
            opened += change
        else:
            closed += change
        if inc0 or inc1:
            contributions.append({"symbol": s, "income": inc1, "prior_income": inc0, "change": change,
                                  "share_of_change": change / total_change if total_change else None,
                                  "comparable": s in comparable})
    contributions.sort(key=lambda c: -abs(c["change"]))
    return {
        "organic_growth": num / den - 1 if den > 0 else None,
        "comparable_holdings": comparable,
        "attribution": {"dividend_rate_changes": rate, "share_count_changes": qty,
                        "new_or_partial_positions": opened, "exited_or_reduced_positions": closed,
                        "total_change": total_change},
        "contributions": contributions,
    }


def _forward(pos: Positions, as_of: date, forward_dps: dict, prices: dict) -> dict:
    rows, total, value, missing = [], 0.0, 0.0, []
    for s in sorted(pos.timeline):
        q = pos.shares_on(s, as_of, before=False)
        if q <= 1e-9:
            continue
        dps = forward_dps.get(s)
        px = prices.get(s)
        income = q * dps if dps is not None else None
        if income is None:
            missing.append(s)
        else:
            total += income
        if px is not None:
            value += q * px
        rows.append({"symbol": s, "shares": q, "annual_dividend_per_share": dps, "annual_income": income,
                     "market_value": q * px if px is not None else None})
    for r in rows:
        r["share_of_income"] = r["annual_income"] / total if total and r["annual_income"] is not None else None
    have_all_prices = all(r["market_value"] is not None for r in rows)
    return {"total": total if rows else None, "by_holding": rows, "missing_dividend_data": missing,
            "portfolio_yield": total / value if value and have_all_prices and not missing else None}


def _benchmark(b: BenchmarkAggregates, years: list[int]) -> dict:
    hist = yoy(b.dps_per_index_share)
    by = {r["year"]: r["growth"] for r in hist}
    out = {"name": b.name, "measure": "S&P 500 dividends per index share",
           "label": ("Compared with S&P 500 dividends per index share (a per-share measure of a static index "
                     "holding), not total dividends paid by constituents."),
           "annual_growth": {y: by.get(y) for y in years}, "dividend_yield": b.dividend_yield,
           "provenance": b.provenance.to_dict(), "cagr": None}
    if len(years) >= 2:
        out["cagr"] = cagr(b.dps_per_index_share.get(years[0]), b.dps_per_index_share.get(years[-1]),
                           years[-1] - years[0], period=f"{years[0]}–{years[-1]}").to_dict()
    return out


def _objective_status(growth: float | None, target: float) -> str:
    if growth is None:
        return "insufficient_data"
    return "meeting_objective" if growth >= target else "below_objective"
