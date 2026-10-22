import { Text, View } from "react-native";

import BarChart from "@/components/bar-chart";
import MetricRow from "@/components/metric-row";
import ProLock from "@/components/pro-lock";
import StatCard from "@/components/stat-card";
import StatusView from "@/components/status-view";
import { api } from "@/lib/api";
import { useEntitlements } from "@/lib/entitlements";
import { formatMoneyCompact, formatPct, formatPp } from "@/lib/format";
import { useApi } from "@/lib/use-api";

/** Loads a Pro analysis only for an entitled account (key null = no request at all). */
function useProApi<T>(feature: ProFeature, symbol: string, load: () => Promise<T>) {
  const { locked, loading } = useEntitlements();
  return useApi(loading || locked(feature) ? null : `${feature}:${symbol}`, load);
}

const tone = (m: Metric) => (m.value == null || m.value === 0 ? null : m.value > 0 ? "good" : "bad");

function Comparison({ company, benchmark, spread, label }: { company: Metric; benchmark: Metric; spread: Metric; label: string }) {
  return (
    <View className="stat-grid mt-3">
      <StatCard label={label} value={formatPct(company.value, { signed: true })} sub={company.period ?? company.reason} />
      <StatCard label="S&P 500" value={formatPct(benchmark.value, { signed: true })} sub={benchmark.period ?? benchmark.reason} />
      <StatCard label="Advantage" value={formatPp(spread.value)} sub={spread.reason} tone={tone(spread)} />
    </View>
  );
}

function Methodology({ text, notes = [] }: { text: string; notes?: string[] }) {
  return (
    <>
      {notes.map((n) => (
        <Text key={n} className="card-caption">
          ⚠ {n}
        </Text>
      ))}
      <Text className="card-caption mt-3">{text}</Text>
    </>
  );
}

export function FcfSection({ symbol }: { symbol: string }) {
  const q = useProApi("fcf_vs_benchmark", symbol, () => api.fcf(symbol));
  const d = q.data;
  return (
    <ProLock feature="fcf_vs_benchmark">
      <View className="card section-gap">
        <Text className="card-title" accessibilityRole="header">
          Free cash flow growth vs the S&P 500
        </Text>
        <StatusView loading={q.loading && !d} error={q.error} onRetry={q.reload} />
        {d ? (
          <>
            <Comparison company={d.company_cagr} benchmark={d.benchmark_cagr} spread={d.advantage_pp} label={`${d.symbol} FCF CAGR`} />
            {d.company_cagr.value == null && d.company_cagr.reason ? <Text className="metric-reason">{d.company_cagr.reason}</Text> : null}
            <BarChart
              bars={d.history.map((h) => ({ label: `’${String(h.year).slice(2)}`, value: h.value }))}
              format={(v) => formatMoneyCompact(v)}
              seriesLabel="Free cash flow by fiscal year"
            />
            <View className="mt-3">
              {d.history.slice(-3).map((h) => (
                <MetricRow
                  key={h.year}
                  label={`FY${h.year} FCF margin`}
                  metric={{ value: h.margin, unit: "pct", status: h.margin == null ? "insufficient_data" : "ok", reason: null, formula: "free cash flow ÷ revenue", period: `FY${h.year}`, inputs: {}, notes: [] }}
                />
              ))}
            </View>
            <Methodology text={d.methodology} notes={d.notes} />
          </>
        ) : null}
      </View>
    </ProLock>
  );
}

export function RoicSection({ symbol }: { symbol: string }) {
  const q = useProApi("roic", symbol, () => api.roic(symbol));
  const d = q.data;
  return (
    <ProLock feature="roic">
      <View className="card section-gap">
        <Text className="card-title" accessibilityRole="header">
          Return on invested capital
        </Text>
        <StatusView loading={q.loading && !d} error={q.error} onRetry={q.reload} />
        {d ? (
          <>
            <View className="stat-grid mt-3">
              <StatCard label={`${d.symbol} ROIC`} value={formatPct(d.current.value)} sub={d.current.period ?? d.current.reason} />
              <StatCard label="S&P 500" value={formatPct(d.benchmark.value)} sub={d.benchmark.reason} />
              <StatCard label="Spread" value={formatPp(d.spread_pp.value)} sub={d.spread_pp.reason} tone={tone(d.spread_pp)} />
            </View>
            <BarChart
              bars={d.history.map((h) => ({ label: `’${String(h.year).slice(2)}`, value: h.roic, compare: h.benchmark }))}
              format={(v) => formatPct(v, { digits: 0 })}
              seriesLabel={d.symbol}
              compareLabel="S&P 500"
            />
            <View className="mt-3">
              <MetricRow label="ROIC excluding goodwill" metric={d.excluding_goodwill} help="Return on the underlying operations, before the premium paid for acquisitions." />
              <MetricRow label="Incremental ROIC" metric={d.incremental} help="Return on capital added over the period — not the same as the return on the existing base." />
            </View>
            {d.business_model_note ? <Text className="card-caption">{d.business_model_note}</Text> : null}
            <Methodology text={d.methodology} notes={d.notes} />
          </>
        ) : null}
      </View>
    </ProLock>
  );
}

