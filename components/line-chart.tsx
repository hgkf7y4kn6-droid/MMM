import { useState } from "react";
import { Text, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";

import { formatPct } from "@/lib/format";
import { useThemeColors } from "@/lib/theme";

type Point = { date: string; portfolio: number; benchmark: number };

const HEIGHT = 180;
const PAD_Y = 10;

/**
 * Cumulative return of the portfolio (solid gold) vs the benchmark (dashed
 * blue) over one window. The dash keeps the two apart without color.
 */
export default function LineChart({ points, benchmarkLabel }: { points: Point[]; benchmarkLabel: string }) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  if (points.length < 2) return null;
  const values = points.flatMap((p) => [p.portfolio, p.benchmark]);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => PAD_Y + (1 - (v - lo) / span) * (HEIGHT - 2 * PAD_Y);
  const path = (key: "portfolio" | "benchmark") =>
    points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <View
      className="mt-3"
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Chart: portfolio ${formatPct(last.portfolio, { signed: true })}, ${benchmarkLabel} ${formatPct(
        last.benchmark,
        { signed: true },
      )} from ${points[0].date} to ${last.date}`}
    >
      <View className="flex-row justify-between">
        <Text className="stat-sub">{formatPct(hi, { signed: true })}</Text>
      </View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: HEIGHT }}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            <Line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={colors.border} strokeWidth={1} />
            <Path d={path("benchmark")} stroke={colors.accent} strokeWidth={2} strokeDasharray="6 4" fill="none" />
            <Path d={path("portfolio")} stroke={colors.primary} strokeWidth={2.5} fill="none" />
          </Svg>
        ) : null}
      </View>
      <View className="flex-row justify-between">
        <Text className="stat-sub">{formatPct(lo, { signed: true })}</Text>
      </View>
      <View className="mt-2 flex-row gap-4">
        <View className="flex-row items-center gap-1.5">
          <View style={{ width: 16, height: 3, backgroundColor: colors.primary, borderRadius: 2 }} />
          <Text className="stat-sub">Portfolio</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View style={{ width: 16, height: 0, borderTopWidth: 2, borderStyle: "dashed", borderColor: colors.accent }} />
          <Text className="stat-sub">{benchmarkLabel}</Text>
        </View>
      </View>
    </View>
  );
}
