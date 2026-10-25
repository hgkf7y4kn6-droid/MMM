import { Pressable, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { categoryFor } from "@/constants/categories";
import { editSubscription } from "@/lib/subscriptions";
import { formatCurrency } from "@/lib/utils";

const due = (days: number) => (days <= 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`);

export default function UpcomingSubscriptionCard({ id, name, price, currency, days_until_renewal, category }: Subscription) {
  const look = categoryFor(category);
  return (
    <Pressable
      className="upcoming-card"
      onPress={() => editSubscription(id)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${formatCurrency(price, currency)}, ${due(days_until_renewal).toLowerCase()}`}
    >
      <View className="upcoming-row">
        <View className="sub-icon-wrap" style={{ backgroundColor: look.color }}>
          <Icon name={look.icon} className="text-xl text-[#1a1a20]" />
        </View>
        <View className="flex-1">
          <Text className="upcoming-price" numberOfLines={1}>
            {formatCurrency(price, currency)}
          </Text>
          <Text className="upcoming-meta" numberOfLines={1}>
            {due(days_until_renewal)}
          </Text>
        </View>
      </View>
      <Text className="upcoming-name" numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}
