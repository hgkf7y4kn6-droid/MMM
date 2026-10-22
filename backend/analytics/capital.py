"""Capital allocation: where operating cash went, and the compounding math
that links returns on capital, reinvestment and growth.

The five uses (reinvestment, acquisitions, debt repayment, buybacks,
dividends) come from different lines of the cash flow statement and can
overlap or be funded from sources other than the year's cash flow (new debt,
cash on hand). They're shown side by side, each as a share of operating
cash flow and -- for the uses after capex -- of free cash flow, but they are
not presented as a partition that must add up to 100%.
"""
from __future__ import annotations

from analytics.fundamentals import free_cash_flow
from analytics.metric import Metric, missing, not_meaningful, ok
from analytics.models import FiscalYear

OVERLAP_NOTE = ("Allocation categories come from separate cash-flow lines; they can be funded by borrowing or cash "
                "on hand and may use different accounting definitions across companies, so they needn't sum to 100%.")


def _share(amount: float | None, base: float | None) -> float | None:
    if amount is None or base is None or base <= 0:
        return None
    return amount / base


def allocation(fy: FiscalYear) -> dict:
    """One fiscal year's capital allocation, amounts in reporting currency."""
    fcf = free_cash_flow(fy).value
    ocf = fy.operating_cash_flow
    net_debt_repaid = None
    if fy.debt_repaid is not None or fy.debt_issued is not None:
        net_debt_repaid = (fy.debt_repaid or 0) - (fy.debt_issued or 0)
    uses = [
        ("reinvestment", "Reinvesting in the business", fy.capital_expenditures, "capital expenditures"),
        ("acquisitions", "Mergers & acquisitions", fy.acquisitions, "cash paid for acquisitions, net of cash acquired"),
        ("debt_repayment", "Paying down debt", net_debt_repaid, "debt repaid − debt issued (negative = net borrowing)"),
        ("buybacks", "Share repurchases", fy.share_repurchases, "cash spent repurchasing shares"),
        ("dividends", "Dividends", fy.dividends_paid, "cash dividends paid to shareholders"),
    ]
    rows = []
    for key, label, amount, definition in uses:
        rows.append({
            "key": key, "label": label, "amount": amount, "definition": definition,
            "pct_of_operating_cash_flow": _share(amount, ocf),
            # Capex is what turns operating cash flow into FCF, so it has no share of FCF.
            "pct_of_free_cash_flow": None if key == "reinvestment" else _share(amount, fcf),
        })
    after_fcf = [r["amount"] for r in rows[1:] if r["amount"] is not None]
    remaining = fcf - sum(after_fcf) if fcf is not None and after_fcf else None
    return {
        "fiscal_year": fy.fiscal_year,
        "operating_cash_flow": ocf,
        "free_cash_flow": fcf,
        "uses": rows,
        "remaining_cash": remaining,
        "financing_requirement": -remaining if remaining is not None and remaining < 0 else 0 if remaining is not None else None,
        "note": OVERLAP_NOTE,
    }


def cumulative_allocation(years: list[FiscalYear]) -> dict | None:
    """Sum of each use over several years (a single year can be lumpy: one large
    acquisition, a debt refinancing)."""
    if not years:
        return None
    per_year = [allocation(fy) for fy in years]
    def total(values):
        vals = [v for v in values if v is not None]
        return sum(vals) if vals else None
    ocf = total(a["operating_cash_flow"] for a in per_year)
    fcf = total(a["free_cash_flow"] for a in per_year)
    uses = []
    for i, row in enumerate(per_year[0]["uses"]):
        amount = total(a["uses"][i]["amount"] for a in per_year)
        uses.append({**row, "amount": amount, "pct_of_operating_cash_flow": _share(amount, ocf),
                     "pct_of_free_cash_flow": None if row["key"] == "reinvestment" else _share(amount, fcf)})
    after = [u["amount"] for u in uses[1:] if u["amount"] is not None]
    remaining = fcf - sum(after) if fcf is not None and after else None
    first, last = years[0].fiscal_year, years[-1].fiscal_year
    return {"period": f"FY{first}–FY{last}", "operating_cash_flow": ocf, "free_cash_flow": fcf, "uses": uses,
            "remaining_cash": remaining,
            "financing_requirement": -remaining if remaining is not None and remaining < 0 else 0 if remaining is not None else None,
            "note": OVERLAP_NOTE}


# ------------------------------------------------------------ growth model
GROWTH_MODEL_CAVEAT = ("Simplified relationship: it assumes the return on new invested capital matches the figure "
                       "used and that reinvestment is measured consistently against after-tax operating profit. "
                       "Real growth also depends on pricing, margins, competition and the economic cycle.")


def implied_growth(return_on_new_capital: float | None, reinvestment_rate: float | None) -> Metric:
    """Approximate earnings growth = return on new capital × reinvestment rate."""
    if return_on_new_capital is None or reinvestment_rate is None:
        return missing("pct", "Needs both a return on capital and a reinvestment rate.")
    return ok(return_on_new_capital * reinvestment_rate, "pct", formula="ROIC × reinvestment rate",
              notes=(GROWTH_MODEL_CAVEAT,),
              inputs={"return_on_new_capital": return_on_new_capital, "reinvestment_rate": reinvestment_rate})


def required_reinvestment(target_growth: float, return_on_new_capital: float | None) -> Metric:
    """Approximate reinvestment rate needed = target growth ÷ return on new capital."""
    if return_on_new_capital is None:
        return missing("ratio", "Needs a return on capital.")
    if return_on_new_capital <= 0:
        return not_meaningful("ratio", "With a non-positive return on capital, reinvestment can't produce growth.")
    rate = target_growth / return_on_new_capital
    notes = [GROWTH_MODEL_CAVEAT]
    if rate > 1:
        notes.append("Above 100%: the growth target needs more capital than the business earns, i.e. outside funding.")
    return ok(rate, "ratio", formula="target growth ÷ ROIC", notes=tuple(notes),
              inputs={"target_growth": target_growth, "return_on_new_capital": return_on_new_capital})


def growth_model_examples(target_growth: float = 0.10) -> list[dict]:
    """The two illustrative businesses from the methodology: same modeled growth,
    very different cash left for shareholders."""
    out = []
    for label, r in (("Capital-light business", 0.50), ("Capital-intensive business", 0.10)):
        rate = required_reinvestment(target_growth, r)
        out.append({"label": label, "return_on_new_capital": r, "target_growth": target_growth,
                    "required_reinvestment_rate": rate.value,
                    "cash_available_for_shareholders": None if rate.value is None else max(0.0, 1 - rate.value)})
    return out


def buyback_eps_effect(net_income_growth: float, share_count_change: float) -> Metric:
    """EPS growth ≈ (1 + net income growth) ÷ (1 + share-count change) − 1."""
    if share_count_change <= -1:
        return not_meaningful("pct", "Share count change must be above −100%.")
    eps_growth = (1 + net_income_growth) / (1 + share_count_change) - 1
    return ok(eps_growth, "pct", formula="(1 + net income growth) ÷ (1 + share-count change) − 1",
              notes=("Buybacks lift EPS by shrinking the share count, but create value only when shares are bought "
                     "below intrinsic value; the cash could otherwise fund growth, debt reduction or dividends.",),
              inputs={"net_income_growth": net_income_growth, "share_count_change": share_count_change,
                      "buyback_contribution": eps_growth - net_income_growth})
