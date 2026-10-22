import { useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import BackLink from "@/components/back-link";
import BarChart from "@/components/bar-chart";
import DataBadge from "@/components/data-badge";
import Disclaimer from "@/components/disclaimer";
import MatrixSection from "@/components/matrix-section";
import { SafeAreaView } from "@/components/safe-area-view";
import StatusView from "@/components/status-view";
import { CapitalAllocationSection, DividendVsSection, FcfSection, RoicSection } from "@/components/stock/pro-sections";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

export default function StockDetail() {
  const { symbol: raw } = useLocalSearchParams<{ symbol: string }>();
  const symbol = String(raw ?? "").toUpperCase();
  const q = useApi(symbol ? `matrix:${symbol}` : null, () => api.matrix(symbol));
  const m = q.data;
  const dps = m?.dividend_history ?? [];

  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <ScrollView contentContainerClassName="screen-pad">
        <BackLink />
        <Text className="screen-title" accessibilityRole="header">
          {symbol}
        </Text>
        {m ? (
          <Text className="screen-subtitle">
            {[m.name, m.sector, `FY${m.fiscal_year}`].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        {m ? <DataBadge provenance={m.provenance} /> : null}
        <StatusView loading={q.loading && !m} error={q.error} onRetry={q.reload} rows={8} />

        {m ? (
          <>
            {m.business_model_note ? (
              <View className="card section-gap">
                <Text className="card-caption mt-0">{m.business_model_note}</Text>
              </View>
            ) : null}
            {m.sections.map((s, i) => (
              <Animated.View key={s.key} entering={FadeInDown.delay(i * 60).duration(350)}>
                <MatrixSection section={s} currency={m.currency} />
              </Animated.View>
            ))}
            {dps.some((d) => d.dps) ? (
              <View className="card section-gap">
                <Text className="card-title" accessibilityRole="header">
                  Dividends per share
                </Text>
                <Text className="card-caption">Split-adjusted, by fiscal year.</Text>
                <BarChart
                  bars={dps.map((d) => ({ label: `’${String(d.year).slice(2)}`, value: d.dps }))}
                  format={(v) => (v == null ? "—" : `$${v.toFixed(2)}`)}
                  seriesLabel="Dividends per share"
                />
              </View>
            ) : null}

            <Text className="list-title mt-8" accessibilityRole="header">
              Pro analysis
            </Text>
            <FcfSection symbol={symbol} />
            <RoicSection symbol={symbol} />
            <DividendVsSection symbol={symbol} />
            <CapitalAllocationSection symbol={symbol} />
          </>
        ) : null}
        <Disclaimer />
      </ScrollView>
    </SafeAreaView>
  );
}
