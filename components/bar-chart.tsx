import { Text, View } from "react-native";

import { useThemeColors } from "@/lib/theme";

type Bar = { label: string; value: number | null; compare?: number | null };

const HEIGHT = 120;

/**
 * Annual bars with an optional second series (e.g. the S&P 500), drawn
 * below a zero line when negative. Missing years show a gap labeled "n/a",
 * never a zero-height bar that reads as zero.
 */
export default function BarChart({
  bars,
  format,
  seriesLabel,
  compareLabel,
}: {
  bars: Bar[];
  format: (v: number | null) => string;
  seriesLabel: string;
  compareLabel?: string;
}) {
  const colors = useThemeColors();
  const vals = bars.flatMap((b) => [b.value, b.compare]).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const hi = Math.max(0, ...vals);
  const lo = Math.min(0, ...vals);
  const span = hi - lo || 1;
  const zero = (hi / span) * HEIGHT;
  const hasCompare = bars.some((b) => b.compare != null);

  const bar = (v: number | null | undefined, color: string, key: string) => {
    if (v == null) return <View key={key} style={{ flex: 1 }} />;
    const h = Math.max((Math.abs(v) / span) * HEIGHT, 2);
    return (
      <View key={key} style={{ flex: 1, height: HEIGHT }}>
        <View
          style={{
            position: "absolute",
            left: 1,
            right: 1,
            backgroundColor: color,
            borderRadius: 3,
            height: h,
            top: v >= 0 ? zero - h : zero,
          }}
        />
      </View>
    );
  };

  return (
    <View
      className="mt-3"
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${seriesLabel}: ${bars.map((b) => `${b.label} ${format(b.value)}`).join(", ")}`}
    >
      <View className="flex-row items-end gap-1.5" style={{ height: HEIGHT }}>
        <View
          style={{ position: "absolute", left: 0, right: 0, top: zero, height: 1, backgroundColor: colors.border }}
        />
        {bars.map((b) => (
          <View key={b.label} className="flex-1 flex-row gap-0.5">
            {bar(b.value, colors.primary, "v")}
            {hasCompare ? bar(b.compare, colors.accent, "c") : null}
          </View>
        ))}
      </View>
      <View className="mt-1 flex-row gap-1.5">
        {bars.map((b) => (
          <View key={b.label} className="flex-1 items-center">
            <Text className="stat-sub" numberOfLines={1}>
              {b.label}
            </Text>
            <Text className="stat-sub" numberOfLines={1}>
              {b.value == null ? "n/a" : format(b.value)}
            </Text>
          </View>
        ))}
      </View>
      {hasCompare ? (
        <View className="mt-2 flex-row gap-4">
          <View className="flex-row items-center gap-1.5">
            <View style={{ width: 10, height: 10, backgroundColor: colors.primary, borderRadius: 2 }} />
            <Text className="stat-sub">{seriesLabel}</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View style={{ width: 10, height: 10, backgroundColor: colors.accent, borderRadius: 2 }} />
            <Text className="stat-sub">{compareLabel}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
