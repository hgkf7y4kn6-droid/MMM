"""Single-year (and two-year, for averages) fundamentals ratios.

Every function takes normalized FiscalYear rows (analytics.models) and
returns a Metric. See docs/METHODOLOGY.md for each definition.
"""
from __future__ import annotations

from analytics.metric import Metric, first_missing, missing, not_applicable, not_meaningful, ok
from analytics.models import FiscalYear

# Used when a year's effective tax rate can't be measured (pre-tax loss) or
# is implausible (outside 0-50%, e.g. a one-off tax benefit); the substitution
# is always disclosed in the metric's notes.
STATUTORY_TAX_RATE = 0.21
TAX_RATE_BOUNDS = (0.0, 0.5)


def _period(fy: FiscalYear) -> str:
    return f"FY{fy.fiscal_year}"


def free_cash_flow(fy: FiscalYear) -> Metric:
    """FCF = operating cash flow − capital expenditures (capex as cash spent on
    property, plant and equipment, including capitalized software where the
    provider reports it there)."""
    name = first_missing(operating_cash_flow=fy.operating_cash_flow, capital_expenditures=fy.capital_expenditures)
    if name:
        return missing("usd", f"{name.replace('_', ' ').capitalize()} isn't reported.", period=_period(fy))
    return ok(fy.operating_cash_flow - fy.capital_expenditures, "usd", period=_period(fy),
              formula="operating cash flow − capital expenditures",
              inputs={"operating_cash_flow": fy.operating_cash_flow, "capital_expenditures": fy.capital_expenditures})


def fcf_series(years: list[FiscalYear]) -> dict[int, float | None]:
    return {fy.fiscal_year: free_cash_flow(fy).value for fy in years}


def _ratio(num: float | None, den: float | None, unit, *, num_name: str, den_name: str, period: str,
           formula: str, positive_den: bool = True, den_reason: str | None = None) -> Metric:
    name = first_missing(**{num_name: num, den_name: den})
    if name:
        return missing(unit, f"{name.replace('_', ' ').capitalize()} isn't reported.", period=period, formula=formula)
    if den == 0 or (positive_den and den < 0):
        return not_meaningful(unit, den_reason or f"{den_name.replace('_', ' ').capitalize()} isn't positive.",
                              period=period, formula=formula, inputs={num_name: num, den_name: den})
    return ok(num / den, unit, period=period, formula=formula, inputs={num_name: num, den_name: den})


def fcf_margin(fy: FiscalYear) -> Metric:
    return _ratio(free_cash_flow(fy).value, fy.revenue, "pct", num_name="free_cash_flow", den_name="revenue",
                  period=_period(fy), formula="free cash flow ÷ revenue")


def capex_to_revenue(fy: FiscalYear) -> Metric:
    return _ratio(fy.capital_expenditures, fy.revenue, "pct", num_name="capital_expenditures", den_name="revenue",
                  period=_period(fy), formula="capital expenditures ÷ revenue")


def revenue_to_capex(fy: FiscalYear) -> Metric:
    return _ratio(fy.revenue, fy.capital_expenditures, "x", num_name="revenue", den_name="capital_expenditures",
                  period=_period(fy), formula="revenue ÷ capital expenditures",
                  den_reason="No capital expenditures were reported, so the ratio is undefined.")


def fcf_conversion(fy: FiscalYear) -> Metric:
    return _ratio(free_cash_flow(fy).value, fy.net_income, "ratio", num_name="free_cash_flow", den_name="net_income",
                  period=_period(fy), formula="free cash flow ÷ net income",
                  den_reason="Net income isn't positive, so conversion of earnings into cash isn't meaningful.")


def ebitda(fy: FiscalYear) -> float | None:
    if fy.ebitda is not None:
        return fy.ebitda
    if fy.operating_income is not None and fy.depreciation_amortization is not None:
        return fy.operating_income + fy.depreciation_amortization
    return None


