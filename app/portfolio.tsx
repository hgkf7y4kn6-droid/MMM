import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import BackLink from "@/components/back-link";
import DataBadge from "@/components/data-badge";
import Disclaimer from "@/components/disclaimer";
import LinkAccount from "@/components/portfolio/link-account";
import IncomeCard from "@/components/portfolio/income-card";
import PerformanceCard from "@/components/portfolio/performance-card";
import ProLock from "@/components/pro-lock";
import { SafeAreaView } from "@/components/safe-area-view";
import SegmentedControl from "@/components/segmented-control";
import StatCard from "@/components/stat-card";
import StatusView from "@/components/status-view";
import { api, type PortfolioSource } from "@/lib/api";
import { useEntitlements } from "@/lib/entitlements";
import { formatMoney, formatMoneyCompact, formatPct } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const TARGET_GROWTH = 0.07;

export default function Portfolio() {
  const [source, setSource] = useState<PortfolioSource>("linked");
  const { locked, loading: entLoading } = useEntitlements();
  const overview = useApi(`overview:${source}`, () => api.portfolioOverview(source));
  const perfKey = entLoading || locked("portfolio_performance") ? null : `perf:${source}`;
  const incomeKey = entLoading || locked("portfolio_income_growth") ? null : `income:${source}`;
  const perf = useApi(perfKey, () => api.portfolioPerformance(source));
  const income = useApi(incomeKey, () => api.portfolioIncome(source, TARGET_GROWTH));
  const noPortfolio = overview.error?.code === "no_portfolio";
  const o = overview.data;

  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <ScrollView contentContainerClassName="screen-pad">
        <BackLink />
        <Text className="screen-title" accessibilityRole="header">
          Portfolio
        </Text>
        <Text className="screen-subtitle">Calculated from your holdings and transactions, not averages of stock growth rates.</Text>
        <View className="mt-4">
          <SegmentedControl
            label="Portfolio"
            value={source}
            onChange={setSource}
            options={[
              { value: "linked", label: "Linked accounts" },
              { value: "demo", label: "Sample portfolio" },
            ]}
          />
        </View>
        {source === "linked" ? <LinkAccount onChanged={overview.reload} /> : null}
        {o?.demo ? <DataBadge provenance={{ source: "demo", retrieved_at: "", demo: true, stale: false }} /> : null}

        {noPortfolio ? (
          <View className="card section-gap">
            <Text className="card-title">No investment history yet</Text>
            <Text className="card-caption">
              Link a brokerage account to analyze your real holdings, or open the sample portfolio to see how the analysis works.
            </Text>
          </View>
        ) : (
          <View className="card section-gap">
            <Text className="card-title" accessibilityRole="header">
              Overview
            </Text>
            <StatusView loading={overview.loading && !o} error={overview.error} onRetry={overview.reload} />
            {o ? (
              <>
                <View className="stat-grid mt-3">
                  <StatCard label="Market value" value={formatMoneyCompact(o.total_value)} sub={o.complete ? "Before taxes on gains" : "Some prices unavailable"} />
                  <StatCard label="Estimated annual income" value={formatMoney(o.estimated_annual_income)} sub={`Yield ${formatPct(o.estimated_yield, { digits: 2 })}`} />
                </View>
                <View className="tbl-head mt-4">
                  <Text className="tbl-cell tbl-head-text">Holding</Text>
                  <Text className="tbl-cell-num tbl-head-text">Value</Text>
                  <Text className="tbl-cell-num tbl-head-text">Income/yr</Text>
                </View>
                {o.holdings.map((h) => (
                  <View key={h.symbol} className="tbl-row" accessible accessibilityLabel={`${h.symbol}: ${formatMoney(h.market_value)} value, ${formatMoney(h.annual_income)} a year`}>
                    <Text className="tbl-cell">{h.symbol}</Text>
                    <Text className="tbl-cell-num">{formatMoneyCompact(h.market_value)}</Text>
                    <Text className="tbl-cell-num">{formatMoney(h.annual_income)}</Text>
                  </View>
                ))}
                <Text className="card-caption">{o.income_note}</Text>
                {o.notes.map((n) => (
                  <Text key={n} className="card-caption">
                    ⚠ {n}
                  </Text>
                ))}
              </>
            ) : null}
          </View>
        )}

        {!noPortfolio ? (
          <>
            <ProLock feature="portfolio_performance">
              <StatusView loading={perf.loading && !perf.data} error={perf.error} onRetry={perf.reload} />
              {perf.data ? <PerformanceCard data={perf.data} /> : null}
            </ProLock>
            <ProLock feature="portfolio_income_growth">
              <StatusView loading={income.loading && !income.data} error={income.error} onRetry={income.reload} />
              {income.data ? <IncomeCard data={income.data} /> : null}
            </ProLock>
          </>
        ) : null}
        <Disclaimer />
      </ScrollView>
    </SafeAreaView>
  );
}
