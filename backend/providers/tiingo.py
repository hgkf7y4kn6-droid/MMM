"""Tiingo adapter: daily prices (EOD), quotes and distributions, and annual
fundamentals statements (a paid Tiingo add-on).

The API key is sent as an Authorization header, never in a URL, so it can't
leak into access logs. Responses are cached (providers.cache) and a failed
refresh serves the last good copy.

Fundamentals data codes (FUNDAMENTALS_CODES below) follow Tiingo's published
definitions (GET /tiingo/fundamentals/definitions). They haven't been
verified against a live fundamentals subscription from this codebase --
check them there before launch; an unknown code simply leaves the field
None (shown as unavailable), never zero.
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import httpx

from analytics.models import (BenchmarkAggregates, CompanyFundamentals, FiscalYear, PricePoint, Provenance,
                              Quote)
from providers.base import ProviderUnavailable, SymbolNotFound
from providers.cache import cached

BASE = "https://api.tiingo.com"
LICENSE_NOTE = ("Market data from Tiingo, subject to Tiingo's terms. Redistribution to end users requires the "
                "appropriate Tiingo commercial license.")

# Our field <- (statement section, Tiingo dataCode, sign). sign=-1 flips a cash
# outflow reported as a negative number into our positive "cash spent".
FUNDAMENTALS_CODES = {
    "revenue": ("incomeStatement", "revenue", 1),
    "operating_income": ("incomeStatement", "ebit", 1),
    "pretax_income": ("incomeStatement", "ebt", 1),
    "income_tax_expense": ("incomeStatement", "taxExp", 1),
    "interest_expense": ("incomeStatement", "intexp", 1),
    "net_income": ("incomeStatement", "netinc", 1),
    "diluted_eps": ("incomeStatement", "epsDil", 1),
    "ebitda": ("incomeStatement", "ebitda", 1),
    "diluted_shares": ("incomeStatement", "shareswaDil", 1),
    "depreciation_amortization": ("cashFlow", "depamor", 1),
    "operating_cash_flow": ("cashFlow", "ncfo", 1),
    "capital_expenditures": ("cashFlow", "capex", -1),
    "dividends_paid": ("cashFlow", "payDiv", -1),
    "cash_and_equivalents": ("balanceSheet", "cashAndEq", 1),
    "short_term_investments": ("balanceSheet", "investmentsCurrent", 1),
    "total_debt": ("balanceSheet", "debt", 1),
    "total_equity": ("balanceSheet", "equity", 1),
    "goodwill_and_intangibles": ("balanceSheet", "intangibles", 1),
}
# Net figures split into their two sides.
NET_CODES = {
    "acquisitions": ("cashFlow", "businessAcqDisposals"),     # negative = net cash paid for acquisitions
    "debt": ("cashFlow", "issrepayDebt"),                      # negative = net repayment
    "equity": ("cashFlow", "issrepayEquity"),                  # negative = net buybacks
}


def _key() -> str:
    key = os.environ.get("TIINGO_API_KEY")
    if not key:
        raise ProviderUnavailable("Market data isn't configured (TIINGO_API_KEY).")
    return key


async def _get(path: str, params: dict | None = None):
    async with httpx.AsyncClient(timeout=20, headers={"Authorization": f"Token {_key()}"}) as client:
        resp = await client.get(f"{BASE}{path}", params=params)
    if resp.status_code == 404:
        raise SymbolNotFound(path)
    if resp.status_code in (401, 403):
        raise ProviderUnavailable("The market data subscription doesn't cover this request.")
    if resp.status_code == 429:
        raise ProviderUnavailable("Market data rate limit reached; try again shortly.")
    resp.raise_for_status()
    return resp.json()


def _split_adjusted_dividends(rows: list[dict]) -> list[tuple[date, float]]:
    """(ex-date, cash per current share) from EOD rows' divCash and splitFactor."""
    out, factor = [], 1.0
    for r in reversed(rows):
        d = date.fromisoformat(r["date"][:10])
        if r.get("divCash"):
            out.append((d, r["divCash"] / factor))
        if r.get("splitFactor") and r["splitFactor"] != 1:
            factor *= r["splitFactor"]
    return sorted(out)


REGULAR_FREQUENCIES = (1, 2, 4, 12)      # payments a year: annual, semi-annual, quarterly, monthly
SPECIAL_MULTIPLE = 1.8                   # a payment this many times the typical one is treated as a special


