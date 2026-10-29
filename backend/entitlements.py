"""Free vs Pro, decided on the server for every request.

A user's plan comes only from the Subscription row written by verified
billing webhooks (billing.py), plus ADMIN_USER_IDS and COMPLIMENTARY_PRO_USER_IDS.
Pro endpoints depend on `require_feature(...)`, which answers 402 before any
Pro data is computed or fetched -- a Free client never receives the data, so
there's nothing for it to unhide.

Subscription states and access
    active, trialing        Pro until current_period_end (+ GRACE_DAYS, in case a renewal webhook is late)
    past_due                Pro until grace_until (provider's) or current_period_end + GRACE_DAYS
    canceled                Pro until current_period_end (they paid for it), then Free
    expired, paused,
    incomplete, none        Free

PRO_GATING=0 unlocks every Pro feature for everyone (staged rollout, as in DFS-Riches).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from auth import User, current_user, is_admin
from database import get_db
from models import Subscription

PRO_FEATURES = {
    "fcf_growth": "Free cash flow growth history and trend",
    "fcf_vs_benchmark": "Free cash flow growth vs the S&P 500",
    "roic": "ROIC history, ex-goodwill and incremental ROIC vs the S&P 500",
    "dividend_vs_benchmark": "Dividend growth vs the S&P 500",
    "capital_allocation": "Capital allocation intelligence",
    "portfolio_income_growth": "Portfolio dividend income growth and attribution",
    "portfolio_income_vs_benchmark": "Portfolio income growth vs the S&P 500",
    "portfolio_performance": "Portfolio total return vs the S&P 500, nine windows",
    "export": "CSV export of analytics",
}
FREE_FEATURES = {
    "matrix": "Stock analysis matrix (growth, intensity, balance sheet, dividends)",
    "dividend_history": "Dividend yield and dividend history",
    "portfolio_overview": "Holdings and estimated annual income",
    "data_export": "Export and delete your own data",
}
DEFAULT_GRACE_DAYS = 3
FREE_COMPARE_LIMIT = 2          # stocks side by side on Free; Pro: PRO_COMPARE_LIMIT
PRO_COMPARE_LIMIT = 8


def grace_days() -> int:
    try:
        return int(os.environ.get("GRACE_DAYS", DEFAULT_GRACE_DAYS))
    except ValueError:
        return DEFAULT_GRACE_DAYS


def gating_enabled() -> bool:
    return os.environ.get("PRO_GATING", "1") != "0"


def _ids(name: str) -> set[str]:
    return {u.strip() for u in os.environ.get(name, "").split(",") if u.strip()}


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)   # SQLite drops tzinfo


@dataclass(frozen=True)
class Entitlement:
    plan: str                    # free | pro
    status: str                  # none | active | trialing | grace | canceled | expired | admin | complimentary | ungated
    access_until: datetime | None = None
    cancel_at_period_end: bool = False
    provider: str | None = None

    @property
    def pro(self) -> bool:
        return self.plan == "pro"

    def allows(self, feature: str) -> bool:
        return feature not in PRO_FEATURES or self.pro or not gating_enabled()

    def to_dict(self) -> dict:
        return {
            "plan": self.plan, "status": self.status, "provider": self.provider,
            "access_until": self.access_until.isoformat() if self.access_until else None,
            "cancel_at_period_end": self.cancel_at_period_end, "gating": gating_enabled(),
            "features": {k: self.allows(k) for k in {**FREE_FEATURES, **PRO_FEATURES}},
            "compare_limit": PRO_COMPARE_LIMIT if self.pro or not gating_enabled() else FREE_COMPARE_LIMIT,
        }


def from_subscription(sub: Subscription | None, now: datetime | None = None) -> Entitlement:
    now = now or datetime.now(timezone.utc)
    if sub is None:
        return Entitlement("free", "none")
    end = _aware(sub.current_period_end)
    grace = timedelta(days=grace_days())
    kw = {"provider": sub.provider, "cancel_at_period_end": bool(sub.cancel_at_period_end)}
    if sub.status in ("active", "trialing"):
        if end is None or now <= end + grace:
            return Entitlement("pro", sub.status, end, **kw)
        return Entitlement("free", "expired", end, **kw)        # renewal never confirmed
    if sub.status == "past_due":
        until = _aware(sub.grace_until) or (end + grace if end else None)
        if until and now <= until:
            return Entitlement("pro", "grace", until, **kw)
        return Entitlement("free", "expired", until, **kw)
    if sub.status == "canceled":
        if end and now <= end:
            return Entitlement("pro", "canceled", end, **kw)
        return Entitlement("free", "expired", end, **kw)
    return Entitlement("free", sub.status if sub.status in ("expired", "paused", "incomplete") else "expired", end, **kw)


def resolve(user: User, db: Session, now: datetime | None = None) -> Entitlement:
    if is_admin(user):
        return Entitlement("pro", "admin")
    if user.id in _ids("COMPLIMENTARY_PRO_USER_IDS"):
        return Entitlement("pro", "complimentary")
    if not gating_enabled():
        return Entitlement("pro", "ungated")
    return from_subscription(db.get(Subscription, user.id), now)


async def entitlement(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Entitlement:
    return resolve(user, db)


def require_feature(feature: str):
    """Dependency for a Pro endpoint: 402 with a machine-readable body for Free accounts."""
    if feature not in PRO_FEATURES:
        raise ValueError(f"unknown Pro feature {feature!r}")

    async def check(ent: Entitlement = Depends(entitlement)) -> Entitlement:
        if not ent.allows(feature):
            raise HTTPException(status_code=402, detail={
                "code": "pro_required", "feature": feature, "label": PRO_FEATURES[feature],
                "message": f"{PRO_FEATURES[feature]} is part of KaventaFi Pro.", "status": ent.status,
            })
        return ent

    return check
