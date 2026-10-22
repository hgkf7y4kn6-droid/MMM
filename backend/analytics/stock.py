"""Stock-level views: the free analysis matrix and the Pro analyses.

These assemble Metrics from analytics.growth / fundamentals / capital into
the JSON the app renders. No formula lives here.
"""
from __future__ import annotations

from analytics import capital, fundamentals as f
from analytics.growth import consistency, increase_streak, series_cagr, yoy
from analytics.metric import Metric, missing, not_applicable, ok, spread
from analytics.models import BenchmarkAggregates, CompanyFundamentals

HISTORY_YEARS = 5


def _m(metric: Metric) -> dict:
    return metric.to_dict()


def _row(key: str, label: str, metric: Metric, *, help: str, higher_is_better: bool | None = True) -> dict:
    return {"key": key, "label": label, "help": help, "higher_is_better": higher_is_better, **_m(metric)}


def _estimate(value: float | None, kind: str | None, what: str) -> Metric:
    if value is None:
        return missing("pct", f"No {what} estimate from a licensed source.")
    return ok(value, "pct", notes=(f"Source: {kind}.",), inputs={"estimate_type": kind})


def dividend_yields(c: CompanyFundamentals) -> dict[str, Metric]:
    """Trailing (last 12 months of ex-dates), forward (indicated) and
    fiscal-year (latest FY dividends per share) yields -- three different
    numbers that are often all called "yield"."""
    q = c.quote
    latest = c.latest
    price = q.price if q else None
    out = {}
    for key, amount, formula in (
        ("trailing", q.trailing_dividends_12m if q else None, "dividends with ex-dates in the last 12 months ÷ price"),
        ("forward", q.indicated_annual_dividend if q else None, "latest regular dividend × payments per year ÷ price"),
        ("fiscal_year", latest.dividends_per_share if latest else None, "latest fiscal-year dividends per share ÷ price"),
    ):
        if price is None or price <= 0:
            out[key] = missing("pct", "No current price.", formula=formula)
        elif amount is None:
            out[key] = missing("pct", "Dividend amount unavailable.", formula=formula)
        elif amount == 0:
            out[key] = not_applicable("pct", "The company doesn't pay a dividend.", formula=formula)
        else:
            out[key] = ok(amount / price, "pct", formula=formula, inputs={"dividend": amount, "price": price},
                          period=q.as_of if q else None)
    return out


