import { Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { formatCurrency } from "@/lib/utils";

export default function UpcomingSubscriptionCard({
  name,
  price,
  currency,
  daysLeft,
  icon,
}: UpcomingSubscription) {
  return (
    <View className="upcoming-card">
      <View className="upcoming-row">
        <Icon name={icon} className="upcoming-icon" />
        <View>
          <Text className="upcoming-price">
            {formatCurrency(price, currency)}
          </Text>
          <Text className="upcoming-meta" numberOfLines={1}>
            {daysLeft > 1 ? `${daysLeft} days left` : "Last day"}
          </Text>
        </View>
      </View>
      <Text className="upcoming-name" numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}
