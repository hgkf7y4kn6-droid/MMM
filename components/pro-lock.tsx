import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Skeleton } from "@/components/skeleton";
import { useEntitlements } from "@/lib/entitlements";

export const PRO_FEATURE_COPY: Record<ProFeature, { title: string; pitch: string }> = {
  fcf_growth: { title: "Free cash flow growth", pitch: "Annual FCF history, margins and trend." },
  fcf_vs_benchmark: {
    title: "FCF growth vs the S&P 500",
    pitch: "Five-year FCF CAGR against S&P 500 FCF per index share, same endpoints.",
  },
  roic: { title: "ROIC analysis", pitch: "ROIC history, ex-goodwill and incremental ROIC, vs the S&P 500." },
  dividend_vs_benchmark: {
    title: "Dividend growth vs the S&P 500",
    pitch: "Dividend-per-share CAGR, consistency and coverage against the index.",
  },
  capital_allocation: {
    title: "Capital allocation",
    pitch: "Where cash goes — reinvestment, M&A, debt, buybacks, dividends — and the growth it can fund.",
  },
  portfolio_income_growth: {
    title: "Dividend income growth",
    pitch: "Actual, organic and projected income growth, with what drove each year's change.",
  },
  portfolio_income_vs_benchmark: {
    title: "Income growth vs the S&P 500",
    pitch: "Your income growth against S&P 500 dividends per index share.",
  },
  portfolio_performance: {
    title: "Performance vs the S&P 500",
    pitch: "Time-weighted total return across nine windows, deposits excluded.",
  },
  export: { title: "Export", pitch: "Download analyses as CSV." },
};

/**
 * A Pro section. For Free accounts it renders an illustrative placeholder
 * and an upgrade path -- never the children, so locked data isn't requested
 * or rendered (the server would answer 402 anyway). Pattern from DFS-Riches ProLock.
 */
export default function ProLock({ feature, children }: { feature: ProFeature; children: ReactNode }) {
  const { locked, loading } = useEntitlements();
  if (loading) return null;
  if (!locked(feature)) return <>{children}</>;
  const copy = PRO_FEATURE_COPY[feature];
  return (
    <View className="pro-lock section-gap">
      <View className="gap-2 px-4 pt-4" aria-hidden importantForAccessibility="no-hide-descendants">
        <Skeleton style={{ height: 12, width: "40%" }} />
        <View className="flex-row items-end gap-2" style={{ height: 56 }}>
          {[24, 34, 30, 44, 52, 40].map((h, i) => (
            <Skeleton key={i} style={{ height: h, flex: 1 }} />
          ))}
        </View>
      </View>
      <View className="pro-lock-overlay">
        <Text className="pro-kicker">Mindful Money Pro</Text>
        <Text className="pro-lock-title">{copy.title}</Text>
        <Text className="pro-lock-text">{copy.pitch}</Text>
        <Pressable
          className="btn mt-4"
          onPress={() => router.push({ pathname: "/pro", params: { feature } })}
          accessibilityRole="button"
          accessibilityLabel={`Unlock ${copy.title} with Pro`}
        >
          <Text className="btn-text">Unlock with Pro</Text>
        </Pressable>
      </View>
    </View>
  );
}
