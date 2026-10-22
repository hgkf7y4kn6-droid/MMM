# Financial methodology

Every figure the app shows comes from one calculation layer, `backend/analytics/`, which works only on
normalized data (`analytics/models.py`) and returns a `Metric`: a value **or** the reason there isn't one,
plus its formula, period, inputs and notes. UI code formats numbers but never calculates them.

## Ground rules

1. **Missing is never zero.** A missing input returns `insufficient_data` with the missing field named. The
   app shows "Not available", never `0`.
2. **Meaningless ratios aren't shown.** Undefined or misleading results return `not_meaningful`, for example
   a CAGR from a negative base or leverage on negative EBITDA. Results that don't apply return
   `not_applicable`, for example leverage for a net-cash company or payout ratios for a non-payer. The reason
   is always shown.
3. **Meaningful negatives are kept.** Negative interest coverage, negative FCF and negative growth are shown,
   with a note where needed.
4. **Explicit periods.** Every growth rate names its endpoints (`FY2019–FY2024`).
5. **Sources stay separate.** Historical actuals, company guidance, analyst consensus and internal estimates
   are labeled and never blended. With no licensed estimate source, projected rows say so.
6. **No single score.** The matrix shows separate measures and doesn't rank or recommend.

## Sign conventions (normalized at the provider boundary)

Capex, acquisitions, debt repaid, buybacks, dividends paid and interest expense are stored as **positive
cash spent**. Provider adapters flip signs. Formulas never do.

## Growth (`analytics/growth.py`)

| Measure | Formula | Period | Edge cases |
|---|---|---|---|
| CAGR | (end ÷ begin)^(1/years) − 1 | Latest reported year L and L−N (N periods, N+1 points) | Either endpoint ≤ 0 → `not_meaningful`, with absolute change and average annual change attached. A missing start year names the first year available. |
| Year-over-year | value ÷ prior − 1 | Consecutive fiscal years | Prior ≤ 0 or missing → growth null, change still shown |
| Increase streak | Consecutive latest years with a strict increase | Reported history | A gap ends the streak. When the streak covers the whole history it's flagged as possibly longer. A provider-verified streak is preferred. |
| Consistency | Years with an increase ÷ years | Last N changes | Any gap → `insufficient_data` |

## Company fundamentals (`analytics/fundamentals.py`)

| Measure | Formula | Notes |
|---|---|---|
| Free cash flow | Operating cash flow − capital expenditures | Capex as reported in investing cash flow, consistent across periods. Missing capex → no FCF. |
| FCF margin | FCF ÷ revenue | Revenue ≤ 0 → not meaningful |
| Capex % revenue / revenue ÷ capex | capex ÷ revenue; revenue ÷ capex | Zero capex → revenue ÷ capex undefined |
| FCF conversion | FCF ÷ net income | Net income ≤ 0 → not meaningful |
| Interest coverage | EBIT ÷ interest expense | No interest → n/a. Negative EBIT is kept, with a note. |
| Net debt | Total debt − cash − short-term investments | Negative = net cash. If short-term investments aren't reported, a note says so. |
| Net debt ÷ EBITDA | Net debt ÷ EBITDA (reported, else EBIT + D&A) | Net cash → n/a. EBITDA ≤ 0 → not meaningful. |
| NOPAT | EBIT × (1 − effective tax rate) | The effective rate is replaced with the 21% U.S. statutory rate (and disclosed) on a pre-tax loss, when tax data is missing, or when the rate is outside 0–50%. |
| Invested capital | Debt + equity − cash − short-term investments | Includes goodwill. The ex-goodwill variant also subtracts goodwill and intangibles. |
| ROIC | NOPAT ÷ average(IC_t, IC_t−1) | Without a prior year, ending IC is used and flagged. Average IC ≤ 0 (e.g. buybacks drove equity negative) → not meaningful. |
| Incremental ROIC | ΔNOPAT ÷ ΔIC over the history shown | Needs IC growth > 5% of the starting base, else not meaningful. Above 100% is flagged as sensitive. **Not** the same as ROIC on the existing base. |
| Payout ratio | DPS ÷ diluted EPS | EPS ≤ 0 → not meaningful. No dividend → n/a. |
| FCF payout ratio | Dividends paid ÷ FCF | FCF ≤ 0 → not meaningful |
| Dividend coverage | FCF ÷ dividends paid | Below 1.0x = not covered by cash generation |
| Buybacks / dividends / distributions ÷ FCF | amount ÷ FCF | FCF ≤ 0 → not meaningful |
| Reinvestment rate | (capex − D&A + acquisitions) ÷ NOPAT | Working-capital investment isn't in the normalized statements and is excluded (noted) |
| Share-count change | CAGR of diluted shares | Negative = net buybacks |

### Dividend yields (three different numbers)

- **Trailing:** dividends with ex-dates in the last 365 days ÷ last close.
- **Forward (indicated):** latest regular payment × payments in the last year ÷ last close.
- **Fiscal-year:** latest fiscal-year DPS ÷ last close.

## Capital allocation (`analytics/capital.py`)

The five uses come from separate cash-flow lines: capex, acquisitions net of cash acquired, debt repaid −
debt issued, repurchases, and dividends paid. Each is shown as a share of operating cash flow and, for the
uses after capex, a share of FCF. Remaining cash = FCF − (M&A + net debt repayment + buybacks + dividends).
A negative remainder is reported as a financing requirement (met by borrowing or existing cash). Categories
can overlap and needn't sum to 100%, and the app says so. A multi-year cumulative view smooths lumpy years.

