import type { IconName } from "@/constants/icons";

declare global {
  type AppTab = {
    name: string;
    title: string;
    icon: IconName;
  };

  type TabIconProps = {
    focused: boolean;
    icon: IconName;
  };

  type BillingCycle = "weekly" | "monthly" | "quarterly" | "yearly";
  type SubscriptionStatus = "active" | "paused" | "cancelled";

  /** What the user enters for a subscription they track (POST/PUT /api/subscriptions). */
  type SubscriptionInput = {
    name: string;
    price: number;
    currency: string;
    billing: BillingCycle;
    category: string | null;
    plan: string | null;
    payment_method: string | null;
    status: SubscriptionStatus;
    /** ISO date (YYYY-MM-DD) the subscription started */
    start_date: string | null;
    /** ISO date (YYYY-MM-DD) of the next charge */
    renewal_date: string;
    notes: string | null;
  };

  /** A tracked subscription as the API returns it; renewal_date is already rolled forward. */
  type Subscription = SubscriptionInput & {
    id: string;
    days_until_renewal: number;
    monthly_cost: number;
  };

  type SubscriptionsSummary = {
    active_count: number;
    /** Null when active subscriptions use more than one currency (totals are then null too). */
    currency: string | null;
    monthly_total: number | null;
    yearly_total: number | null;
    next_renewal_date: string | null;
  };

  type SubscriptionsResponse = { subscriptions: Subscription[]; summary: SubscriptionsSummary };

  type SubscriptionCardProps = Subscription & {
    expanded?: boolean;
    onPress?: () => void;
    onEdit?: () => void;
  };

  type ListHeadingProps = {
    title: string;
    /** Called by the "View all" button; the button is hidden without it. */
    onPress?: () => void;
  };

  // ── Research & portfolio API (backend/api_*.py) ─────────────────────────
  type MetricStatus = "ok" | "not_meaningful" | "not_applicable" | "insufficient_data";
  type MetricUnit = "pct" | "pp" | "ratio" | "x" | "usd" | "count" | "years";

  type Metric = {
    value: number | null;
    unit: MetricUnit;
    status: MetricStatus;
    reason: string | null;
    formula: string | null;
    period: string | null;
    inputs: Record<string, unknown>;
    notes: string[];
  };

  type MatrixRow = Metric & {
    key: string;
    label: string;
    help: string;
    higher_is_better: boolean | null;
  };

  type Tone = "green" | "yellow" | "blue" | "pink" | "orange";

  type MatrixSection = {
    key: string;
    label: string;
    tone: Tone;
    source?: string | null;
    rows: MatrixRow[];
  };

  type Provenance = {
    source: string;
    retrieved_at: string;
    demo: boolean;
    stale: boolean;
    license_note: string | null;
    methodology: string | null;
  };

  type DataMode = "live" | "demo";

  type StockMatrix = {
    symbol: string;
    name: string;
    sector: string | null;
    fiscal_year: number;
    currency: string;
    business_model_note: string | null;
    dividend_history: { year: number; dps: number | null }[];
    sections: MatrixSection[];
    provenance: Provenance;
    data_mode: DataMode;
  };

  type StockSearchResult = { symbol: string; name: string | null; sector: string | null; demo: boolean };

  type YearValue = { year: number; value: number | null; growth?: number | null; change?: number | null };

  type BenchmarkMeta = { name: string; provenance: Provenance };

  type FcfAnalysis = {
    symbol: string;
    years: number;
    comparison: string;
    company_cagr: Metric;
    benchmark_cagr: Metric;
    advantage_pp: Metric;
    history: (YearValue & { margin: number | null })[];
    benchmark_history: YearValue[];
    notes: string[];
    methodology: string;
    benchmark: BenchmarkMeta;
    provenance: Provenance;
  };

  type RoicAnalysis = {
    symbol: string;
    current: Metric;
    excluding_goodwill: Metric;
    benchmark: Metric;
    spread_pp: Metric;
    incremental: Metric;
    history: { year: number; roic: number | null; benchmark: number | null }[];
    business_model_note: string | null;
    notes: string[];
    methodology: string;
    benchmark_meta: BenchmarkMeta;
  };

  type DividendGrowthAnalysis = {
    symbol: string;
    years: number;
    company_cagr: Metric;
    benchmark_cagr: Metric;
    advantage_pp: Metric;
    consistency: Metric;
    streak: Metric;
    history: YearValue[];
    benchmark_history: YearValue[];
    current_yield: Metric;
    benchmark_yield: number | null;
    payout_ratio: Metric | null;
    fcf_payout_ratio: Metric | null;
    coverage: Metric | null;
    methodology: string;
    benchmark: BenchmarkMeta;
  };

  type AllocationUse = {
    key: string;
    label: string;
    amount: number | null;
    definition: string;
    pct_of_operating_cash_flow: number | null;
    pct_of_free_cash_flow: number | null;
  };

  type Allocation = {
    period?: string;
    fiscal_year?: number;
    operating_cash_flow: number | null;
    free_cash_flow: number | null;
    uses: AllocationUse[];
    remaining_cash: number | null;
    financing_requirement: number | null;
    note: string;
  };

  type CapitalAllocationAnalysis = {
    symbol: string;
    by_year: Allocation[];
    cumulative: Allocation | null;
    implied_growth: Metric;
    required_reinvestment_for_10pct: Metric;
    examples: {
      label: string;
      return_on_new_capital: number;
      target_growth: number;
      required_reinvestment_rate: number | null;
      cash_available_for_shareholders: number | null;
    }[];
    buyback_eps_effect: Metric | null;
    caveats: string[];
  };

  type PerformanceWindowKey = "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y";

  type PerformanceWindow = {
    key: PerformanceWindowKey;
    label: string;
    start: string | null;
    end: string;
    status: "ok" | "insufficient_history" | "insufficient_data";
    reason?: string;
    inception?: string | null;
    days?: number;
    portfolio_return?: number;
    benchmark_return?: number;
    excess_return_pp?: number;
    outcome?: "outperformed" | "underperformed" | "matched";
    portfolio_annualized?: number;
    benchmark_annualized?: number;
    excess_annualized_pp?: number;
    start_value?: number;
    end_value?: number;
    net_external_flows?: number;
    dividends_received?: number;
    dividend_contribution?: number | null;
    dividend_contribution_note?: string;
    volatility?: number;
    benchmark_volatility?: number;
    max_drawdown?: number;
    benchmark_max_drawdown?: number;
    money_weighted_annualized?: number | null;
    chart?: { date: string; portfolio: number; benchmark: number; value: number | null }[];
    stale_prices?: string[];
  };

  type PerformanceResponse = {
    status: "ok" | "insufficient_data";
    reason?: string;
    as_of?: string;
    inception?: string | null;
    current_value?: number | null;
    windows: PerformanceWindow[];
    notes: string[];
    benchmark?: { name: string; method: "total_return" | "price_return"; label: string };
    methodology?: string;
    demo: boolean;
  };

  type IncomeAttribution = {
    dividend_rate_changes: number;
    share_count_changes: number;
    new_or_partial_positions: number;
    exited_or_reduced_positions: number;
    total_change: number;
  };

  type IncomeYear = {
    year: number;
    income: number;
    actual_growth: number | null;
    organic_growth: number | null;
    attribution: IncomeAttribution | null;
    comparable_holdings: string[];
    contributions?: {
      symbol: string;
      income: number;
      prior_income: number;
      change: number;
      share_of_change: number | null;
      comparable: boolean;
    }[];
  };

  type IncomeAnalysis = {
    status: "ok" | "insufficient_data";
    reason?: string;
    as_of?: string;
    annual?: IncomeYear[];
    current_year_to_date?: { year: number; income: number; partial: boolean };
    income_cagr?: Metric | null;
    organic_growth_average?: number | null;
    forward?: {
      total: number | null;
      by_holding: {
        symbol: string;
        shares: number;
        annual_dividend_per_share: number | null;
        annual_income: number | null;
        market_value: number | null;
        share_of_income: number | null;
      }[];
      missing_dividend_data: string[];
      portfolio_yield: number | null;
      projected_growth_vs_last_full_year: number | null;
      note: string;
    };
    objective?: {
      target_growth: number;
      latest_actual_growth: number | null;
      latest_organic_growth: number | null;
      status: "meeting_objective" | "below_objective" | "insufficient_data";
      note: string;
    };
    benchmark?: {
      name: string;
      measure: string;
      label: string;
      annual_growth: Record<string, number | null>;
      dividend_yield: number | null;
      cagr: Metric | null;
      provenance: Provenance;
    } | null;
    definitions?: Record<string, string>;
    objective_note: string;
    notes?: string[];
    demo?: boolean;
  };

  type PortfolioOverview = {
    holdings: {
      symbol: string;
      shares: number;
      price: number | null;
      market_value: number | null;
      annual_income: number | null;
      as_of: string | null;
    }[];
    total_value: number;
    estimated_annual_income: number;
    estimated_yield: number | null;
    complete: boolean;
    income_received_ytd: number | null;
    notes: string[];
    demo: boolean;
    income_note: string;
  };

  type ProFeature =
    | "fcf_growth"
    | "fcf_vs_benchmark"
    | "roic"
    | "dividend_vs_benchmark"
    | "capital_allocation"
    | "portfolio_income_growth"
    | "portfolio_income_vs_benchmark"
    | "portfolio_performance"
    | "export";

  type Entitlement = {
    plan: "free" | "pro";
    status: string;
    provider: string | null;
    access_until: string | null;
    cancel_at_period_end: boolean;
    gating: boolean;
    features: Record<string, boolean>;
    compare_limit: number;
  };

  type MeResponse = {
    user_id: string;
    entitlement: Entitlement;
    pricing: { display: string | null; web_checkout: boolean; in_app_purchase: boolean };
    features: { free: Record<string, string>; pro: Record<string, string> };
  };

  /** The caller's linked brokerage account: is it current, and does it need the user? */
  type PlaidStatus = {
    linked: boolean;
    status: "none" | "active" | "login_required" | "revoked" | "error";
    needs_reconnect: boolean;
    expiring_soon?: boolean;
    new_accounts_available?: boolean;
    last_synced_at: string | null;
    configured: boolean;
  };
}

export {};
