"""Which providers serve a request.

MARKET_DATA_MODE   "live" (Tiingo) or "demo"; unset: live when TIINGO_API_KEY is set, else demo.
SP500_AGGREGATES_FILE
                   JSON with licensed S&P 500 per-index-share aggregates (format below). Without it,
                   live mode shows company figures with the benchmark side marked unavailable --
                   it never borrows the demo benchmark for a real stock.

Symbols starting with "DEMO-" always come from the demo dataset, in either mode,
so the app can show labeled previews.

Aggregates file:
    {"name": "S&P 500", "source": "...", "retrieved_at": "ISO", "license_note": "...", "methodology": "...",
     "dividend_yield": 0.013,
     "fcf_per_index_share": {"2019": 150.1, ...}, "dps_per_index_share": {...}, "roic": {...}}
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache

from analytics.models import BenchmarkAggregates, Provenance
from providers.demo import DemoProvider
from providers.tiingo import SpyBenchmark, TiingoProvider


def mode() -> str:
    explicit = os.environ.get("MARKET_DATA_MODE", "").strip().lower()
    if explicit in ("live", "demo"):
        return explicit
    return "live" if os.environ.get("TIINGO_API_KEY") else "demo"


def is_demo_symbol(symbol: str) -> bool:
    return symbol.upper().startswith("DEMO-")


def _series(raw: dict | None) -> dict[int, float | None]:
    return {int(k): (None if v is None else float(v)) for k, v in (raw or {}).items()}


def load_aggregates(path: str) -> BenchmarkAggregates:
    with open(path) as fh:
        raw = json.load(fh)
    return BenchmarkAggregates(
        name=raw.get("name", "S&P 500"),
        fcf_per_index_share=_series(raw.get("fcf_per_index_share")),
        dps_per_index_share=_series(raw.get("dps_per_index_share")),
        roic=_series(raw.get("roic")),
        dividend_yield=raw.get("dividend_yield"),
        provenance=Provenance(source=raw.get("source", "licensed file"), retrieved_at=raw.get("retrieved_at", ""),
                              license_note=raw.get("license_note"), methodology=raw.get("methodology")),
    )


UNAVAILABLE_BENCHMARK = BenchmarkAggregates(
    name="S&P 500", fcf_per_index_share={}, dps_per_index_share={}, roic={}, dividend_yield=None,
    provenance=Provenance(source="unavailable", retrieved_at="",
                          methodology="No licensed S&P 500 aggregate dataset is configured."))


@dataclass
class Providers:
    mode: str
    demo: DemoProvider
    live: TiingoProvider | None
    aggregates: BenchmarkAggregates | None

    def fundamentals_for(self, symbol: str):
        return self.demo if self.mode == "demo" or is_demo_symbol(symbol) else self.live

    def prices_for(self, symbol: str):
        return self.fundamentals_for(symbol)

    def benchmark_for(self, symbol: str | None = None):
        if self.mode == "demo" or (symbol and is_demo_symbol(symbol)):
            return self.demo
        return SpyBenchmark(self.live, self.aggregates)

    async def aggregates_for(self, symbol: str | None = None) -> BenchmarkAggregates:
        if self.mode == "demo" or (symbol and is_demo_symbol(symbol)):
            return await self.demo.sp500_aggregates()
        return self.aggregates or UNAVAILABLE_BENCHMARK


@lru_cache(maxsize=1)
def providers() -> Providers:
    m = mode()
    path = os.environ.get("SP500_AGGREGATES_FILE")
    return Providers(mode=m, demo=DemoProvider(), live=TiingoProvider() if m == "live" else None,
                     aggregates=load_aggregates(path) if path else None)