**Growth model (illustrative):** growth ≈ ROIC × reinvestment rate. Its inverse is reinvestment needed =
target growth ÷ ROIC (above 100% means outside funding is required). Worked example: a business earning 50%
on new capital reaches 10% growth by reinvesting 20%, which leaves 80% for shareholders. A business earning
10% needs to reinvest 100% for the same growth. This assumes the measured return applies to new capital.

**Buybacks:** EPS growth ≈ (1 + net income growth) ÷ (1 + share-count change) − 1. A buyback creates value
only when shares are bought below intrinsic value.

## S&P 500 benchmark construction

- **Per index share.** Benchmark FCF and dividends are S&P 500 aggregates per index share: constituent sums
  divided by the index divisor, the same way S&P publishes index EPS and DPS. Membership changes therefore
  don't show up as growth, and the index is never an average of company growth rates.
- **Same endpoints.** Company and benchmark CAGRs use the latest year both report and the year N earlier.
  Fiscal years (company) and calendar years (index) can differ by a few months, which is disclosed.
- **Dividends per share vs dividends per share.** Company DPS growth is compared with index DPS growth,
  never with total dividends paid.
- **Benchmark ROIC.** Aggregate NOPAT ÷ aggregate invested capital.
- **Source.** A licensed dataset (`SP500_AGGREGATES_FILE`). Without one, live mode marks the benchmark side
  unavailable. It never borrows the demo series for a real stock.
- **Total return.** SPY adjusted close (split- and distribution-adjusted, i.e. dividends reinvested, net of
  the ETF's 0.0945% expense ratio). A price-only series is labeled "Price return only".

## Portfolio performance (`analytics/portfolio.py`)

- **Ledger.** Deposits, withdrawals, buys, sells, dividends, DRIP reinvestment, splits, fees and security
  transfers. Exact duplicates are dropped by id or content. Within a day: splits, then deposits, then
  dividends (paid on shares held before that day's trades), then trades.
- **Valuation.** Each benchmark trading day: cash + Σ shares × raw close (splits come from the ledger). A
  missing close is carried forward for up to 5 trading days (flagged). Beyond that the day has no valuation
  and windows that include it report missing price history.
- **TWR.** rₜ = (Vₜ − Fₜ) ÷ Vₜ₋₁ − 1, linked geometrically. Fₜ is the net external flow, treated as
  arriving at end of day. Dividends aren't flows, so they count once. **New money is never performance.**
- **Implicit funding.** A buy without a recorded deposit is treated as new capital for the shortfall, and a
  note says so.
- **Windows.** 1D (previous trading day), 1W, 1M, 3M, 6M, YTD (last trading day of the prior year), 1Y, 3Y,
  5Y. Each starts on the last trading day on or before the calendar target, and the benchmark uses the same
  start and end days. A portfolio younger than the window returns `insufficient_history`; returns over
  unequal periods are never compared.
- **Annualization.** Only 3Y and 5Y, shown alongside the cumulative figure: (1 + R)^(365.25/days) − 1.
- **MWR.** IRR (bisection) of −V_start, −flows and +V_end, for 1Y, 3Y and 5Y. It is labeled as the
  investor's own experience.
- **Risk.** Annualized volatility = stdev of daily returns × √252, plus maximum drawdown. Needs at least 20
  daily returns.
- **Dividend contribution.** Approximate: dividends received ÷ starting value, labeled as such.

## Portfolio dividend income (`analytics/income.py`)

- **Actual growth.** Income(Y) ÷ income(Y−1) − 1 over complete calendar years of dividends received (cash
  and reinvested). A first year the portfolio didn't exist for in full is excluded. The current year is
  shown as partial and not compared.
- **Organic growth.** Σ qᵢ·DPSᵢ(Y) ÷ Σ qᵢ·DPSᵢ(Y−1) − 1, with qᵢ = split-adjusted shares on 1 Jan Y.
  DPS is per share actually received. A holding counts as comparable only if it:
  - was owned by 31 Jan of Y−1 (a month of grace for a portfolio started on the year's first trading days),
  - was held continuously through Y, and
  - paid the same number of dividends in both years.

  Purchases, new positions and reinvested shares are excluded by construction.
- **Attribution (sums exactly to the change).** The year's change in income is split into:
  - dividend-rate changes (organic): qᵢ·ΔDPS on comparable holdings,
  - share-count changes on comparable holdings (purchases, sales, reinvestment),
  - new or partial positions, and
  - exited positions.
- **Projected.** Current shares × indicated annual DPS, labeled as an estimate.
- **Objective.** The latest organic growth compared with the target (default 7%). Copy says it's a goal, not
  a guarantee.
- **Benchmark.** Index DPS growth for the same years, and current yields side by side. The app labels this
  as per-share index dividends, not total income.

## Tests

`backend/tests/test_fundamentals.py` and `test_portfolio.py` cover known values for every formula, plus
negative, zero and missing inputs, splits, DRIP, duplicate transactions, weekend events, deposits, missing
price history, young portfolios and all nine windows. Exact attribution sums are checked through the API in
`test_api.py`.