def interest_coverage(fy: FiscalYear) -> Metric:
    """EBIT ÷ interest expense. A negative EBIT is kept (it means operating
    profit doesn't cover interest at all); no interest expense is n/a."""
    formula = "EBIT ÷ interest expense"
    name = first_missing(operating_income=fy.operating_income, interest_expense=fy.interest_expense)
    if name:
        return missing("x", f"{name.replace('_', ' ').capitalize()} isn't reported.", period=_period(fy), formula=formula)
    if fy.interest_expense <= 0:
        return not_applicable("x", "No interest expense was reported (little or no debt).", period=_period(fy),
                              formula=formula)
    notes = ("Operating income is negative: interest isn't covered by operating profit.",) if fy.operating_income < 0 else ()
    return ok(fy.operating_income / fy.interest_expense, "x", period=_period(fy), formula=formula, notes=notes,
              inputs={"ebit": fy.operating_income, "interest_expense": fy.interest_expense})


def net_debt(fy: FiscalYear) -> Metric:
    """Total debt − cash and equivalents − short-term investments. Negative
    means a net cash position."""
    name = first_missing(total_debt=fy.total_debt, cash_and_equivalents=fy.cash_and_equivalents)
    if name:
        return missing("usd", f"{name.replace('_', ' ').capitalize()} isn't reported.", period=_period(fy))
    value = fy.total_debt - fy.cash_and_equivalents - (fy.short_term_investments or 0)
    notes = () if fy.short_term_investments is not None else ("Short-term investments not reported; only cash is netted.",)
    return ok(value, "usd", period=_period(fy), formula="total debt − cash − short-term investments", notes=notes,
              inputs={"total_debt": fy.total_debt, "cash": fy.cash_and_equivalents,
                      "short_term_investments": fy.short_term_investments})


def net_debt_to_ebitda(fy: FiscalYear) -> Metric:
    formula = "net debt ÷ EBITDA"
    nd = net_debt(fy)
    e = ebitda(fy)
    if not nd.ok:
        return missing("x", nd.reason or "Net debt unavailable.", period=_period(fy), formula=formula)
    if e is None:
        return missing("x", "EBITDA isn't reported and can't be derived (needs EBIT and D&A).", period=_period(fy),
                       formula=formula)
    if nd.value <= 0:
        return not_applicable("x", "Net cash position: cash exceeds debt, so leverage is not a constraint.",
                              period=_period(fy), formula=formula, inputs={"net_debt": nd.value, "ebitda": e})
    if e <= 0:
        return not_meaningful("x", "EBITDA is negative, so the leverage multiple isn't meaningful.",
                              period=_period(fy), formula=formula, inputs={"net_debt": nd.value, "ebitda": e})
    return ok(nd.value / e, "x", period=_period(fy), formula=formula, inputs={"net_debt": nd.value, "ebitda": e})


def effective_tax_rate(fy: FiscalYear) -> tuple[float, str | None]:
    """The year's tax rate and, when the statutory rate was substituted, why."""
    if fy.pretax_income is None or fy.income_tax_expense is None:
        return STATUTORY_TAX_RATE, "Tax data not reported; the 21% U.S. statutory rate was used."
    if fy.pretax_income <= 0:
        return STATUTORY_TAX_RATE, "Pre-tax loss; the 21% U.S. statutory rate was used."
    rate = fy.income_tax_expense / fy.pretax_income
    lo, hi = TAX_RATE_BOUNDS
    if not lo <= rate <= hi:
        return STATUTORY_TAX_RATE, f"Effective rate {rate:.0%} is outside {lo:.0%}–{hi:.0%}; the 21% statutory rate was used."
    return rate, None


def nopat(fy: FiscalYear) -> Metric:
    if fy.operating_income is None:
        return missing("usd", "Operating income (EBIT) isn't reported.", period=_period(fy))
    rate, note = effective_tax_rate(fy)
    return ok(fy.operating_income * (1 - rate), "usd", period=_period(fy), formula="EBIT × (1 − tax rate)",
              notes=(note,) if note else (), inputs={"ebit": fy.operating_income, "tax_rate": rate})