def indicated_annual_dividend(divs: list[tuple[date, float]], end: date) -> float:
    """Annual dividend per share implied by the *regular* payment schedule:
    the latest regular payment x the payment frequency.

    The frequency comes from the typical gap between payments (so five ex-dates
    squeezed into 365 days, or a late one pushed out of the window, doesn't
    change it), and a payment far above the typical amount is a special, not
    part of the run-rate. With a single payment in the year the frequency is
    unknowable and is taken as annual (an understatement for a new quarterly
    payer, never an overstatement). No payment in 365 days gives 0."""
    recent = [(d, a) for d, a in sorted(divs) if d > end - timedelta(days=365) and a > 0]
    if not recent:
        return 0.0
    amounts = sorted(a for _, a in recent)
    typical = amounts[len(amounts) // 2] if len(amounts) % 2 else (amounts[len(amounts) // 2 - 1] + amounts[len(amounts) // 2]) / 2
    regular = [(d, a) for d, a in recent if len(recent) < 3 or a <= SPECIAL_MULTIPLE * typical] or recent
    if len(regular) < 2:
        return regular[-1][1]
    gaps = sorted((b[0] - a[0]).days for a, b in zip(regular, regular[1:]))
    gap = gaps[len(gaps) // 2] if len(gaps) % 2 else (gaps[len(gaps) // 2 - 1] + gaps[len(gaps) // 2]) / 2
    freq = min(REGULAR_FREQUENCIES, key=lambda f: abs(365 / max(gap, 1) - f))
    return regular[-1][1] * freq


class TiingoProvider:
    name = "tiingo"

    async def _eod(self, symbol: str, start: date, end: date) -> list[dict]:
        key = f"tiingo:eod:{symbol}:{start}:{end}"
        res = await cached(key, 6 * 3600, lambda: _get(f"/tiingo/daily/{symbol}/prices",
                                                       {"startDate": start.isoformat(), "endDate": end.isoformat()}))
        return res.value

    async def daily(self, symbol: str, start: date, end: date) -> dict[date, PricePoint]:
        rows = await self._eod(symbol.upper(), start, end)
        return {date.fromisoformat(r["date"][:10]): PricePoint(date.fromisoformat(r["date"][:10]), r["close"], r["adjClose"])
                for r in rows if r.get("close") is not None and r.get("adjClose") is not None}

    async def quote(self, symbol: str) -> Quote:
        end = date.today()
        rows = await self._eod(symbol.upper(), end - timedelta(days=400), end)
        if not rows:
            raise SymbolNotFound(symbol)
        last = rows[-1]
        divs = _split_adjusted_dividends(rows)
        cutoff = end - timedelta(days=365)
        trailing = [a for d, a in divs if d > cutoff]
        indicated = indicated_annual_dividend(divs, end)
        return Quote(price=last["close"], as_of=last["date"][:10], trailing_dividends_12m=sum(trailing),
                     indicated_annual_dividend=indicated)

    async def search(self, query: str) -> list[dict]:
        if not query.strip():
            return []
        res = await cached(f"tiingo:search:{query.lower()}", 24 * 3600,
                           lambda: _get("/tiingo/utilities/search", {"query": query, "limit": 10}))
        return [{"symbol": r.get("ticker", "").upper(), "name": r.get("name"), "sector": None, "demo": False}
                for r in res.value if r.get("assetType") in ("Stock", "ETF") and r.get("ticker")]

    async def fundamentals(self, symbol: str) -> CompanyFundamentals:
        symbol = symbol.upper()
        res = await cached(f"tiingo:fund:{symbol}", 24 * 3600,
                           lambda: _get(f"/tiingo/fundamentals/{symbol}/statements",
                                        {"startDate": f"{date.today().year - 7}-01-01"}))
        meta = await cached(f"tiingo:meta:{symbol}", 24 * 3600, lambda: _get(f"/tiingo/daily/{symbol}"))
        end = date.today()
        eod = await self._eod(symbol, date(end.year - 7, 1, 1), end)
        dps_by_year: dict[int, float] = defaultdict(float)
        for d, amount in _split_adjusted_dividends(eod):
            dps_by_year[d.year] += amount
        years = []
        for stmt in res.value:
            if stmt.get("quarter") != 0:          # annual statements only
                continue
            data = stmt.get("statementData") or {}
            codes = {(sec, row["dataCode"]): row.get("value") for sec, rows in data.items() for row in rows or []}
            fields = {}
            for ours, (sec, code, sign) in FUNDAMENTALS_CODES.items():
                v = codes.get((sec, code))
                fields[ours] = None if v is None else sign * v
            acq = codes.get(NET_CODES["acquisitions"])
            fields["acquisitions"] = None if acq is None else max(0.0, -acq)
            debt = codes.get(NET_CODES["debt"])
            if debt is not None:
                fields["debt_repaid"], fields["debt_issued"] = max(0.0, -debt), max(0.0, debt)
            eq = codes.get(NET_CODES["equity"])
            fields["share_repurchases"] = None if eq is None else max(0.0, -eq)
            y = int(stmt["year"])
            fields["dividends_per_share"] = dps_by_year.get(y, 0.0 if fields.get("dividends_paid") == 0 else None)
            years.append(FiscalYear(fiscal_year=y, period_end=stmt.get("date", "")[:10] or None, **fields))
        if not years:
            raise ProviderUnavailable(f"No annual fundamentals for {symbol} in this subscription.")
        years.sort(key=lambda fy: fy.fiscal_year)
        quote = await self.quote(symbol)
        prov = Provenance(source="tiingo", retrieved_at=datetime.fromtimestamp(res.fetched_at, timezone.utc).isoformat(),
                          stale=res.stale, license_note=LICENSE_NOTE,
                          methodology="Annual statements (quarter 0). Dividends per share are calendar-year sums of "
                                      "split-adjusted distributions by ex-date, which can differ from fiscal years.")
        return CompanyFundamentals(symbol=symbol, name=meta.value.get("name") or symbol, sector=None, years=years,
                                   provenance=prov, quote=quote)


class SpyBenchmark:
    """S&P 500 total return via SPY's adjusted close (dividends reinvested, net of
    the ETF's expense ratio). Aggregates come from a licensed file, see providers.registry."""

    name = "tiingo-spy"

    def __init__(self, prices: TiingoProvider, aggregates: BenchmarkAggregates | None):
        self.prices, self.aggregates = prices, aggregates

    async def sp500_total_return(self, start: date, end: date):
        return await self.prices.daily("SPY", start, end), "total_return"

    async def sp500_aggregates(self) -> BenchmarkAggregates:
        if self.aggregates is None:
            raise ProviderUnavailable("S&P 500 aggregate fundamentals need a licensed dataset (SP500_AGGREGATES_FILE).")
        return self.aggregates
