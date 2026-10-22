import pytest

from analytics import capital, fundamentals as f
from analytics.growth import cagr, consistency, increase_streak, series_cagr, yoy
from analytics.models import FiscalYear


def fy(year, **kw):
    return FiscalYear(fiscal_year=year, **kw)


# ------------------------------------------------------------------ CAGR
def test_cagr_known_value():
    m = cagr(100, 161.051, 5)
    assert m.ok and m.value == pytest.approx(0.10, abs=1e-9)


def test_cagr_negative_beginning_is_not_meaningful_and_keeps_the_change():
    m = cagr(-10, 10, 4)
    assert m.status == "not_meaningful" and m.value is None
    assert m.inputs["absolute_change"] == 20 and m.inputs["average_annual_change"] == 5


@pytest.mark.parametrize("begin,end", [(0, 10), (10, 0), (10, -5)])
def test_cagr_zero_or_negative_endpoints(begin, end):
    assert cagr(begin, end, 3).status == "not_meaningful"


def test_cagr_missing_is_never_zero():
    m = cagr(None, 10, 3)
    assert m.status == "insufficient_data" and m.value is None


def test_series_cagr_names_its_endpoints_and_needs_the_start_year():
    s = {2019: 100.0, 2020: None, 2021: 110, 2022: 120, 2023: 130, 2024: 146.41}
    m = series_cagr(s, 4)
    assert m.period == "FY2020–FY2024" and m.status == "insufficient_data"
    m5 = series_cagr(s, 5)
    assert m5.period == "FY2019–FY2024" and m5.value == pytest.approx(1.4641 ** 0.2 - 1)


def test_series_cagr_uses_latest_reported_year():
    s = {2020: 100.0, 2021: 121.0, 2022: None}
    assert series_cagr(s, 1).period == "FY2020–FY2021"


def test_yoy_skips_growth_from_a_loss():
    rows = yoy({2020: -5.0, 2021: 10.0, 2022: 12.0})
    assert rows[1]["growth"] is None and rows[1]["change"] == 15
    assert rows[2]["growth"] == pytest.approx(0.2)


def test_streak_stops_at_a_gap_or_cut():
    assert increase_streak({2019: 1.0, 2020: 1.1, 2021: 1.2, 2022: 1.3}) == 3
    assert increase_streak({2019: 1.0, 2020: 0.9, 2021: 1.0, 2022: 1.1}) == 2
    assert increase_streak({2019: 1.0, 2020: None, 2021: 1.0, 2022: 1.1}) == 1


def test_consistency():
    m = consistency({2019: 1.0, 2020: 1.1, 2021: 1.0, 2022: 1.2}, 3)
    assert m.value == pytest.approx(2 / 3)


# --------------------------------------------------------- fundamentals
BASE = dict(revenue=1000.0, operating_income=200.0, pretax_income=180.0, income_tax_expense=36.0,
            interest_expense=20.0, net_income=144.0, diluted_eps=1.44, depreciation_amortization=50.0,
            operating_cash_flow=250.0, capital_expenditures=70.0, acquisitions=30.0, debt_repaid=40.0,
            debt_issued=10.0, share_repurchases=60.0, dividends_paid=72.0, cash_and_equivalents=100.0,
            short_term_investments=0.0, total_debt=400.0, total_equity=700.0, goodwill_and_intangibles=300.0,
            dividends_per_share=0.72, diluted_shares=100.0)


def test_free_cash_flow_and_margins():
    y = fy(2024, **BASE)
    assert f.free_cash_flow(y).value == 180
    assert f.fcf_margin(y).value == pytest.approx(0.18)
    assert f.capex_to_revenue(y).value == pytest.approx(0.07)
    assert f.revenue_to_capex(y).value == pytest.approx(1000 / 70)
    assert f.fcf_conversion(y).value == pytest.approx(180 / 144)


def test_missing_capex_is_missing_fcf_not_ocf():
    m = f.free_cash_flow(fy(2024, operating_cash_flow=100.0))
    assert m.status == "insufficient_data" and m.value is None


def test_no_capex_means_revenue_to_capex_undefined():
    assert f.revenue_to_capex(fy(2024, revenue=10.0, capital_expenditures=0.0)).status == "not_meaningful"


def test_interest_coverage_cases():
    assert f.interest_coverage(fy(2024, **BASE)).value == pytest.approx(10)
    assert f.interest_coverage(fy(2024, operating_income=5.0, interest_expense=0.0)).status == "not_applicable"
    neg = f.interest_coverage(fy(2024, operating_income=-10.0, interest_expense=5.0))
    assert neg.value == pytest.approx(-2) and neg.notes   # kept, with a note


