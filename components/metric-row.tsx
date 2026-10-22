import { clsx } from "clsx";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import SignalIcon from "@/components/signal-icon";
import { formatMetric, signal, statusLabel } from "@/lib/format";

/**
 * One metric: label and value, with a favorable/unfavorable icon (not just
 * color) when the sign is meaningful. A missing value shows why ("Not meaningful: the
 * beginning value is negative…") instead of a number. Tap for the formula,
 * period and notes.
 */
export default function MetricRow({
  label,
  metric,
  help,
  higherIsBetter,
  metricKey,
  currency,
}: {
  label: string;
  metric: Metric;
  help?: string;
  higherIsBetter?: boolean | null;
  metricKey?: string;
  currency?: string;
}) {
  const [open, setOpen] = useState(false);
  const has = metric.value != null;
  const s = has ? signal(metric, higherIsBetter) : 0;
  const value = has ? formatMetric(metric, { key: metricKey, currency }) : statusLabel(metric.status);
  const tone = s > 0 ? "favorable" : s < 0 ? "unfavorable" : "";

  return (
    <Pressable
      className="metric-row"
      onPress={() => setOpen((o) => !o)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}: ${value}${tone ? `, ${tone}` : ""}${metric.period ? `, ${metric.period}` : ""}`}
      accessibilityHint="Shows how this is calculated"
    >
      <View className="metric-head">
        <Text className="metric-label">{label}</Text>
        <View className="flex-row items-center gap-1.5">
          <SignalIcon signal={s} />
          <Text className={clsx(has ? "metric-value" : "metric-value-na", s > 0 && "metric-good", s < 0 && "metric-bad")}>
            {value}
          </Text>
        </View>
      </View>
      {!has && metric.reason ? <Text className="metric-reason">{metric.reason}</Text> : null}
      {open ? (
        <View className="metric-detail">
          {help ? <Text className="metric-detail-text">{help}</Text> : null}
          {metric.formula ? (
            <Text className="metric-detail-text">
              <Text className="metric-detail-strong">Formula </Text>
              {metric.formula}
            </Text>
          ) : null}
          {metric.period ? (
            <Text className="metric-detail-text">
              <Text className="metric-detail-strong">Period </Text>
              {metric.period}
            </Text>
          ) : null}
          {metric.notes.map((n) => (
            <Text key={n} className="metric-detail-text">
              {n}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}
