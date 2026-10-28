"""Portfolio endpoints.

Ledger sources
    linked   the caller's Plaid investment transactions (stored by the sync tasks)
    demo     the sample portfolio (providers.demo), labeled demo
    POST     a ledger in the request body (manually entered holdings); used
             only for that response, never stored

Free:  GET  /api/portfolio/overview   holdings, value and estimated annual income
Pro:   GET/POST /api/portfolio/performance   total return vs the S&P 500, nine windows
       GET/POST /api/portfolio/income        dividend income growth, attribution, vs the S&P 500
"""
from __future__ import annotations

import asyncio
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from analytics import income as income_engine, portfolio as perf_engine
from analytics.models import Ledger, LedgerTxn
from auth import User, current_user
from database import get_db
from entitlements import Entitlement, require_feature
from models import Holding, InvestmentTransaction
from plaid_ledger import to_ledger
from providers.base import ProviderUnavailable, SymbolNotFound
from providers.demo import demo_ledger
from providers.registry import providers

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])
MAX_SYMBOLS = 60
MAX_TXNS = 5000
Source = Literal["linked", "demo"]


class TxnIn(BaseModel):
    day: date
    type: Literal["deposit", "withdrawal", "buy", "sell", "dividend", "reinvest", "split", "fee",
                  "transfer_in", "transfer_out"]
    symbol: str | None = Field(None, max_length=15)
    quantity: float | None = Field(None, gt=0)
    price: float | None = Field(None, ge=0)
    amount: float | None = Field(None, ge=0)
    ratio: float | None = Field(None, gt=0)
    fee: float = Field(0.0, ge=0)
    id: str | None = Field(None, max_length=80)

    @field_validator("day")
    @classmethod
    def not_future(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("transaction dates can't be in the future")
        return v

    def to_txn(self) -> LedgerTxn:
        needs = {"buy": ("symbol", "quantity", "price"), "sell": ("symbol", "quantity", "price"),
                 "reinvest": ("symbol", "quantity", "price"), "transfer_in": ("symbol", "quantity", "price"),
                 "transfer_out": ("symbol", "quantity", "price"), "dividend": ("amount",), "split": ("symbol", "ratio"),
                 "deposit": ("amount",), "withdrawal": ("amount",), "fee": ("amount",)}[self.type]
        missing = [n for n in needs if getattr(self, n) is None]
        if missing:
            raise HTTPException(status_code=422, detail=f"A {self.type} on {self.day} needs {', '.join(missing)}.")
        return LedgerTxn(self.day, self.type, self.symbol.upper() if self.symbol else None, self.quantity, self.price,
                         self.amount, self.ratio, self.fee, self.id)


class LedgerIn(BaseModel):
    transactions: list[TxnIn] = Field(..., max_length=MAX_TXNS)
    target_growth: float = Field(income_engine.DEFAULT_TARGET_GROWTH, ge=0, le=1)


def _load_ledger(source: str, user: User, db: Session) -> tuple[Ledger, list[str], bool]:
    if source == "demo":
        return Ledger.from_txns(demo_ledger()), [], True
    rows = db.query(InvestmentTransaction).filter(InvestmentTransaction.user_id == user.id).all()
    held: dict[str, float] = {}
    holding_rows = db.query(Holding).filter(Holding.user_id == user.id).all()
    for h in holding_rows:
        held[h.ticker] = held.get(h.ticker, 0.0) + h.quantity
    # No rows means holdings haven't synced yet (not "holds nothing"): history only, as before.
    txns, notes = to_ledger(rows, held if holding_rows else None)
    return Ledger.from_txns(txns), notes, False


def _demo_ledger_symbols(ledger: Ledger) -> bool:
    return bool(ledger.symbols) and all(s.startswith("DEMO-") for s in ledger.symbols)


async def _market(ledger: Ledger, *, demo: bool):
    """Prices for every held symbol plus the benchmark, fetched concurrently."""
    if len(ledger.symbols) > MAX_SYMBOLS:
        raise HTTPException(status_code=422, detail=f"Up to {MAX_SYMBOLS} symbols are supported.")
    p = providers()
    start = ledger.txns[0].day - timedelta(days=10)
    end = date.today()
    use_demo = demo or p.mode == "demo"
    price_src = (lambda s: p.demo) if use_demo else p.prices_for
    bench_src = p.demo if use_demo else p.benchmark_for()
    try:
        results = await asyncio.gather(*(price_src(s).daily(s, start, end) for s in ledger.symbols),
                                       bench_src.sp500_total_return(start, end))
    except SymbolNotFound as exc:
        raise HTTPException(status_code=404, detail=f"No price history for {exc}.") from exc
    except ProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    *series, (bench, method) = results
    return dict(zip(ledger.symbols, series)), bench, method, use_demo


def _not_empty(ledger: Ledger, source: str):
    if not ledger.txns:
        raise HTTPException(status_code=404, detail={
            "code": "no_portfolio",
            "message": "No investment transactions yet. Link a brokerage account, or try the sample portfolio."
            if source == "linked" else "The ledger is empty."})


async def _performance(ledger: Ledger, notes: list[str], demo: bool, windows: str | None) -> dict:
    prices, bench, method, use_demo = await _market(ledger, demo=demo)
    wanted = [w.strip().upper() for w in windows.split(",")] if windows else None
    valid = dict(perf_engine.WINDOWS)
    if wanted and any(w not in valid for w in wanted):
        raise HTTPException(status_code=400, detail=f"Windows must be among {', '.join(valid)}.")
    out = perf_engine.performance(ledger, sorted(bench), prices, bench, benchmark_method=method, windows=wanted,
                                  benchmark_name="S&P 500 (illustrative)" if use_demo else "S&P 500 (SPY total return)")
    out["notes"] = notes + out.get("notes", [])
    out["demo"] = use_demo
    return out


async def _income(ledger: Ledger, notes: list[str], demo: bool, target: float, ent: Entitlement) -> dict:
    p = providers()
    use_demo = demo or p.mode == "demo"
    as_of = date.today()
    pos_symbols = ledger.symbols
    forward, last = {}, {}

    async def quote(s):
        try:
            q = await (p.demo if use_demo else p.prices_for(s)).quote(s)
            return s, q
        except (SymbolNotFound, ProviderUnavailable):
            return s, None
    for s, q in await asyncio.gather(*(quote(s) for s in pos_symbols)):
        forward[s] = q.indicated_annual_dividend if q else None
        last[s] = q.price if q else None
    bench = None
    if ent.allows("portfolio_income_vs_benchmark"):
        bench = await (p.demo.sp500_aggregates() if use_demo else p.aggregates_for())
        if not bench.dps_per_index_share:
            bench = None
    out = income_engine.analyze(ledger, as_of=as_of, forward_dps=forward, prices=last, benchmark=bench,
                                target_growth=target)
    out["notes"] = notes
    out["demo"] = use_demo
    return out


@router.get("/overview")
async def overview(source: Source = "linked", user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Free: current holdings, value and estimated annual income (no history, no benchmark)."""
    ledger, notes, demo = _load_ledger(source, user, db)
    _not_empty(ledger, source)
    p = providers()
    use_demo = demo or p.mode == "demo" or _demo_ledger_symbols(ledger)
    out = income_engine.analyze(ledger, as_of=date.today())
    pos = income_engine.Positions(ledger)
    holdings = []
    total_value = total_income = 0.0
    complete = True
    for s in ledger.symbols:
        shares = pos.shares_on(s, date.today(), before=False)
        if shares <= 1e-9:
            continue
        try:
            q = await (p.demo if use_demo else p.prices_for(s)).quote(s)
        except (SymbolNotFound, ProviderUnavailable):
            q = None
        value = shares * q.price if q and q.price is not None else None
        inc = shares * q.indicated_annual_dividend if q and q.indicated_annual_dividend is not None else None
        complete = complete and value is not None and inc is not None
        total_value += value or 0
        total_income += inc or 0
        holdings.append({"symbol": s, "shares": shares, "price": q.price if q else None, "market_value": value,
                         "annual_income": inc, "as_of": q.as_of if q else None})
    return {"holdings": holdings, "total_value": total_value, "estimated_annual_income": total_income,
            "estimated_yield": total_income / total_value if total_value and complete else None, "complete": complete,
            "income_received_ytd": (out.get("current_year_to_date") or {}).get("income"),
            "notes": notes, "demo": use_demo,
            "income_note": "Estimate: current shares × indicated annual dividend. Not a forecast."}


@router.get("/performance")
async def performance_linked(source: Source = "linked", windows: str | None = Query(None, max_length=60),
                             user: User = Depends(current_user), db: Session = Depends(get_db),
                             _: Entitlement = Depends(require_feature("portfolio_performance"))):
    ledger, notes, demo = _load_ledger(source, user, db)
    _not_empty(ledger, source)
    return await _performance(ledger, notes, demo or _demo_ledger_symbols(ledger), windows)


@router.post("/performance")
async def performance_posted(body: LedgerIn, windows: str | None = Query(None, max_length=60),
                             _: Entitlement = Depends(require_feature("portfolio_performance"))):
    ledger = Ledger.from_txns([t.to_txn() for t in body.transactions])
    _not_empty(ledger, "posted")
    return await _performance(ledger, [], _demo_ledger_symbols(ledger), windows)


@router.get("/income")
async def income_linked(source: Source = "linked", target: float = Query(income_engine.DEFAULT_TARGET_GROWTH, ge=0, le=1),
                        user: User = Depends(current_user), db: Session = Depends(get_db),
                        ent: Entitlement = Depends(require_feature("portfolio_income_growth"))):
    ledger, notes, demo = _load_ledger(source, user, db)
    _not_empty(ledger, source)
    return await _income(ledger, notes, demo or _demo_ledger_symbols(ledger), target, ent)


@router.post("/income")
async def income_posted(body: LedgerIn, ent: Entitlement = Depends(require_feature("portfolio_income_growth"))):
    ledger = Ledger.from_txns([t.to_txn() for t in body.transactions])
    _not_empty(ledger, "posted")
    return await _income(ledger, [], _demo_ledger_symbols(ledger), body.target_growth, ent)
