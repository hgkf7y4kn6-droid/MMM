import { Text, View } from "react-native";

import MetricRow from "@/components/metric-row";
import { useThemeColors } from "@/lib/theme";

const TONE_KEY = {
  green: "toneGreen",
  yellow: "toneYellow",
  blue: "toneBlue",
  pink: "tonePink",
  orange: "toneOrange",
} as const;

const SOURCE_LABEL: Record<string, string> = {
  consensus: "Analyst consensus",
  guidance: "Company guidance",
  internal: "Internal estimate",
};

/** One group of the stock analysis matrix (historical growth, dividends, …). */
export default function MatrixSection({ section, currency }: { section: MatrixSection; currency?: string }) {
  const colors = useThemeColors();
  return (
    <View className="card section-gap">
      <View className="flex-row items-center">
        <View className="tone-bar" style={{ backgroundColor: colors[TONE_KEY[section.tone]] }} />
        <Text className="card-title" accessibilityRole="header">
          {section.label}
        </Text>
      </View>
      {section.key === "projected_growth" ? (
        <Text className="card-caption">
          {section.source ? `Source: ${SOURCE_LABEL[section.source] ?? section.source}. ` : ""}
          Estimates are kept apart from historical actuals and are never filled in when missing.
        </Text>
      ) : null}
      <View className="mt-1">
        {section.rows.map((row) => (
          <MetricRow
            key={row.key}
            label={row.label}
            metric={row}
            help={row.help}
            higherIsBetter={row.higher_is_better}
            metricKey={row.key}
            currency={currency}
          />
        ))}
      </View>
    </View>
  );
}
