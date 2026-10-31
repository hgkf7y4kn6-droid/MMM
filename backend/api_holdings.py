"""Holdings and dividends the user enters by hand (Free). Pro links a brokerage instead.

    GET    /api/holdings                    lots, dividends, and a per-symbol summary
    POST   /api/holdings/lots               add a lot (symbol, shares, cost basis, date)
    PUT    /api/holdings/lots/{id}
    DELETE /api/holdings/lots/{id}
    POST   /api/holdings/dividends          record a dividend payment
    PUT    /api/holdings/dividends/{id}
    DELETE /api/holdings/dividends/{id}

The portfolio screens read these as the "manual" source (api_portfolio). Every
route is scoped to the verified caller; another user's id answers 404.
"""
from __future__ import annotations

import re
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from analytics.models import LedgerTxn
from auth import User, current_user
from database import get_db
from models import ManualDividend, ManualHolding

router = APIRouter(prefix="/api/holdings", tags=["holdings"])

MAX_LOTS = 500
MAX_DIVIDENDS = 5000
_SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")


def _symbol(v: str) -> str:
    v = (v or "").strip().upper()
    if not _SYMBOL.match(v):
        raise ValueError("Enter a ticker symbol, like VTI or BRK.B.")
    return v


def _past(v: date | None) -> date | None:
    if v is not None and not (date(1950, 1, 1) <= v <= date.today()):
        raise ValueError("Enter a date between 1950 and today.")
    return v


