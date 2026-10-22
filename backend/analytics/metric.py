"""The result type every calculation in this package returns.

A financial figure is never just a number: it's a number *or* a reason
there isn't one. Missing inputs never become zero, a CAGR between a
negative and a positive endpoint is never forced into a percentage, and a
net-cash company never gets a misleading negative leverage ratio -- each of
those comes back as a Metric with no value and a status saying why.

Units
    pct     a fraction (0.12 means 12%); the app formats it as a percent
    pp      a difference of two pct values, in fraction form (0.04 = +4 pp)
    ratio   a plain ratio (0.45 payout, 1.8 coverage)
    x       a multiple (12.3x interest coverage)
    usd     money, in the statement's reporting currency
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Status = Literal["ok", "not_meaningful", "not_applicable", "insufficient_data"]
Unit = Literal["pct", "pp", "ratio", "x", "usd", "count", "years"]


@dataclass(frozen=True)
class Metric:
    value: float | None
    unit: Unit
    status: Status = "ok"
    reason: str | None = None
    formula: str | None = None
    period: str | None = None
    # Free-form calculation inputs, so a user can inspect how a number was made.
    inputs: dict[str, Any] = field(default_factory=dict)
    notes: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.status == "ok" and self.value is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": None if self.value is None else round(self.value, 6),
            "unit": self.unit,
            "status": self.status,
            "reason": self.reason,
            "formula": self.formula,
            "period": self.period,
            "inputs": self.inputs,
            "notes": list(self.notes),
        }


def ok(value: float, unit: Unit, **kw: Any) -> Metric:
    return Metric(value=value, unit=unit, status="ok", **kw)


def missing(unit: Unit, reason: str, **kw: Any) -> Metric:
    return Metric(value=None, unit=unit, status="insufficient_data", reason=reason, **kw)


def not_meaningful(unit: Unit, reason: str, **kw: Any) -> Metric:
    return Metric(value=None, unit=unit, status="not_meaningful", reason=reason, **kw)


def not_applicable(unit: Unit, reason: str, **kw: Any) -> Metric:
    return Metric(value=None, unit=unit, status="not_applicable", reason=reason, **kw)


def first_missing(**values: float | None) -> str | None:
    """The name of the first input that is None, for "missing X" reasons."""
    for name, v in values.items():
        if v is None:
            return name
    return None


def spread(a: Metric, b: Metric, *, label: str = "difference") -> Metric:
    """a - b in percentage points, only when both sides are real numbers."""
    if not a.ok or not b.ok:
        side = "company" if not a.ok else "benchmark"
        return missing("pp", f"No {label}: the {side} figure is unavailable.")
    return ok(a.value - b.value, "pp", formula="company − benchmark",
              inputs={"company": a.value, "benchmark": b.value}, period=a.period)
