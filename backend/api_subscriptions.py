"""The recurring bills a user tracks (Home and Subscriptions tabs).

Every route is scoped to the verified caller; an id belonging to someone else
answers 404, exactly like an id that doesn't exist, so ids can't be probed.
Available on every plan.
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from auth import User, current_user
from database import get_db
from models import TrackedSubscription

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])

MAX_PER_USER = 200
Billing = Literal["weekly", "monthly", "quarterly", "yearly"]
Status = Literal["active", "paused", "cancelled"]
CYCLE = {
    "weekly": relativedelta(weeks=1),
    "monthly": relativedelta(months=1),
    "quarterly": relativedelta(months=3),
    "yearly": relativedelta(years=1),
}
PER_MONTH = {"weekly": 52 / 12, "monthly": 1.0, "quarterly": 1 / 3, "yearly": 1 / 12}


def next_renewal(renewal: date, billing: str, today: date | None = None) -> date:
    """The first charge on or after today. Steps are always counted from the
    stored date, so a bill on the 31st lands on the last day of short months
    and returns to the 31st afterwards instead of drifting to the 28th."""
    today = today or date.today()
    step = CYCLE.get(billing, CYCLE["monthly"])
    n, current = 0, renewal
    while current < today:
        n += 1
        current = renewal + step * n
    return current


def monthly_cost(price: float, billing: str) -> float:
    return round(price * PER_MONTH.get(billing, 1.0), 2)


class SubscriptionIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    price: float = Field(ge=0, le=1_000_000)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    billing: Billing = "monthly"
    category: str | None = Field(default=None, max_length=40)
    plan: str | None = Field(default=None, max_length=80)
    payment_method: str | None = Field(default=None, max_length=80)
    status: Status = "active"
    start_date: date | None = None
    renewal_date: date
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str):
        v = v.strip()
        if not v:
            raise ValueError("Enter a name.")
        return v

    @field_validator("category", "plan", "payment_method", "notes")
    @classmethod
    def _strip(cls, v: str | None):
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("renewal_date", "start_date")
    @classmethod
    def _sane_date(cls, v: date | None):
        if v is not None and not (date(2000, 1, 1) <= v <= date.today() + relativedelta(years=10)):
            raise ValueError("Enter a date between 2000 and ten years from now.")
        return v

    @field_validator("currency")
    @classmethod
    def _upper(cls, v: str):
        return v.upper()

    @field_validator("price")
    @classmethod
    def _cents(cls, v: float):
        return round(v, 2)


def _out(s: TrackedSubscription, today: date | None = None) -> dict:
    nxt = next_renewal(s.renewal_date, s.billing, today)
    today = today or date.today()
    return {
        "id": s.id, "name": s.name, "price": s.price, "currency": s.currency, "billing": s.billing,
        "category": s.category, "plan": s.plan, "payment_method": s.payment_method, "status": s.status,
        "start_date": s.start_date.isoformat() if s.start_date else None,
        "renewal_date": nxt.isoformat(), "days_until_renewal": (nxt - today).days,
        "monthly_cost": monthly_cost(s.price, s.billing), "notes": s.notes,
    }


def _own(db: Session, user: User, sub_id: str) -> TrackedSubscription:
    s = db.get(TrackedSubscription, sub_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="Subscription not found.")
    return s


@router.get("")
async def list_subscriptions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The caller's subscriptions plus totals for the Home summary."""
    rows = [_out(s) for s in db.query(TrackedSubscription).filter(TrackedSubscription.user_id == user.id).all()]
    rows.sort(key=lambda r: (r["status"] != "active", r["days_until_renewal"], r["name"].lower()))
    active = [r for r in rows if r["status"] == "active"]
    currencies = sorted({r["currency"] for r in active})
    return {
        "subscriptions": rows,
        "summary": {
            "active_count": len(active),
            # Totals only make sense in one currency; mixed lists show per-item prices only.
            "currency": currencies[0] if len(currencies) == 1 else None,
            "monthly_total": round(sum(r["monthly_cost"] for r in active), 2) if len(currencies) <= 1 else None,
            "yearly_total": round(sum(r["monthly_cost"] for r in active) * 12, 2) if len(currencies) <= 1 else None,
            "next_renewal_date": min((r["renewal_date"] for r in active), default=None),
        },
    }


@router.post("", status_code=201)
async def create_subscription(body: SubscriptionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    count = db.query(TrackedSubscription).filter(TrackedSubscription.user_id == user.id).count()
    if count >= MAX_PER_USER:
        raise HTTPException(status_code=400, detail=f"You can track up to {MAX_PER_USER} subscriptions.")
    s = TrackedSubscription(id=uuid.uuid4().hex, user_id=user.id, **body.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return _out(s)


@router.get("/{sub_id}")
async def get_subscription(sub_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(_own(db, user, sub_id))


@router.put("/{sub_id}")
async def update_subscription(sub_id: str, body: SubscriptionIn, user: User = Depends(current_user),
                              db: Session = Depends(get_db)):
    s = _own(db, user, sub_id)
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return _out(s)


@router.delete("/{sub_id}", status_code=204)
async def delete_subscription(sub_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own(db, user, sub_id))
    db.commit()
