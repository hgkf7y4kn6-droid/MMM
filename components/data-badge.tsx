import { Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { icons } from "@/constants/icons";
import { formatDate } from "@/lib/format";

/** Where a dataset came from and how fresh it is; demo and stale data are called out. */
export default function DataBadge({ provenance }: { provenance: Pick<Provenance, "source" | "retrieved_at" | "demo" | "stale"> }) {
  return (
    <View className="badge-row">
      {provenance.demo ? (
        <View className="badge badge-warn" accessibilityLabel="Demo data: fictional companies, not market data">
          <Icon name={icons.demo} className="text-xs text-gold-deep" />
          <Text className="badge-text badge-warn-text">Demo data · not market data</Text>
        </View>
      ) : (
        <View className="badge">
          <Text className="badge-text">Source: {provenance.source}</Text>
        </View>
      )}
      {provenance.retrieved_at ? (
        <View className="badge">
          <Text className="badge-text">As of {formatDate(provenance.retrieved_at)}</Text>
        </View>
      ) : null}
      {provenance.stale ? (
        <View className="badge badge-warn" accessibilityLabel="Stale data: the provider couldn't be refreshed">
          <Text className="badge-text badge-warn-text">Stale · refresh failed</Text>
        </View>
      ) : null}
    </View>
  );
}