def _text(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


class LotIn(BaseModel):
    symbol: str = Field(max_length=15)
    shares: float = Field(gt=0, le=1e9)
    cost_basis: float | None = Field(None, ge=0, le=1e11)     # total paid for the lot, fees included
    acquired_on: date | None = None
    account_label: str | None = Field(None, max_length=60)
    notes: str | None = Field(None, max_length=500)

    @field_validator("symbol")
    @classmethod
    def _sym(cls, v: str) -> str:
        return _symbol(v)

    @field_validator("acquired_on")
    @classmethod
    def _day(cls, v: date | None) -> date | None:
        return _past(v)

    @field_validator("account_label", "notes")
    @classmethod
    def _txt(cls, v: str | None) -> str | None:
        return _text(v)


class DividendIn(BaseModel):
    symbol: str = Field(max_length=15)
    paid_on: date
    amount: float = Field(gt=0, le=1e9)
    reinvested: bool = False
    notes: str | None = Field(None, max_length=500)

    @field_validator("symbol")
    @classmethod
    def _sym(cls, v: str) -> str:
        return _symbol(v)

    @field_validator("paid_on")
    @classmethod
    def _day(cls, v: date) -> date:
        return _past(v)

    @field_validator("notes")
    @classmethod
    def _txt(cls, v: str | None) -> str | None:
        return _text(v)


def lot_out(h: ManualHolding) -> dict:
    return {"id": h.id, "symbol": h.symbol, "shares": h.shares, "cost_basis": h.cost_basis,
            "cost_per_share": round(h.cost_basis / h.shares, 4) if h.cost_basis is not None and h.shares else None,
            "acquired_on": h.acquired_on.isoformat() if h.acquired_on else None,
            "account_label": h.account_label, "notes": h.notes}


def dividend_out(d: ManualDividend) -> dict:
    return {"id": d.id, "symbol": d.symbol, "paid_on": d.paid_on.isoformat(), "amount": d.amount,
            "reinvested": d.reinvested, "notes": d.notes}


def summarize(lots: list[ManualHolding], divs: list[ManualDividend]) -> list[dict]:
    """Per symbol: shares, total cost basis (null if any lot's is unknown), average cost,
    dividends received in total and in the last 12 months."""
    out: dict[str, dict] = {}
    year_ago = date.today() - timedelta(days=365)
    for h in lots:
        s = out.setdefault(h.symbol, {"symbol": h.symbol, "shares": 0.0, "cost_basis": 0.0, "lots": 0,
                                      "dividends_total": 0.0, "dividends_12m": 0.0})
        s["shares"] += h.shares
        s["lots"] += 1
        s["cost_basis"] = None if s["cost_basis"] is None or h.cost_basis is None else s["cost_basis"] + h.cost_basis
    for d in divs:
        s = out.setdefault(d.symbol, {"symbol": d.symbol, "shares": 0.0, "cost_basis": None, "lots": 0,
                                      "dividends_total": 0.0, "dividends_12m": 0.0})
        s["dividends_total"] += d.amount
        if d.paid_on >= year_ago:
            s["dividends_12m"] += d.amount
    for s in out.values():
        s["avg_cost"] = round(s["cost_basis"] / s["shares"], 4) if s["cost_basis"] is not None and s["shares"] else None
        for k in ("cost_basis", "dividends_total", "dividends_12m"):
            if s[k] is not None:
                s[k] = round(s[k], 2)
    return sorted(out.values(), key=lambda s: s["symbol"])


def to_ledger(lots: list[ManualHolding], divs: list[ManualDividend]) -> tuple[list[LedgerTxn], list[str]]:
    """Manual entries -> the normalized ledger the portfolio analytics read.

    A lot with a date and cost basis is a buy at its average cost on that date. A lot
    without a date is an opening balance (a transfer in, valued at that day's close) the
    day before the earliest dated entry, or 30 days ago when nothing is dated. A dividend
    paid before any shares of that symbol are on the ledger is left out and noted."""
    notes: list[str] = []
    dated = [h.acquired_on for h in lots if h.acquired_on] + [d.paid_on for d in divs]
    opening_day = (min(dated) if dated else date.today() - timedelta(days=30)) - timedelta(days=1)
    txns: list[LedgerTxn] = []
    undated: list[str] = []
    for h in lots:
        if h.acquired_on:
            price = h.cost_basis / h.shares if h.cost_basis is not None else None
            kind = "buy" if price is not None else "transfer_in"
            txns.append(LedgerTxn(h.acquired_on, kind, h.symbol, h.shares, price, id=f"lot-{h.id}"))
        else:
            undated.append(h.symbol)
            txns.append(LedgerTxn(opening_day, "transfer_in", h.symbol, h.shares, None, id=f"lot-{h.id}"))
    # A dividend is paid on shares held before the pay day: one on or before the first
    # purchase day (or before the opening balance) has no shares on the ledger to come from.
    first_held: dict[str, date] = {}
    for t in txns:
        first_held[t.symbol] = min(first_held.get(t.symbol, t.day), t.day)
    skipped: set[str] = set()
    for d in divs:
        start = first_held.get(d.symbol)
        if start is None or d.paid_on <= start:
            skipped.add(d.symbol)
            continue
        txns.append(LedgerTxn(d.paid_on, "dividend", d.symbol, amount=d.amount, id=f"div-{d.id}"))
    if undated:
        notes.append(f"Lots without a purchase date ({', '.join(sorted(set(undated)))}) are counted from "
                     f"{opening_day.isoformat()}, valued at that day's price. Add dates for accurate returns.")
    if any(h.acquired_on and h.cost_basis is None for h in lots):
        notes.append("Dated lots without a cost basis are valued at the market price on their purchase date.")
    if skipped:
        notes.append(f"Dividends paid before your first recorded purchase of {', '.join(sorted(skipped))} were "
                     "left out of the analysis. Add the earlier purchase to include them.")
    txns.sort(key=lambda t: (t.day, 0 if t.type in ("buy", "transfer_in") else 1))
    return txns, notes


def _own(db: Session, model, user: User, item_id: str):
    row = db.get(model, item_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Not found.")
    return row


def _rows(db: Session, user: User):
    lots = db.query(ManualHolding).filter(ManualHolding.user_id == user.id).all()
    divs = db.query(ManualDividend).filter(ManualDividend.user_id == user.id).all()
    return lots, divs


@router.get("")
async def list_holdings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    lots, divs = _rows(db, user)
    lots.sort(key=lambda h: (h.symbol, h.acquired_on or date.min))
    divs.sort(key=lambda d: d.paid_on, reverse=True)
    return {"lots": [lot_out(h) for h in lots], "dividends": [dividend_out(d) for d in divs],
            "summary": summarize(lots, divs)}


@router.post("/lots", status_code=201)
async def add_lot(body: LotIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.query(ManualHolding).filter(ManualHolding.user_id == user.id).count() >= MAX_LOTS:
        raise HTTPException(status_code=400, detail=f"You can enter up to {MAX_LOTS} lots.")
    h = ManualHolding(id=uuid.uuid4().hex, user_id=user.id, **body.model_dump())
    db.add(h)
    db.commit()
    return lot_out(h)


@router.put("/lots/{lot_id}")
async def update_lot(lot_id: str, body: LotIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    h = _own(db, ManualHolding, user, lot_id)
    for k, v in body.model_dump().items():
        setattr(h, k, v)
    db.commit()
    return lot_out(h)


@router.delete("/lots/{lot_id}", status_code=204)
async def delete_lot(lot_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own(db, ManualHolding, user, lot_id))
    db.commit()


@router.post("/dividends", status_code=201)
async def add_dividend(body: DividendIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.query(ManualDividend).filter(ManualDividend.user_id == user.id).count() >= MAX_DIVIDENDS:
        raise HTTPException(status_code=400, detail=f"You can enter up to {MAX_DIVIDENDS} dividends.")
    d = ManualDividend(id=uuid.uuid4().hex, user_id=user.id, **body.model_dump())
    db.add(d)
    db.commit()
    return dividend_out(d)


@router.put("/dividends/{div_id}")
async def update_dividend(div_id: str, body: DividendIn, user: User = Depends(current_user),
                          db: Session = Depends(get_db)):
    d = _own(db, ManualDividend, user, div_id)
    for k, v in body.model_dump().items():
        setattr(d, k, v)
    db.commit()
    return dividend_out(d)


@router.delete("/dividends/{div_id}", status_code=204)
async def delete_dividend(div_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own(db, ManualDividend, user, div_id))
    db.commit()
