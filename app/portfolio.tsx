import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

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
  const { locked, loading: entLoading } = useEntitlements();
  // Pro starts on linked accounts; Free on the holdings it entered (linking is Pro).
  const [picked, setSource] = useState<PortfolioSource | null>(null);
  const source: PortfolioSource = picked ?? (locked("account_linking") ? "manual" : "linked");
  const linkedLocked = source === "linked" && locked("account_linking");
  const overview = useApi(entLoading || linkedLocked ? null : `overview:${source}`, () => api.portfolioOverview(source));
  const perfKey = entLoading || linkedLocked || locked("portfolio_performance") ? null : `perf:${source}`;
  const incomeKey = entLoading || linkedLocked || locked("portfolio_income_growth") ? null : `income:${source}`;
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
              { value: "manual", label: "My holdings" },
              { value: "linked", label: locked("account_linking") ? "Linked accounts · Pro" : "Linked accounts" },
              { value: "demo", label: "Sample portfolio" },
            ]}
          />
        </View>
        {source === "manual" ? (
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Pressable className="btn-outline" onPress={() => router.push("/holdings")} accessibilityRole="button">
              <Text className="btn-outline-text">Manage holdings & dividends</Text>
            </Pressable>
          </View>
        ) : null}
        {linkedLocked ? (
          <ProLock feature="account_linking">{null}</ProLock>
        ) : source === "linked" ? (
          <LinkAccount onChanged={overview.reload} />
        ) : null}
        {o?.demo ? <DataBadge provenance={{ source: "demo", retrieved_at: "", demo: true, stale: false }} /> : null}

        {linkedLocked ? null : noPortfolio ? (
          <View className="card section-gap">
            <Text className="card-title">{source === "manual" ? "No holdings yet" : "No investment history yet"}</Text>
            <Text className="card-caption">
              {source === "manual"
                ? "Add the shares you own, what you paid and the dividends you've received. Value, income and returns are calculated from them."
                : "Link a brokerage account to analyze your real holdings, or open the sample portfolio to see how the analysis works."}
            </Text>
            {source === "manual" ? (
              <Pressable
                className="btn mt-4"
                onPress={() => router.push({ pathname: "/holdings/lot", params: { id: "new" } })}
                accessibilityRole="button"
              >
                <Text className="btn-text">Add shares</Text>
              </Pressable>
            ) : null}
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
                  {o.total_cost_basis != null ? (
                    <StatCard
                      label="Unrealized gain"
                      value={formatMoneyCompact(o.total_unrealized_gain)}
                      sub={`On ${formatMoneyCompact(o.total_cost_basis)} cost basis`}
                    />
                  ) : null}
                  {o.dividends_received_total != null ? (
                    <StatCard label="Dividends received" value={formatMoney(o.dividends_received_total)} sub="As you recorded them" />
                  ) : null}
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

        {!noPortfolio && !linkedLocked ? (
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