def test_net_debt_to_ebitda_cases():
    y = fy(2024, **BASE)
    assert f.net_debt(y).value == 300
    assert f.net_debt_to_ebitda(y).value == pytest.approx(300 / 250)
    cash_rich = fy(2024, total_debt=50.0, cash_and_equivalents=200.0, operating_income=10.0, depreciation_amortization=1.0)
    assert f.net_debt_to_ebitda(cash_rich).status == "not_applicable"
    loss = fy(2024, total_debt=500.0, cash_and_equivalents=10.0, ebitda=-20.0)
    assert f.net_debt_to_ebitda(loss).status == "not_meaningful"


def test_roic_uses_average_capital_and_effective_tax():
    prior = fy(2023, **{**BASE, "total_equity": 600.0})
    cur = fy(2024, **BASE)
    m = f.roic(cur, prior)
    nopat = 200 * (1 - 0.2)
    avg_ic = ((400 + 700 - 100) + (400 + 600 - 100)) / 2
    assert m.value == pytest.approx(nopat / avg_ic)
    assert m.inputs["tax_rate"] == pytest.approx(0.2)


def test_roic_without_prior_says_so():
    m = f.roic(fy(2024, **BASE), None)
    assert m.ok and any("ending invested capital" in n for n in m.notes)


def test_roic_statutory_rate_on_a_pretax_loss():
    y = fy(2024, **{**BASE, "pretax_income": -5.0, "income_tax_expense": 3.0})
    assert f.nopat(y).inputs["tax_rate"] == f.STATUTORY_TAX_RATE and f.nopat(y).notes


def test_roic_negative_capital_not_meaningful():
    y = fy(2024, **{**BASE, "total_equity": -800.0})
    assert f.roic(y, None).status == "not_meaningful"


def test_roic_ex_goodwill_is_higher():
    y = fy(2024, **BASE)
    assert f.roic(y, None, include_goodwill=False).value > f.roic(y, None).value


def test_incremental_roic():
    a = fy(2019, **{**BASE, "operating_income": 100.0, "total_equity": 500.0})
    b = fy(2024, **BASE)
    m = f.incremental_roic(a, b)
    assert m.value == pytest.approx((160 - 80) / 200)
    flat = f.incremental_roic(b, b)
    assert flat.status == "not_meaningful"


def test_payout_and_coverage():
    y = fy(2024, **BASE)
    assert f.payout_ratio(y).value == pytest.approx(0.5)
    assert f.fcf_payout_ratio(y).value == pytest.approx(0.4)
    assert f.dividend_coverage(y).value == pytest.approx(2.5)
    assert f.payout_ratio(fy(2024, dividends_per_share=1.0, diluted_eps=-0.5)).status == "not_meaningful"
    assert f.payout_ratio(fy(2024, dividends_per_share=0.0, diluted_eps=1.0)).status == "not_applicable"
    assert f.fcf_payout_ratio(fy(2024, dividends_paid=10.0, operating_cash_flow=5.0,
                                 capital_expenditures=10.0)).status == "not_meaningful"


def test_reinvestment_rate():
    m = f.reinvestment_rate(fy(2024, **BASE))
    assert m.value == pytest.approx((70 - 50 + 30) / 160)


def test_share_count_cagr_flags_buybacks():
    years = [fy(2019, diluted_shares=110.0), fy(2024, diluted_shares=100.0)]
    m = f.share_count_cagr(years, 5)
    assert m.value < 0 and "buybacks" in m.notes[0]


# -------------------------------------------------------- capital model
def test_allocation_shares_and_remaining_cash():
    a = capital.allocation(fy(2024, **BASE))
    uses = {u["key"]: u for u in a["uses"]}
    assert a["free_cash_flow"] == 180
    assert uses["reinvestment"]["pct_of_free_cash_flow"] is None
    assert uses["reinvestment"]["pct_of_operating_cash_flow"] == pytest.approx(70 / 250)
    assert uses["debt_repayment"]["amount"] == 30
    assert uses["dividends"]["pct_of_free_cash_flow"] == pytest.approx(0.4)
    assert a["remaining_cash"] == pytest.approx(180 - 30 - 30 - 60 - 72)
    assert a["financing_requirement"] == pytest.approx(12)


def test_growth_model_examples_match_the_methodology():
    light, heavy = capital.growth_model_examples(0.10)
    assert light["required_reinvestment_rate"] == pytest.approx(0.20)
    assert light["cash_available_for_shareholders"] == pytest.approx(0.80)
    assert heavy["required_reinvestment_rate"] == pytest.approx(1.00)
    assert heavy["cash_available_for_shareholders"] == pytest.approx(0.0)
    assert capital.implied_growth(0.5, 0.2).value == pytest.approx(0.10)


def test_required_reinvestment_flags_outside_funding():
    m = capital.required_reinvestment(0.10, 0.05)
    assert m.value == pytest.approx(2.0) and any("outside funding" in n for n in m.notes)
    assert capital.required_reinvestment(0.1, -0.1).status == "not_meaningful"


def test_buyback_eps_effect():
    m = capital.buyback_eps_effect(0.05, -0.02)
    assert m.value == pytest.approx(1.05 / 0.98 - 1)
    assert m.inputs["buyback_contribution"] > 0
