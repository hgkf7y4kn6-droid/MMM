"""Demo data: four fictional companies, an illustrative S&P 500 benchmark and
a sample portfolio, used when no licensed provider is configured (and in
tests). Everything here is labeled demo=True and surfaced as such in the
app: none of it is market data, and the companies don't exist.

The companies are built to exercise the analytics, not to resemble anyone:
    DEMO-LITE  asset-light compounder: high ROIC, little capex, rising dividend
    DEMO-GRID  capital-intensive utility: low ROIC, heavy capex, high leverage
    DEMO-TURN  turnaround: negative FCF in the first year (CAGR not meaningful)
    DEMO-CASH  net-cash hardware maker: no dividend, buybacks only
"""
from __future__ import annotations

import random
import zlib
from datetime import date, datetime, timedelta, timezone

from analytics.models import (BenchmarkAggregates, CompanyFundamentals, Estimates, FiscalYear, LedgerTxn,
                              PricePoint, Provenance, Quote)
from providers.base import SymbolNotFound

DEMO_NOTE = "Illustrative demo data for fictional companies — not market data and not investment advice."
YEARS = range(2019, 2025)
POST_HISTORY_GROWTH = 1.05
HISTORY_START = date(2018, 1, 1)


def _provenance(methodology: str | None = None) -> Provenance:
    return Provenance(source="demo", retrieved_at=datetime.now(timezone.utc).isoformat(), demo=True,
                      license_note=DEMO_NOTE, methodology=methodology)


def _build(symbol, name, sector, note, *, rev0, rev_g, ebit_m, tax=0.21, debt0, debt_g=0.0, rate=0.045,
           da_pct, capex_pct, acq_pct=0.0, buyback_pct=0.0, equity0, cash0, gw, shares0, share_g, dps0, dps_g,
           sti=0.0, overrides=None, estimates=None, price0, drift, yield_boost):
    overrides = overrides or {}
    years, equity, debt = [], equity0, debt0
    for i, y in enumerate(YEARS):
        revenue = rev0 * (1 + rev_g) ** i
        ebit = revenue * ebit_m
        interest = debt * rate
        pretax = ebit - interest
        tax_exp = max(pretax, 0) * tax
        ni = pretax - tax_exp
        shares = shares0 * (1 + share_g) ** i
        dps = dps0 * (1 + dps_g) ** i
        da = revenue * da_pct
        row = dict(
            fiscal_year=y, period_end=f"{y}-12-31", revenue=revenue, operating_income=ebit, pretax_income=pretax,
            income_tax_expense=tax_exp, interest_expense=interest, net_income=ni, diluted_eps=ni / shares,
            depreciation_amortization=da, diluted_shares=shares, operating_cash_flow=ni + da,
            capital_expenditures=revenue * capex_pct, acquisitions=revenue * acq_pct,
            debt_repaid=debt * 0.08, debt_issued=debt * (0.08 + debt_g), share_repurchases=revenue * buyback_pct,
            dividends_paid=dps * shares, cash_and_equivalents=cash0 * (1 + rev_g) ** i, short_term_investments=sti,
            total_debt=debt, total_equity=equity, goodwill_and_intangibles=gw, dividends_per_share=dps,
        )
        row.update(overrides.get(y, {}))
        years.append(FiscalYear(**row))
        equity += row["net_income"] - row["dividends_paid"] - row["share_repurchases"]
        debt *= 1 + debt_g
    return {"symbol": symbol, "name": name, "sector": sector, "note": note, "years": years,
            "estimates": estimates, "price0": price0, "drift": drift, "yield_boost": yield_boost}


