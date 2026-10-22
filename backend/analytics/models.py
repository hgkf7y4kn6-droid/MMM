"""Normalized financial data, independent of any one provider.

Providers (providers/*.py) translate their own payloads into these types;
calculations (analytics/*.py) only ever read these types. Every dataset
carries a Provenance so the app can say where a number came from, when it
was retrieved and whether it is demo data.

Sign conventions (normalized at the provider boundary, never in a formula):
    capital_expenditures, acquisitions, debt_repaid, share_repurchases,
    dividends_paid    positive numbers = cash spent
    interest_expense  positive number
    everything else   as reported
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Literal


@dataclass(frozen=True)
class Provenance:
    source: str                     # "tiingo", "demo", ...
    retrieved_at: str               # ISO timestamp
    demo: bool = False
    license_note: str | None = None
    methodology: str | None = None
    stale: bool = False             # served from cache after a failed refresh

    def to_dict(self) -> dict:
        return {"source": self.source, "retrieved_at": self.retrieved_at, "demo": self.demo, "stale": self.stale,
                "license_note": self.license_note, "methodology": self.methodology}


@dataclass(frozen=True)
class FiscalYear:
    fiscal_year: int
    period_end: str | None = None
    currency: str = "USD"
    # Income statement
    revenue: float | None = None
    operating_income: float | None = None      # EBIT
    pretax_income: float | None = None
    income_tax_expense: float | None = None
    interest_expense: float | None = None
    net_income: float | None = None
    diluted_eps: float | None = None
    depreciation_amortization: float | None = None
    ebitda: float | None = None                # reported; else EBIT + D&A
    diluted_shares: float | None = None
    # Cash flow statement
    operating_cash_flow: float | None = None
    capital_expenditures: float | None = None
    acquisitions: float | None = None
    debt_repaid: float | None = None
    debt_issued: float | None = None
    share_repurchases: float | None = None
    dividends_paid: float | None = None
    # Balance sheet (period end)
    cash_and_equivalents: float | None = None
    short_term_investments: float | None = None
    total_debt: float | None = None
    total_equity: float | None = None
    goodwill_and_intangibles: float | None = None
    # Per share
    dividends_per_share: float | None = None   # declared for the fiscal year, split-adjusted


@dataclass(frozen=True)
class Estimates:
    """Forward estimates; `kind` keeps guidance, consensus and our own
    estimates apart -- they're never blended."""
    kind: Literal["consensus", "guidance", "internal"]
    revenue_growth_3y: float | None = None     # annualized, fraction
    eps_growth_3y: float | None = None
    dividend_growth_3y: float | None = None
    fcf_growth_3y: float | None = None
    analysts: int | None = None
    as_of: str | None = None


@dataclass(frozen=True)
class Quote:
    price: float | None
    as_of: str | None
    trailing_dividends_12m: float | None = None   # sum of ex-dates in the last 365 days
    indicated_annual_dividend: float | None = None  # latest regular payment × frequency


@dataclass
class CompanyFundamentals:
    symbol: str
    name: str
    sector: str | None
    years: list[FiscalYear]
    provenance: Provenance
    quote: Quote | None = None
    estimates: Estimates | None = None
    dividend_streak_verified: int | None = None    # from a source that tracks it; else derived
    business_model_note: str | None = None

    def series(self, attr: str) -> dict[int, float | None]:
        return {fy.fiscal_year: getattr(fy, attr) for fy in self.years}

    def year(self, fiscal_year: int) -> FiscalYear | None:
        return next((fy for fy in self.years if fy.fiscal_year == fiscal_year), None)

    @property
    def latest(self) -> FiscalYear | None:
        return max(self.years, key=lambda fy: fy.fiscal_year) if self.years else None


@dataclass(frozen=True)
class BenchmarkAggregates:
    """S&P 500 aggregates per index share (S&P's own index-level convention,
    like index EPS): summing constituents' values and dividing by the index
    divisor keeps constituent changes from showing up as growth.

    fcf_per_index_share, dps_per_index_share   {calendar_year: value}
    roic                                        {calendar_year: aggregate NOPAT ÷ aggregate invested capital}
    """
    name: str
    fcf_per_index_share: dict[int, float | None]
    dps_per_index_share: dict[int, float | None]
    roic: dict[int, float | None]
    dividend_yield: float | None
    provenance: Provenance


@dataclass(frozen=True)
class PricePoint:
    day: date
    close: float          # raw (unadjusted) close; splits are applied from the ledger
    adj_close: float      # split- and dividend-adjusted: a total-return series


TxnType = Literal["deposit", "withdrawal", "buy", "sell", "dividend", "reinvest",
                  "split", "fee", "transfer_in", "transfer_out"]


@dataclass(frozen=True)
class LedgerTxn:
    """One portfolio event. External flows (deposit, withdrawal, transfer_in,
    transfer_out) move money across the portfolio boundary and are never
    performance; dividends are income inside it.

    buy / sell / reinvest / transfer_in / transfer_out  symbol, quantity, price
    dividend                                            symbol, amount (cash received)
    split                                               symbol, ratio (2.0 = 2-for-1)
    deposit / withdrawal / fee                          amount (positive)
    """
    day: date
    type: TxnType
    symbol: str | None = None
    quantity: float | None = None
    price: float | None = None
    amount: float | None = None
    ratio: float | None = None
    fee: float = 0.0
    id: str | None = None

    def dedupe_key(self) -> tuple:
        return self.id or (self.day, self.type, self.symbol, self.quantity, self.price, self.amount, self.ratio)


@dataclass
class Ledger:
    txns: list[LedgerTxn] = field(default_factory=list)
    duplicates_dropped: int = 0

    @classmethod
    def from_txns(cls, txns: list[LedgerTxn]) -> Ledger:
        """Sorted by day with exact duplicates removed -- a re-synced statement
        can't double a dividend. Within a day: splits first (same-day trades use
        the post-split count), then deposits, then dividends (paid on shares
        held before the day's trades), then trades and withdrawals."""
        order = {"split": 0, "deposit": 1, "transfer_in": 2, "dividend": 3, "reinvest": 4, "buy": 5,
                 "sell": 6, "fee": 7, "withdrawal": 8, "transfer_out": 9}
        seen, out, dropped = set(), [], 0
        for t in sorted(txns, key=lambda t: (t.day, order[t.type])):
            key = t.dedupe_key()
            if key in seen:
                dropped += 1
                continue
            seen.add(key)
            out.append(t)
        return cls(out, dropped)

    @property
    def symbols(self) -> list[str]:
        return sorted({t.symbol for t in self.txns if t.symbol})
