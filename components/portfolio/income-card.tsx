import { Text, View } from "react-native";

import BarChart from "@/components/bar-chart";
import ProLock from "@/components/pro-lock";
import SignalIcon from "@/components/signal-icon";
import StatCard from "@/components/stat-card";
import { formatMoney, formatMoneyCompact, formatPct, formatPp } from "@/lib/format";

const ATTRIBUTION: { key: keyof IncomeAttribution; label: string }[] = [
  { key: "dividend_rate_changes", label: "Dividend raises & cuts (organic)" },
  { key: "share_count_changes", label: "Shares bought, sold or reinvested" },
  { key: "new_or_partial_positions", label: "New or partial-year positions" },
  { key: "exited_or_reduced_positions", label: "Exited positions" },
];

/** Dividend income history, actual vs organic vs projected growth, and what drove it. */
export default function IncomeCard({ data }: { data: IncomeAnalysis }) {
  if (data.status !== "ok" || !data.annual) {
    return (
      <View className="card section-gap">
        <Text className="card-title">Dividend income growth</Text>
        <Text className="empty-text">{data.reason}</Text>
      </View>
    );
  }
  const latest = data.annual[data.annual.length - 1];
  const o = data.objective!;
  const bench = data.benchmark;
  const benchLatest = bench && latest ? bench.annual_growth[String(latest.year)] : null;

  return (
    <View className="card section-gap">
      <Text className="card-title" accessibilityRole="header">
        Dividend income growth
      </Text>
      <BarChart
        bars={data.annual.map((y) => ({ label: String(y.year), value: y.income }))}
        format={(v) => formatMoneyCompact(v)}
        seriesLabel="Dividends received by calendar year"
      />
      <Text className="card-caption">
        Complete calendar years. {data.current_year_to_date?.year} so far: {formatMoney(data.current_year_to_date?.income)} (partial, not compared).
      </Text>

      <View className="stat-grid mt-3">
        <StatCard label={`Actual growth ${latest?.year ?? ""}`} value={formatPct(latest?.actual_growth, { signed: true })} sub="Includes purchases and sales" />
        <StatCard label="Organic growth" value={formatPct(latest?.organic_growth, { signed: true })} sub={`Same holdings, fixed shares${latest?.comparable_holdings.length ? ` (${latest.comparable_holdings.length})` : ""}`} />
        <StatCard label="Income CAGR" value={formatPct(data.income_cagr?.value, { signed: true })} sub={data.income_cagr?.period ?? data.income_cagr?.reason ?? null} />
        <StatCard label="Projected next 12 months" value={formatMoneyCompact(data.forward?.total)} sub={`${formatPct(data.forward?.projected_growth_vs_last_full_year, { signed: true })} vs last full year · estimate`} />
      </View>

      <View className="card section-gap bg-muted">
        <Text className="stat-label">Objective: {formatPct(o.target_growth, { digits: 0 })}+ annual income growth</Text>
        <View className="flex-row items-center gap-1.5">
          <SignalIcon signal={o.status === "meeting_objective" ? 1 : o.status === "below_objective" ? -1 : 0} />
          <Text className="stat-value">
            {o.status === "meeting_objective" ? "On pace" : o.status === "below_objective" ? "Below pace" : "Not enough history"}
          </Text>
        </View>
        <Text className="stat-sub">
          Latest organic growth {formatPct(o.latest_organic_growth, { signed: true })}. {o.note}
        </Text>
      </View>

      {latest?.attribution ? (
        <>
          <Text className="card-title mt-5" accessibilityRole="header">
            What changed income in {latest.year}
          </Text>
          {ATTRIBUTION.map((a) => (
            <View key={a.key} className="tbl-row">
              <Text className="tbl-cell">{a.label}</Text>
              <Text className="tbl-cell-num">{formatMoney(latest.attribution![a.key])}</Text>
            </View>
          ))}
          <View className="tbl-row">
            <Text className="tbl-cell font-sans-semibold">Total change</Text>
            <Text className="tbl-cell-num">{formatMoney(latest.attribution.total_change)}</Text>
          </View>
          {latest.contributions?.slice(0, 6).map((c) => (
            <View key={c.symbol} className="tbl-row">
              <Text className="tbl-cell">
                {c.symbol}
                {c.comparable ? "" : " (not comparable)"}
              </Text>
              <Text className="tbl-cell-num">{formatMoney(c.change)}</Text>
              <Text className="tbl-cell-num">{formatPct(c.share_of_change, { digits: 0 })}</Text>
            </View>
          ))}
        </>
      ) : null}

      <ProLock feature="portfolio_income_vs_benchmark">
        {bench ? (
          <>
            <Text className="card-title mt-5" accessibilityRole="header">
              Income growth vs the S&P 500
            </Text>
            <View className="stat-grid mt-3">
              <StatCard label={`Your organic ${latest?.year}`} value={formatPct(latest?.organic_growth, { signed: true })} />
              <StatCard label={`S&P 500 DPS ${latest?.year}`} value={formatPct(benchLatest, { signed: true })} />
              <StatCard
                label="Difference"
                value={formatPp(latest?.organic_growth != null && benchLatest != null ? latest.organic_growth - benchLatest : null)}
              />
            </View>
            <View className="stat-grid mt-3">
              <StatCard label="Your forward yield" value={formatPct(data.forward?.portfolio_yield, { digits: 2 })} />
              <StatCard label="S&P 500 yield" value={formatPct(bench.dividend_yield, { digits: 2 })} />
            </View>
            <Text className="card-caption">{bench.label}</Text>
          </>
        ) : (
          <Text className="card-caption mt-4">No licensed S&P 500 dividend series is configured, so the comparison isn&apos;t shown.</Text>
        )}
      </ProLock>

      {data.definitions
        ? Object.entries(data.definitions).map(([k, v]) => (
            <Text key={k} className="card-caption">
              <Text className="metric-detail-strong">{k.replace(/_/g, " ")}: </Text>
              {v}
            </Text>
          ))
        : null}
      {data.notes?.map((n) => (
        <Text key={n} className="card-caption">
          ⚠ {n}
        </Text>
      ))}
    </View>
  );
}
