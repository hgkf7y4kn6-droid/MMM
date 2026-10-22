import { ScrollView, Text } from "react-native";

import BackLink from "@/components/back-link";
import { SafeAreaView } from "@/components/safe-area-view";

/** Short-form methodology and disclosures; the full methodology is docs/METHODOLOGY.md. */
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "What this is",
    body: [
      "Mindful Money provides analytical research and decision support. It is not individualized investment, tax or legal advice, and nothing here is a recommendation to buy, sell or hold any security.",
      "A dividend growth objective of 7–10%+ a year, and returns that keep pace with or beat the S&P 500 over a full market cycle, are portfolio goals — not guarantees or predictions.",
    ],
  },
  {
    title: "Data",
    body: [
      "Every figure shows its source and date. Missing data is shown as unavailable, never as zero. Data marked “Demo” describes fictional companies and an illustrative benchmark, and is not market data.",
      "Market data may be delayed and can contain errors from the provider. Fiscal years differ between companies.",
    ],
  },
  {
    title: "How key figures are calculated",
    body: [
      "Free cash flow = operating cash flow − capital expenditures. CAGR = (ending ÷ beginning)^(1 ÷ years) − 1, only when both endpoints are positive.",
      "ROIC = NOPAT ÷ average invested capital, where NOPAT = EBIT × (1 − tax rate) and invested capital = debt + equity − cash. Incremental ROIC measures the return on capital added, which can differ greatly from the return on the existing base.",
      "Approximate growth = ROIC × reinvestment rate is a simplification: it assumes new capital earns the measured return.",
      "S&P 500 comparisons use per-index-share aggregates (free cash flow and dividends per index share), so changes in index membership don't count as growth. Company dividend growth is compared per share, never against total dividends paid.",
      "Portfolio returns are time-weighted and remove deposits and withdrawals, so new money isn't counted as performance. Dividends are counted once. The benchmark is SPY's total return (distributions reinvested), over the same trading days. 3- and 5-year figures are shown both cumulative and annualized; shorter windows are cumulative.",
      "Organic income growth uses holdings held through both years at a fixed share count; purchases and new positions are reported separately.",
    ],
  },
  {
    title: "Risks",
    body: [
      "Historical performance and growth don't predict future results. Estimates and projections can be wrong. Companies can cut or suspend dividends. All investing involves risk, including loss of principal.",
    ],
  },
];

export default function Disclosures() {
  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <ScrollView contentContainerClassName="screen-pad">
        <BackLink />
        <Text className="screen-title" accessibilityRole="header">
          Methodology & disclosures
        </Text>
        {SECTIONS.map((s) => (
          <Text key={s.title}>
            <Text className="prose-head" accessibilityRole="header">
              {s.title}
              {"\n"}
            </Text>
            {s.body.map((p) => (
              <Text key={p} className="prose">
                {p}
                {"\n\n"}
              </Text>
            ))}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
