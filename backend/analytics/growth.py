"""Growth rates over annual series: CAGR, year-over-year change, streaks.

Series are {fiscal_year: value} with None for a year the source didn't
report. Endpoints are explicit: a "5-year CAGR" uses the latest reported
year L and year L-5 (five compounding periods, six data points), and the
returned Metric names both years so the period is never ambiguous.
"""
from __future__ import annotations

from collections.abc import Mapping

from analytics.metric import Metric, missing, not_meaningful, ok

Series = Mapping[int, float | None]

CAGR_FORMULA = "(ending ÷ beginning)^(1 ÷ years) − 1"


def cagr(begin: float | None, end: float | None, years: float, *, period: str | None = None) -> Metric:
    """Compound annual growth from `begin` to `end` over `years`.

    Only defined for positive endpoints. With a zero or negative endpoint the
    conventional formula is either undefined or misleading (a move from -10
    to +10 isn't "-200% a year"), so the result is not_meaningful and carries
    the absolute change instead, for the annual-history view to explain.
    """
    if years <= 0:
        return not_meaningful("pct", "The period must be at least one year.", period=period)
    if begin is None or end is None:
        which = "beginning" if begin is None else "ending"
        return missing("pct", f"The {which} value isn't reported.", period=period, formula=CAGR_FORMULA)
    if begin <= 0 or end <= 0:
        which = "beginning" if begin <= 0 else "ending"
        sign = "zero" if (begin if which == "beginning" else end) == 0 else "negative"
        return not_meaningful(
            "pct",
            f"The {which} value is {sign}, so a compound growth rate isn't meaningful; "
            "see the annual history and average annual change instead.",
            period=period,
            formula=CAGR_FORMULA,
            inputs={"beginning": begin, "ending": end, "years": years,
                    "absolute_change": end - begin, "average_annual_change": (end - begin) / years},
        )
    value = (end / begin) ** (1 / years) - 1
    return ok(value, "pct", formula=CAGR_FORMULA, period=period,
              inputs={"beginning": begin, "ending": end, "years": years})


def latest_year(series: Series) -> int | None:
    years = [y for y, v in series.items() if v is not None]
    return max(years) if years else None


def series_cagr(series: Series, years: int, *, end_year: int | None = None, label: str = "FY") -> Metric:
    """CAGR between end_year (default: the latest reported year) and end_year - years."""
    end_year = end_year if end_year is not None else latest_year(series)
    if end_year is None:
        return missing("pct", "No reported values.")
    start_year = end_year - years
    period = f"{label}{start_year}–{label}{end_year}"
    if series.get(start_year) is None:
        reported = sorted(y for y, v in series.items() if v is not None)
        return missing("pct", f"Needs {label}{start_year}; history starts {label}{reported[0]}." if reported
                       else "No reported values.", period=period, formula=CAGR_FORMULA)
    return cagr(series.get(start_year), series.get(end_year), years, period=period)


def yoy(series: Series) -> list[dict]:
    """Each reported year with its change from the prior year. Growth is null
    where the prior year is missing or not positive (so a swing from a loss
    isn't shown as a percentage)."""
    out = []
    for year in sorted(series):
        value = series[year]
        prior = series.get(year - 1)
        growth = None
        if value is not None and prior is not None and prior > 0:
            growth = value / prior - 1
        out.append({"year": year, "value": value, "growth": growth,
                    "change": None if value is None or prior is None else value - prior})
    return out


def increase_streak(series: Series) -> int:
    """Consecutive most-recent years in which the value rose (strictly). A gap
    in the data ends the streak -- it can't be verified across a gap."""
    streak = 0
    year = latest_year(series)
    while year is not None:
        value, prior = series.get(year), series.get(year - 1)
        if value is None or prior is None or not value > prior:
            break
        streak += 1
        year -= 1
    return streak


def consistency(series: Series, years: int) -> Metric:
    """Share of the last `years` year-over-year changes that were increases."""
    end = latest_year(series)
    if end is None:
        return missing("ratio", "No reported values.")
    changes = []
    for y in range(end - years + 1, end + 1):
        value, prior = series.get(y), series.get(y - 1)
        if value is None or prior is None:
            return missing("ratio", f"FY{y - 1}–FY{y} isn't fully reported.", period=f"FY{end - years}–FY{end}")
        changes.append(value > prior)
    return ok(sum(changes) / len(changes), "ratio", period=f"FY{end - years}–FY{end}",
              formula="years with an increase ÷ years", inputs={"increases": sum(changes), "years": len(changes)})
