"""Provider interfaces. Analytics and routes depend on these, never on a
vendor's payload shape, so a provider can be swapped (or a licensed one
added) without touching a formula."""
from __future__ import annotations

from datetime import date
from typing import Protocol

from analytics.models import BenchmarkAggregates, CompanyFundamentals, PricePoint, Quote


class ProviderUnavailable(Exception):
    """The provider isn't configured or couldn't answer; the message is safe to show."""


class SymbolNotFound(Exception):
    pass


class FundamentalsProvider(Protocol):
    name: str

    async def fundamentals(self, symbol: str) -> CompanyFundamentals: ...

    async def search(self, query: str) -> list[dict]: ...


class PriceProvider(Protocol):
    name: str

    async def daily(self, symbol: str, start: date, end: date) -> dict[date, PricePoint]: ...

    async def quote(self, symbol: str) -> Quote: ...


class BenchmarkProvider(Protocol):
    name: str

    async def sp500_aggregates(self) -> BenchmarkAggregates: ...

    async def sp500_total_return(self, start: date, end: date) -> tuple[dict[date, PricePoint], str]:
        """Daily benchmark series and its method: "total_return" or "price_return"."""
        ...