def matrix(c: CompanyFundamentals) -> dict:
    latest = c.latest
    if latest is None:
        return {"symbol": c.symbol, "sections": [], "status": "insufficient_data"}
    prior = c.year(latest.fiscal_year - 1)
    fcf = f.fcf_series(c.years)
    est = c.estimates
    kind = est.kind if est else None
    dps = c.series("dividends_per_share")
    yields = dividend_yields(c)

    sections = [
        {"key": "historical_growth", "label": "Historical growth", "tone": "green", "rows": [
            _row("revenue_cagr_5y", "Revenue CAGR (5y)", series_cagr(c.series("revenue"), HISTORY_YEARS),
                 help="Compound annual growth in revenue between the two fiscal years shown."),
            _row("eps_cagr_5y", "Diluted EPS CAGR (5y)", series_cagr(c.series("diluted_eps"), HISTORY_YEARS),
                 help="Compound annual growth in diluted earnings per share."),
            _row("fcf_cagr_5y", "Free cash flow CAGR (5y)", series_cagr(fcf, HISTORY_YEARS),
                 help="Compound annual growth in operating cash flow minus capital expenditures."),
            _row("dps_cagr_5y", "Dividend per share CAGR (5y)", series_cagr(dps, HISTORY_YEARS),
                 help="Compound annual growth in split-adjusted dividends per share."),
            _row("fcf_margin", "Free cash flow margin", f.fcf_margin(latest),
                 help="Share of each revenue dollar left as free cash flow."),
            _row("share_count_cagr_5y", "Share count change (5y, annualized)", f.share_count_cagr(c.years, HISTORY_YEARS),
                 help="Negative means net buybacks shrank the share count.", higher_is_better=False),
        ]},
        {"key": "projected_growth", "label": "Projected growth", "tone": "yellow", "source": kind, "rows": [
            _row("revenue_growth_3y", "Revenue growth (3y, annualized)", _estimate(est and est.revenue_growth_3y, kind, "revenue"),
                 help="Forward estimate. Its source (consensus, guidance or internal) is labeled."),
            _row("eps_growth_3y", "EPS growth (3y, annualized)", _estimate(est and est.eps_growth_3y, kind, "EPS"),
                 help="Forward estimate. Its source is labeled."),
            _row("dividend_growth_3y", "Dividend growth (3y, annualized)", _estimate(est and est.dividend_growth_3y, kind, "dividend"),
                 help="Shown only when a reliable estimate exists."),
            _row("fcf_growth_3y", "FCF growth (3y, annualized)", _estimate(est and est.fcf_growth_3y, kind, "free cash flow"),
                 help="Shown only when a reliable estimate exists."),
        ]},
        {"key": "capital_intensity", "label": "Capital allocation & intensity", "tone": "blue", "rows": [
            _row("roic", "Return on invested capital", f.roic(latest, prior),
                 help="After-tax operating profit per dollar of debt and equity capital in the business."),
            _row("capex_to_revenue", "Capex as % of revenue", f.capex_to_revenue(latest),
                 help="Lower means less capital is needed to run and grow the business.", higher_is_better=False),
            _row("revenue_to_capex", "Revenue to capex", f.revenue_to_capex(latest),
                 help="Revenue generated per dollar of capital spending."),
            _row("fcf_conversion", "FCF conversion", f.fcf_conversion(latest),
                 help="Free cash flow ÷ net income: how much of reported profit arrives as cash."),
            _row("reinvestment_rate", "Reinvestment rate", f.reinvestment_rate(latest),
                 help="Net new capital (capex − D&A + acquisitions) as a share of after-tax operating profit.",
                 higher_is_better=None),
            _row("buybacks_to_fcf", "Buybacks ÷ FCF", f.share_of_fcf(latest.share_repurchases, latest, "share_repurchases"),
                 help="Share repurchases relative to free cash flow.", higher_is_better=None),
            _row("dividends_to_fcf", "Dividends ÷ FCF", f.share_of_fcf(latest.dividends_paid, latest, "dividends_paid"),
                 help="Cash dividends relative to free cash flow.", higher_is_better=None),
            _row("distributions_to_fcf", "Total distributions ÷ FCF",
                 f.share_of_fcf(f.total_distributions(latest), latest, "total_distributions"),
                 help="Dividends plus buybacks relative to free cash flow; above 100% is funded by cash or debt.",
                 higher_is_better=None),
        ]},
        {"key": "balance_sheet", "label": "Balance sheet health", "tone": "pink", "rows": [
            _row("interest_coverage", "Interest coverage", f.interest_coverage(latest),
                 help="EBIT ÷ interest expense: how many times operating profit covers interest."),
            _row("net_debt_to_ebitda", "Net debt ÷ EBITDA", f.net_debt_to_ebitda(latest),
                 help="Years of EBITDA needed to repay net debt.", higher_is_better=False),
            _row("net_debt", "Net debt (negative = net cash)", f.net_debt(latest),
                 help="Total debt minus cash and short-term investments.", higher_is_better=False),
            _row("cash", "Cash & equivalents",
                 ok(latest.cash_and_equivalents, "usd", period=f"FY{latest.fiscal_year}") if latest.cash_and_equivalents is not None
                 else missing("usd", "Cash isn't reported."), help="Cash and equivalents at fiscal year end."),
        ]},
        {"key": "dividends", "label": "Dividends", "tone": "orange", "rows": [
            _row("yield_forward", "Forward yield", yields["forward"], help="Indicated annual dividend ÷ price."),
            _row("yield_trailing", "Trailing yield (12m)", yields["trailing"], help="Dividends paid in the last 12 months ÷ price."),
            _row("yield_fiscal_year", "Fiscal-year yield", yields["fiscal_year"], help="Latest fiscal-year dividends per share ÷ price."),
            _row("dps_cagr_5y_div", "Dividend CAGR (5y)", series_cagr(dps, HISTORY_YEARS),
                 help="Compound annual growth in dividends per share."),
            _row("dividend_streak", "Dividend growth streak", _streak(c, dps),
                 help="Consecutive years of dividend-per-share increases in the reported history."),
            _row("payout_ratio", "Payout ratio (EPS)", f.payout_ratio(latest),
                 help="Dividends per share ÷ diluted EPS.", higher_is_better=False),
            _row("fcf_payout_ratio", "FCF payout ratio", f.fcf_payout_ratio(latest),
                 help="Dividends paid ÷ free cash flow.", higher_is_better=False),
            _row("dividend_coverage", "Dividend coverage (FCF)", f.dividend_coverage(latest),
                 help="Free cash flow ÷ dividends paid; below 1.0x isn't covered by cash generation."),
        ]},
    ]
    return {
        "symbol": c.symbol, "name": c.name, "sector": c.sector, "fiscal_year": latest.fiscal_year,
        "currency": latest.currency, "business_model_note": c.business_model_note,
        "dividend_history": [{"year": y, "dps": v} for y, v in sorted(dps.items())],
        "sections": sections, "provenance": c.provenance.to_dict(),
    }


