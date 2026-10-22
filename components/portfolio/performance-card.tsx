import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import LineChart from "@/components/line-chart";
import MetricRow from "@/components/metric-row";
import SegmentedControl from "@/components/segmented-control";
import StatCard from "@/components/stat-card";
import { formatDate, formatMoney, formatPct, formatPp } from "@/lib/format";

const m = (value: number | null | undefined, unit: MetricUnit, formula?: string): Metric => ({
  value: value ?? null,
  unit,
  status: value == null ? "insufficient_data" : "ok",
  reason: value == null ? "Not enough data for this window." : null,
  formula: formula ?? null,
  period: null,
  inputs: {},
  notes: [],
});

/** Portfolio vs S&P 500 total return for the selected window. */
export default function PerformanceCard({ data }: { data: PerformanceResponse }) {
  const available = data.windows;
  const [key, setKey] = useState<PerformanceWindowKey>(
    () => (available.find((w) => w.key === "1Y" && w.status === "ok") ?? available.find((w) => w.status === "ok") ?? available[0])?.key ?? "1Y",
  );
  const w = useMemo(() => available.find((x) => x.key === key), [available, key]);
  const bench = data.benchmark?.name ?? "S&P 500";

  return (
    <View className="card section-gap">
      <Text className="card-title" accessibilityRole="header">
        Performance vs the S&P 500
      </Text>
      <Text className="card-caption">{data.benchmark?.label}</Text>
      <View className="mt-3">
        <SegmentedControl
          label="Time window"
          value={key}
          onChange={setKey}
          options={available.map((x) => ({ value: x.key, label: x.key }))}
        />
      </View>
      {!w ? null : w.status !== "ok" ? (
        <Text className="empty-text">
          {w.reason}
          {w.inception ? ` Portfolio history starts ${formatDate(w.inception)}.` : ""}
        </Text>
      ) : (
        <>
          <Text className="card-caption">
            {formatDate(w.start)} – {formatDate(w.end)} · {w.label}
            {w.portfolio_annualized != null ? " · cumulative, with annualized below" : " · cumulative"}
          </Text>
          <View className="stat-grid mt-3">
            <StatCard label="Portfolio" value={formatPct(w.portfolio_return, { signed: true })} sub={w.portfolio_annualized != null ? `${formatPct(w.portfolio_annualized, { signed: true })} a year` : null} />
            <StatCard label={bench} value={formatPct(w.benchmark_return, { signed: true })} sub={w.benchmark_annualized != null ? `${formatPct(w.benchmark_annualized, { signed: true })} a year` : null} />
            <StatCard
              label={w.outcome === "outperformed" ? "Outperformed by" : w.outcome === "underperformed" ? "Underperformed by" : "Difference"}
              value={formatPp(w.excess_return_pp)}
              sub={w.excess_annualized_pp != null ? `${formatPp(w.excess_annualized_pp)} a year` : null}
              tone={w.outcome === "outperformed" ? "good" : w.outcome === "underperformed" ? "bad" : null}
            />
          </View>
          {w.chart ? <LineChart points={w.chart} benchmarkLabel={bench} /> : null}
          <View className="mt-3">
            <MetricRow label="Value at start" metric={m(w.start_value, "usd")} />
            <MetricRow label="Value at end" metric={m(w.end_value, "usd")} />
            <MetricRow label="Net deposits (−withdrawals)" metric={m(w.net_external_flows, "usd")} help="New money isn't counted as performance." />
            <MetricRow label="Dividends received" metric={m(w.dividends_received, "usd")} />
            <MetricRow label="Dividend contribution" metric={m(w.dividend_contribution, "pct")} help={w.dividend_contribution_note} />
            {w.volatility != null ? <MetricRow label="Volatility (annualized)" metric={m(w.volatility, "ratio")} help={`${bench}: ${formatPct(w.benchmark_volatility)}`} /> : null}
            {w.max_drawdown != null ? <MetricRow label="Maximum drawdown" metric={m(w.max_drawdown, "ratio")} help={`${bench}: ${formatPct(w.benchmark_max_drawdown)}`} /> : null}
            {w.money_weighted_annualized !== undefined ? (
              <MetricRow label="Your money-weighted return" metric={m(w.money_weighted_annualized, "pct", "IRR of your deposits, withdrawals and ending value")} help="Reflects when you added money; time-weighted return above is the fair comparison with the index." />
            ) : null}
          </View>
          {w.stale_prices?.length ? <Text className="card-caption">Prices carried forward for {w.stale_prices.join(", ")} on some days.</Text> : null}
        </>
      )}
      {data.notes.map((n) => (
        <Text key={n} className="card-caption">
          ⚠ {n}
        </Text>
      ))}
      {data.methodology ? <Text className="card-caption mt-3">{data.methodology}</Text> : null}
      {data.current_value != null ? <Text className="card-caption">Current value {formatMoney(data.current_value)}.</Text> : null}
    </View>
  );
}