export function DividendVsSection({ symbol }: { symbol: string }) {
  const q = useProApi("dividend_vs_benchmark", symbol, () => api.dividendGrowth(symbol));
  const d = q.data;
  return (
    <ProLock feature="dividend_vs_benchmark">
      <View className="card section-gap">
        <Text className="card-title" accessibilityRole="header">
          Dividend growth vs the S&P 500
        </Text>
        <StatusView loading={q.loading && !d} error={q.error} onRetry={q.reload} />
        {d ? (
          <>
            <Comparison company={d.company_cagr} benchmark={d.benchmark_cagr} spread={d.advantage_pp} label={`${d.symbol} DPS CAGR`} />
            <View className="mt-3">
              <MetricRow label="Years with a raise" metric={d.consistency} help="Share of the last years in which dividends per share rose." />
              <MetricRow label="Growth streak" metric={d.streak} />
              <MetricRow label="Forward yield" metric={d.current_yield} help="Shown beside growth: fast growth and a high yield rarely come together." />
              {d.payout_ratio ? <MetricRow label="Payout ratio (EPS)" metric={d.payout_ratio} /> : null}
              {d.coverage ? <MetricRow label="FCF coverage" metric={d.coverage} /> : null}
            </View>
            <Methodology text={d.methodology} />
          </>
        ) : null}
      </View>
    </ProLock>
  );
}

export function CapitalAllocationSection({ symbol }: { symbol: string }) {
  const q = useProApi("capital_allocation", symbol, () => api.capitalAllocation(symbol));
  const d = q.data;
  const c = d?.cumulative;
  return (
    <ProLock feature="capital_allocation">
      <View className="card section-gap">
        <Text className="card-title" accessibilityRole="header">
          Capital allocation
        </Text>
        <StatusView loading={q.loading && !d} error={q.error} onRetry={q.reload} />
        {d && c ? (
          <>
            <Text className="card-caption">
              {c.period}: operating cash flow {formatMoneyCompact(c.operating_cash_flow)}, free cash flow{" "}
              {formatMoneyCompact(c.free_cash_flow)}.
            </Text>
            <View className="tbl-head mt-3">
              <Text className="tbl-cell tbl-head-text">Use of cash</Text>
              <Text className="tbl-cell-num tbl-head-text">Amount</Text>
              <Text className="tbl-cell-num tbl-head-text">% of FCF</Text>
            </View>
            {c.uses.map((u) => (
              <View key={u.key} className="tbl-row" accessible accessibilityLabel={`${u.label}: ${formatMoneyCompact(u.amount)}, ${u.pct_of_free_cash_flow == null ? "share of free cash flow not applicable" : `${formatPct(u.pct_of_free_cash_flow)} of free cash flow`}`}>
                <Text className="tbl-cell">{u.label}</Text>
                <Text className="tbl-cell-num">{formatMoneyCompact(u.amount)}</Text>
                <Text className="tbl-cell-num">{u.key === "reinvestment" ? "before FCF" : formatPct(u.pct_of_free_cash_flow, { digits: 0 })}</Text>
              </View>
            ))}
            <View className="tbl-row">
              <Text className="tbl-cell font-sans-semibold">
                {c.financing_requirement ? "Funded by borrowing or cash" : "Cash remaining"}
              </Text>
              <Text className="tbl-cell-num">
                {formatMoneyCompact(c.financing_requirement ? c.financing_requirement : c.remaining_cash)}
              </Text>
              <Text className="tbl-cell-num" />
            </View>
            <Text className="card-caption">{c.note}</Text>

            <Text className="card-title mt-5" accessibilityRole="header">
              The compounding math
            </Text>
            <View className="mt-1">
              <MetricRow label="Implied earnings growth (ROIC × reinvestment)" metric={d.implied_growth} />
              <MetricRow label="Reinvestment needed for 10% growth" metric={d.required_reinvestment_for_10pct} />
              {d.buyback_eps_effect ? <MetricRow label="EPS growth incl. share-count change" metric={d.buyback_eps_effect} /> : null}
            </View>
            <View className="stat-grid mt-3">
              {d.examples.map((e) => (
                <StatCard
                  key={e.label}
                  label={e.label}
                  value={`${formatPct(e.required_reinvestment_rate, { digits: 0 })} reinvested`}
                  sub={`${formatPct(e.return_on_new_capital, { digits: 0 })} return on new capital → ${formatPct(e.target_growth, { digits: 0 })} growth, ${formatPct(e.cash_available_for_shareholders, { digits: 0 })} left for shareholders`}
                />
              ))}
            </View>
            {d.caveats.map((t) => (
              <Text key={t} className="card-caption">
                {t}
              </Text>
            ))}
          </>
        ) : null}
      </View>
    </ProLock>
  );
}