COMPANIES = {c["symbol"]: c for c in (
    _build("DEMO-LITE", "Lighthouse Software (demo)", "Technology",
           "Asset-light: growth needs little new capital, so most free cash flow can go to shareholders.",
           rev0=4_000e6, rev_g=0.12, ebit_m=0.32, debt0=2_000e6, da_pct=0.03, capex_pct=0.045, acq_pct=0.04,
           buyback_pct=0.06,
           equity0=5_000e6, cash0=1_500e6, gw=1_200e6, shares0=400e6, share_g=-0.015, dps0=1.20, dps_g=0.14,
           estimates=Estimates("internal", revenue_growth_3y=0.10, eps_growth_3y=0.12, dividend_growth_3y=0.11,
                               fcf_growth_3y=0.10, as_of="2025-01-15"),
           price0=60.0, drift=0.13, yield_boost=0.012),
    _build("DEMO-GRID", "Gridline Utilities (demo)", "Utilities",
           "Capital-intensive: regulated returns on a large asset base; growth is funded with new debt.",
           rev0=9_000e6, rev_g=0.04, ebit_m=0.26, debt0=20_000e6, debt_g=0.05, rate=0.04, da_pct=0.12,
           capex_pct=0.34, equity0=18_000e6, cash0=300e6, gw=2_000e6, shares0=700e6, share_g=0.01,
           dps0=2.40, dps_g=0.05, overrides={2021: {"capital_expenditures": 9_000e6 * 1.04 ** 2 * 0.45}},
           estimates=Estimates("internal", revenue_growth_3y=0.04, eps_growth_3y=0.05, as_of="2025-01-15"),
           price0=45.0, drift=0.03, yield_boost=0.04),
    _build("DEMO-TURN", "Turnwell Industrial (demo)", "Industrials",
           "Turnaround after a large acquisition: goodwill is a big share of capital, and free cash flow was negative.",
           rev0=6_000e6, rev_g=0.07, ebit_m=0.10, debt0=5_000e6, da_pct=0.05, capex_pct=0.06, acq_pct=0.02,
           equity0=6_000e6, cash0=600e6, gw=4_500e6, shares0=300e6, share_g=0.0, dps0=0.50, dps_g=0.08,
           overrides={2019: {"operating_cash_flow": 250e6, "operating_income": 180e6, "pretax_income": -45e6,
                             "income_tax_expense": 0.0, "net_income": -45e6, "diluted_eps": -0.15,
                             "acquisitions": 3_500e6},
                      2020: {"operating_cash_flow": 520e6}},
           price0=30.0, drift=0.08, yield_boost=0.015),
    _build("DEMO-CASH", "Cashmere Devices (demo)", "Technology",
           "Net cash and no dividend: shareholder returns come entirely from buybacks.",
           rev0=12_000e6, rev_g=0.06, ebit_m=0.18, debt0=1_000e6, da_pct=0.04, capex_pct=0.05, buyback_pct=0.08,
           equity0=15_000e6, cash0=6_000e6, sti=2_000e6, gw=500e6, shares0=1_000e6, share_g=-0.03,
           dps0=0.0, dps_g=0.0, price0=25.0, drift=0.10, yield_boost=0.0),
)}

BENCHMARK_SYMBOL = "SPY"


def _calendar(end: date) -> list[date]:
    out, d = [], HISTORY_START
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def demo_prices(symbol: str, end: date | None = None) -> dict[date, PricePoint]:
    """A deterministic random walk per symbol (same series every run)."""
    end = end or date.today()
    if symbol == BENCHMARK_SYMBOL:
        price0, drift, yb = 270.0, 0.08, 0.014
    elif symbol in COMPANIES:
        c = COMPANIES[symbol]
        price0, drift, yb = c["price0"], c["drift"], c["yield_boost"]
    else:
        raise SymbolNotFound(symbol)
    rng = random.Random(zlib.crc32(symbol.encode()))
    px = adj = price0
    out = {}
    for d in _calendar(end):
        out[d] = PricePoint(d, round(px, 4), round(adj, 4))
        shock = rng.gauss(drift / 252, 0.16 / 252 ** 0.5)
        px *= 1 + shock
        adj *= (1 + shock) * (1 + yb / 252)
    return out