def invested_capital(fy: FiscalYear, *, include_goodwill: bool = True) -> Metric:
    """Total debt + total equity − cash − short-term investments (the
    financing view of operating capital). include_goodwill=False also takes
    out goodwill and acquired intangibles, which shows the return on the
    underlying operations rather than on the price paid for acquisitions."""
    name = first_missing(total_debt=fy.total_debt, total_equity=fy.total_equity,
                         cash_and_equivalents=fy.cash_and_equivalents)
    if name:
        return missing("usd", f"{name.replace('_', ' ').capitalize()} isn't reported.", period=_period(fy))
    value = fy.total_debt + fy.total_equity - fy.cash_and_equivalents - (fy.short_term_investments or 0)
    if not include_goodwill:
        if fy.goodwill_and_intangibles is None:
            return missing("usd", "Goodwill and intangibles aren't reported.", period=_period(fy))
        value -= fy.goodwill_and_intangibles
    return ok(value, "usd", period=_period(fy),
              formula="debt + equity − cash − short-term investments" + ("" if include_goodwill else " − goodwill & intangibles"))


def roic(fy: FiscalYear, prior: FiscalYear | None, *, include_goodwill: bool = True) -> Metric:
    """ROIC = NOPAT ÷ average invested capital (this and the prior year end).
    Without a prior year it falls back to ending capital and says so."""
    formula = "NOPAT ÷ average invested capital"
    n = nopat(fy)
    ic = invested_capital(fy, include_goodwill=include_goodwill)
    if not n.ok:
        return missing("pct", n.reason, period=_period(fy), formula=formula)
    if not ic.ok:
        return missing("pct", ic.reason, period=_period(fy), formula=formula)
    ic_prior = invested_capital(prior, include_goodwill=include_goodwill) if prior else None
    notes = list(n.notes)
    if ic_prior is not None and ic_prior.ok:
        avg = (ic.value + ic_prior.value) / 2
    else:
        avg = ic.value
        notes.append("Prior-year invested capital unavailable; ending invested capital was used.")
    if avg <= 0:
        return not_meaningful("pct", "Invested capital isn't positive (e.g. large buybacks drove equity negative), "
                              "so ROIC isn't meaningful.", period=_period(fy), formula=formula,
                              inputs={"nopat": n.value, "average_invested_capital": avg})
    return ok(n.value / avg, "pct", period=_period(fy), formula=formula, notes=tuple(notes),
              inputs={"nopat": n.value, "average_invested_capital": avg, "tax_rate": n.inputs["tax_rate"]})


def roic_series(years: list[FiscalYear], *, include_goodwill: bool = True) -> dict[int, float | None]:
    by_year = {fy.fiscal_year: fy for fy in years}
    return {y: roic(fy, by_year.get(y - 1), include_goodwill=include_goodwill).value for y, fy in sorted(by_year.items())}


def incremental_roic(begin: FiscalYear, end: FiscalYear) -> Metric:
    """(NOPAT_end − NOPAT_begin) ÷ (IC_end − IC_begin): the return earned on
    capital added over the period. Differs from ROIC, which is the return on
    the whole existing base. Needs a material increase in invested capital --
    with little or negative added capital the ratio explodes or flips sign."""
    formula = "Δ NOPAT ÷ Δ invested capital"
    period = f"FY{begin.fiscal_year}–FY{end.fiscal_year}"
    n0, n1 = nopat(begin), nopat(end)
    c0, c1 = invested_capital(begin), invested_capital(end)
    for m in (n0, n1, c0, c1):
        if not m.ok:
            return missing("pct", m.reason, period=period, formula=formula)
    d_nopat, d_ic = n1.value - n0.value, c1.value - c0.value
    if c0.value <= 0 or d_ic <= 0.05 * abs(c0.value):
        return not_meaningful("pct", "Invested capital didn't grow materially (under 5%), so the return on new "
                              "capital can't be measured reliably.", period=period, formula=formula,
                              inputs={"delta_nopat": d_nopat, "delta_invested_capital": d_ic})
    return ok(d_nopat / d_ic, "pct", period=period, formula=formula,
              inputs={"delta_nopat": d_nopat, "delta_invested_capital": d_ic})


