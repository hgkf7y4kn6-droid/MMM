import { clsx } from "clsx";
import { Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { formatCurrency } from "@/lib/utils";

export default function SubscriptionCard({
  name,
  price,
  currency,
  icon,
  billing,
  color,
}: SubscriptionCardProps) {
  return (
    <View
      className={clsx("sub-card", !color && "bg-card")}
      style={color ? { backgroundColor: color } : undefined}
    >
      <View className="sub-head">
        <View className="sub-main">
          <Icon
            name={icon}
            className={clsx("sub-icon", color && "sub-on-color")}
          />
          <View className="sub-copy">
            <Text
              numberOfLines={1}
              className={clsx("sub-title", color && "sub-on-color")}
            >
              {name}
            </Text>
          </View>
        </View>
        <View className="sub-price-box">
          <Text className={clsx("sub-price", color && "sub-on-color")}>
            {formatCurrency(price, currency)}
          </Text>
          <Text className={clsx("sub-billing", color && "sub-on-color-muted")}>
            {billing === "yearly" ? "Yearly" : "Monthly"}
          </Text>
        </View>
      </View>
    </View>
  );
}