class DemoProvider:
    """Fundamentals, prices and benchmark from the fictional dataset above."""

    name = "demo"

    async def fundamentals(self, symbol: str) -> CompanyFundamentals:
        c = COMPANIES.get(symbol.upper())
        if c is None:
            raise SymbolNotFound(symbol)
        latest = c["years"][-1]
        price = list(demo_prices(c["symbol"]).values())[-1].close
        # Demo dividends keep rising 5% a year after the last fiscal year (as in demo_ledger).
        dps_now = (latest.dividends_per_share or 0) * POST_HISTORY_GROWTH ** max(0, date.today().year - latest.fiscal_year)
        quote = Quote(price=price, as_of=date.today().isoformat(), trailing_dividends_12m=dps_now,
                      indicated_annual_dividend=dps_now)
        return CompanyFundamentals(symbol=c["symbol"], name=c["name"], sector=c["sector"], years=c["years"],
                                   provenance=_provenance(), quote=quote, estimates=c["estimates"],
                                   business_model_note=c["note"])

    async def search(self, query: str) -> list[dict]:
        q = query.strip().upper()
        return [{"symbol": s, "name": c["name"], "sector": c["sector"], "demo": True}
                for s, c in COMPANIES.items() if not q or q in s or q in c["name"].upper()]

    async def daily(self, symbol: str, start: date, end: date) -> dict[date, PricePoint]:
        return {d: p for d, p in demo_prices(symbol.upper(), end).items() if start <= d <= end}

    async def quote(self, symbol: str) -> Quote:
        c = await self.fundamentals(symbol)
        return c.quote

    async def sp500_aggregates(self) -> BenchmarkAggregates:
        return BenchmarkAggregates(
            name="S&P 500 (illustrative)",
            fcf_per_index_share={2019: 150.0, 2020: 140.0, 2021: 175.0, 2022: 180.0, 2023: 195.0, 2024: 215.0},
            dps_per_index_share={2019: 58.0, 2020: 58.5, 2021: 60.5, 2022: 67.0, 2023: 70.0, 2024: 74.5, 2025: 78.0},
            roic={2019: 0.095, 2020: 0.085, 2021: 0.11, 2022: 0.105, 2023: 0.10, 2024: 0.105},
            dividend_yield=0.013,
            provenance=_provenance("Illustrative round numbers in the shape of S&P 500 per-index-share aggregates; "
                                   "replace with a licensed dataset (SP500_AGGREGATES_FILE) for real comparisons."),
        )

    async def sp500_total_return(self, start: date, end: date) -> tuple[dict[date, PricePoint], str]:
        return await self.daily(BENCHMARK_SYMBOL, start, end), "total_return"


def demo_ledger(as_of: date | None = None) -> list[LedgerTxn]:
    """A sample portfolio: deposits, purchases, a sale, quarterly dividends
    (from each company's demo dividend per share) and one dividend reinvested."""
    as_of = as_of or date.today()
    cal = _calendar(as_of)
    px = {s: demo_prices(s, as_of) for s in COMPANIES}

    def on_or_after(d: date) -> date:
        return next(c for c in cal if c >= d)

    def price(s: str, d: date) -> float:
        return px[s][on_or_after(d)].close

    txns: list[LedgerTxn] = []
    held: dict[str, float] = {}

    def buy(d, s, qty):
        d = on_or_after(d)
        txns.append(LedgerTxn(d, "buy", s, qty, price(s, d), id=f"demo-buy-{s}-{d}"))
        held[s] = held.get(s, 0) + qty

    d0 = on_or_after(date(2019, 1, 2))
    txns.append(LedgerTxn(d0, "deposit", amount=30_000, id="demo-dep-1"))
    buy(d0, "DEMO-LITE", 150)
    buy(d0, "DEMO-GRID", 250)
    buy(d0, "DEMO-TURN", 200)
    events = [(date(2021, 3, 1), "deposit", 12_000), (date(2021, 3, 1), "buy", ("DEMO-CASH", 300)),
              (date(2022, 6, 1), "deposit", 6_000), (date(2022, 6, 1), "buy", ("DEMO-LITE", 60)),
              (date(2023, 9, 1), "sell", ("DEMO-GRID", 100))]
    for year in range(2019, as_of.year + 1):
        for month in (3, 6, 9, 12):
            pay = date(year, month, 15)
            if pay > as_of:
                break
            for when, kind, arg in [e for e in events if e[0] <= pay]:
                events.remove((when, kind, arg))
                if kind == "deposit":
                    txns.append(LedgerTxn(on_or_after(when), "deposit", amount=arg, id=f"demo-dep-{when}"))
                elif kind == "buy":
                    buy(when, *arg)
                else:
                    s, qty = arg
                    d = on_or_after(when)
                    txns.append(LedgerTxn(d, "sell", s, qty, price(s, d), id=f"demo-sell-{s}-{d}"))
                    held[s] -= qty
            for s, qty in held.items():
                fy = next((y for y in COMPANIES[s]["years"] if y.fiscal_year == min(year, 2024)), None)
                dps = (fy.dividends_per_share or 0) * POST_HISTORY_GROWTH ** max(0, year - 2024)
                if not dps or qty <= 0:
                    continue
                d = on_or_after(pay)
                if s == "DEMO-LITE" and (year, month) == (2023, 12):
                    p = price(s, d)
                    txns.append(LedgerTxn(d, "reinvest", s, qty * dps / 4 / p, p, id=f"demo-drip-{s}-{d}"))
                    held[s] += qty * dps / 4 / p
                else:
                    txns.append(LedgerTxn(d, "dividend", s, amount=qty * dps / 4, id=f"demo-div-{s}-{d}"))
    return txns