def payout_ratio(fy: FiscalYear) -> Metric:
    if fy.dividends_per_share == 0:
        return not_applicable("ratio", "No dividend was paid.", period=_period(fy))
    return _ratio(fy.dividends_per_share, fy.diluted_eps, "ratio", num_name="dividends_per_share",
                  den_name="diluted_eps", period=_period(fy), formula="dividends per share ÷ diluted EPS",
                  den_reason="EPS isn't positive: the dividend isn't covered by earnings this year.")


def fcf_payout_ratio(fy: FiscalYear) -> Metric:
    if fy.dividends_paid == 0:
        return not_applicable("ratio", "No dividend was paid.", period=_period(fy))
    return _ratio(fy.dividends_paid, free_cash_flow(fy).value, "ratio", num_name="dividends_paid",
                  den_name="free_cash_flow", period=_period(fy), formula="dividends paid ÷ free cash flow",
                  den_reason="Free cash flow isn't positive: dividends were funded from cash or borrowing.")


def dividend_coverage(fy: FiscalYear) -> Metric:
    if fy.dividends_paid == 0:
        return not_applicable("x", "No dividend was paid.", period=_period(fy))
    fcf = free_cash_flow(fy).value
    return _ratio(fcf, fy.dividends_paid, "x", num_name="free_cash_flow", den_name="dividends_paid",
                  period=_period(fy), formula="free cash flow ÷ dividends paid", positive_den=True)


def share_of_fcf(amount: float | None, fy: FiscalYear, what: str) -> Metric:
    return _ratio(amount, free_cash_flow(fy).value, "ratio", num_name=what, den_name="free_cash_flow",
                  period=_period(fy), formula=f"{what.replace('_', ' ')} ÷ free cash flow",
                  den_reason="Free cash flow isn't positive, so a share of it isn't meaningful.")


def total_distributions(fy: FiscalYear) -> float | None:
    if fy.dividends_paid is None and fy.share_repurchases is None:
        return None
    return (fy.dividends_paid or 0) + (fy.share_repurchases or 0)


def reinvestment_rate(fy: FiscalYear) -> Metric:
    """(capex − D&A + acquisitions) ÷ NOPAT: the share of after-tax operating
    profit put back into the business as net new capital. Working-capital
    changes aren't in the normalized statements, so they're excluded (noted)."""
    formula = "(capex − D&A + acquisitions) ÷ NOPAT"
    name = first_missing(capital_expenditures=fy.capital_expenditures,
                         depreciation_amortization=fy.depreciation_amortization)
    if name:
        return missing("ratio", f"{name.replace('_', ' ').capitalize()} isn't reported.", period=_period(fy), formula=formula)
    n = nopat(fy)
    if not n.ok:
        return missing("ratio", n.reason, period=_period(fy), formula=formula)
    net_reinvestment = fy.capital_expenditures - fy.depreciation_amortization + (fy.acquisitions or 0)
    if n.value <= 0:
        return not_meaningful("ratio", "NOPAT isn't positive, so a reinvestment rate isn't meaningful.",
                              period=_period(fy), formula=formula)
    return ok(net_reinvestment / n.value, "ratio", period=_period(fy), formula=formula,
              notes=("Excludes working-capital investment, which isn't in the normalized statements.",),
              inputs={"net_reinvestment": net_reinvestment, "nopat": n.value})


def share_count_cagr(years: list[FiscalYear], span: int) -> Metric:
    from analytics.growth import series_cagr

    m = series_cagr({fy.fiscal_year: fy.diluted_shares for fy in years}, span)
    if m.ok:
        direction = "shrinking (net buybacks)" if m.value < 0 else "growing (net issuance)"
        return ok(m.value, "pct", period=m.period, formula="CAGR of diluted shares", notes=(f"Share count {direction}.",),
                  inputs=m.inputs)
    return m
