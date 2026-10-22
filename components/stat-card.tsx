import { clsx } from "clsx";
import { Text, View } from "react-native";

import SignalIcon from "@/components/signal-icon";

/** A headline figure with a label and an optional caption. */
export default function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: "good" | "bad" | null;
}) {
  return (
    <View
      className="stat-card"
      accessible
      accessibilityLabel={`${label}: ${value}${tone === "good" ? ", favorable" : tone === "bad" ? ", unfavorable" : ""}${sub ? `. ${sub}` : ""}`}
    >
      <Text className="stat-label">{label}</Text>
      <View className="flex-row items-center gap-1.5">
        <SignalIcon signal={tone === "good" ? 1 : tone === "bad" ? -1 : 0} />
        <Text className={clsx("stat-value", tone === "good" && "metric-good", tone === "bad" && "metric-bad")}>{value}</Text>
      </View>
      {sub ? <Text className="stat-sub">{sub}</Text> : null}
    </View>
  );
}