def _streak(c: CompanyFundamentals, dps: dict) -> Metric:
    if c.dividend_streak_verified is not None:
        return ok(c.dividend_streak_verified, "years", notes=("Verified by the data source.",))
    derived = increase_streak(dps)
    years = sorted(y for y, v in dps.items() if v is not None)
    if not years:
        return missing("years", "No dividend history.")
    note = ("Derived from the reported history only; the streak may be longer than the history shown."
            if derived == len(years) - 1 else "Derived from the reported history.")
    return ok(derived, "years", notes=(note,))


# ------------------------------------------------------------------ Pro
def _benchmark_meta(b: BenchmarkAggregates) -> dict:
    return {"name": b.name, "provenance": b.provenance.to_dict()}


def _aligned_cagr(series: dict, bench: dict, years: int) -> tuple[Metric, Metric]:
    """Company and benchmark CAGR over the same endpoints: the latest year both report."""
    common = sorted(y for y in series if series.get(y) is not None and bench.get(y) is not None)
    if not common:
        return missing("pct", "No overlapping years with the benchmark."), missing("pct", "No overlapping years.")
    end = common[-1]
    return series_cagr(series, years, end_year=end), series_cagr(bench, years, end_year=end, label="")


def fcf_analysis(c: CompanyFundamentals, b: BenchmarkAggregates, years: int = HISTORY_YEARS) -> dict:
    fcf = f.fcf_series(c.years)
    company, bench = _aligned_cagr(fcf, b.fcf_per_index_share, years)
    history = [{**row, "margin": f.fcf_margin(c.year(row["year"])).value,
                "operating_cash_flow": c.year(row["year"]).operating_cash_flow,
                "capital_expenditures": c.year(row["year"]).capital_expenditures} for row in yoy(fcf)]
    volatile = [r for r in history if r["growth"] is not None and abs(r["growth"]) > 0.5]
    notes = []
    if not company.ok and company.status == "not_meaningful":
        notes.append("A negative or zero endpoint makes CAGR misleading; use the annual history and average change.")
    if volatile:
        notes.append(f"Free cash flow moved more than 50% in {', '.join('FY' + str(r['year']) for r in volatile)}; "
                     "lumpy capex, working capital or one-off items can distort a single year.")
    return {
        "symbol": c.symbol, "years": years, "comparison": "trailing CAGR, same fiscal/calendar endpoints",
        "company_cagr": _m(company), "benchmark_cagr": _m(bench),
        "advantage_pp": _m(spread(company, bench, label="FCF growth advantage")),
        "history": history, "benchmark_history": [{"year": y, "value": v} for y, v in sorted(b.fcf_per_index_share.items())],
        "notes": notes, "methodology": (
            "Company FCF = operating cash flow − capital expenditures, per fiscal year. Benchmark = S&P 500 aggregate "
            "free cash flow per index share (constituent sums divided by the index divisor), so index membership "
            "changes don't register as growth. CAGR uses the latest year both series report and the year N years earlier."),
        "benchmark": _benchmark_meta(b), "provenance": c.provenance.to_dict(),
    }


def roic_analysis(c: CompanyFundamentals, b: BenchmarkAggregates) -> dict:
    latest = c.latest
    prior = c.year(latest.fiscal_year - 1) if latest else None
    current = f.roic(latest, prior) if latest else missing("pct", "No fiscal years.")
    ex_goodwill = f.roic(latest, prior, include_goodwill=False) if latest else missing("pct", "No fiscal years.")
    series = f.roic_series(c.years)
    bench_value = b.roic.get(latest.fiscal_year) if latest else None
    bench = ok(bench_value, "pct", period=f"{latest.fiscal_year}") if bench_value is not None else missing(
        "pct", "No benchmark ROIC for this year.")
    first = min(c.years, key=lambda fy: fy.fiscal_year) if c.years else None
    incremental = f.incremental_roic(first, latest) if first and latest and first is not latest else missing(
        "pct", "Needs at least two fiscal years.")
    notes = []
    if latest and latest.goodwill_and_intangibles and current.ok and ex_goodwill.ok and ex_goodwill.value > current.value * 1.5:
        notes.append("ROIC excluding goodwill is much higher: acquisitions are a large part of the capital base, so "
                     "the return on the price paid is lower than on the underlying operations.")
    return {
        "symbol": c.symbol, "current": _m(current), "excluding_goodwill": _m(ex_goodwill),
        "benchmark": _m(bench), "spread_pp": _m(spread(current, bench, label="ROIC spread")),
        "incremental": _m(incremental),
        "history": [{"year": y, "roic": v, "benchmark": b.roic.get(y)} for y, v in series.items()],
        "business_model_note": c.business_model_note, "notes": notes,
        "methodology": ("ROIC = NOPAT ÷ average invested capital. NOPAT = EBIT × (1 − effective tax rate), with the "
                        "21% statutory rate substituted when the effective rate is unmeasurable or outside 0–50%. "
                        "Invested capital = total debt + equity − cash − short-term investments, including goodwill "
                        "(an ex-goodwill figure is shown alongside). Incremental ROIC = Δ NOPAT ÷ Δ invested capital "
                        "over the history shown; it measures returns on new capital, not the existing base."),
        "benchmark_meta": _benchmark_meta(b), "provenance": c.provenance.to_dict(),
    }


def dividend_growth_analysis(c: CompanyFundamentals, b: BenchmarkAggregates, years: int = HISTORY_YEARS) -> dict:
    dps = c.series("dividends_per_share")
    company, bench = _aligned_cagr(dps, b.dps_per_index_share, years)
    latest = c.latest
    yields = dividend_yields(c)
    return {
        "symbol": c.symbol, "years": years,
        "company_cagr": _m(company), "benchmark_cagr": _m(bench),
        "advantage_pp": _m(spread(company, bench, label="dividend growth advantage")),
        "consistency": _m(consistency(dps, years)),
        "streak": _m(_streak(c, dps)),
        "history": yoy(dps),
        "benchmark_history": [{"year": y, "value": v} for y, v in sorted(b.dps_per_index_share.items())],
        "current_yield": _m(yields["forward"]), "benchmark_yield": b.dividend_yield,
        "payout_ratio": _m(f.payout_ratio(latest)) if latest else None,
        "fcf_payout_ratio": _m(f.fcf_payout_ratio(latest)) if latest else None,
        "coverage": _m(f.dividend_coverage(latest)) if latest else None,
        "methodology": ("Both sides are dividends per share: the company's split-adjusted dividends per share versus "
                        "S&P 500 dividends per index share. Total dividends paid by all constituents is a different "
                        "measure and isn't used. Growth uses the same endpoints for both; yield is shown separately "
                        "because a high yield and fast growth rarely come together."),
        "benchmark": _benchmark_meta(b), "provenance": c.provenance.to_dict(),
    }


def capital_allocation_analysis(c: CompanyFundamentals, years: int = HISTORY_YEARS) -> dict:
    ordered = sorted(c.years, key=lambda fy: fy.fiscal_year)
    window = ordered[-years:]
    latest = c.latest
    prior = c.year(latest.fiscal_year - 1) if latest else None
    current_roic = f.roic(latest, prior).value if latest else None
    rr = f.reinvestment_rate(latest).value if latest else None
    first = window[0] if window else None
    eps_effect = None
    if first and latest and first is not latest:
        span = latest.fiscal_year - first.fiscal_year
        ni = series_cagr(c.series("net_income"), span, end_year=latest.fiscal_year)
        sh = series_cagr(c.series("diluted_shares"), span, end_year=latest.fiscal_year)
        if ni.ok and sh.ok:
            eps_effect = _m(capital.buyback_eps_effect(ni.value, sh.value))
    return {
        "symbol": c.symbol,
        "by_year": [capital.allocation(fy) for fy in window],
        "cumulative": capital.cumulative_allocation(window),
        "implied_growth": _m(capital.implied_growth(current_roic, rr)),
        "required_reinvestment_for_10pct": _m(capital.required_reinvestment(0.10, current_roic)),
        "examples": capital.growth_model_examples(),
        "buyback_eps_effect": eps_effect,
        "caveats": [capital.GROWTH_MODEL_CAVEAT, capital.OVERLAP_NOTE,
                    "A high ROIC, fast dividend growth or a large shareholder payout is not, by itself, a reason to buy."],
        "provenance": c.provenance.to_dict(),
    }
