import { clsx } from "clsx";
import { Pressable, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import {
  formatCurrency,
  formatStatusLabel,
  formatSubscriptionDateTime,
} from "@/lib/utils";

export default function SubscriptionCard({
  name,
  price,
  currency,
  icon,
  billing,
  color,
  category,
  plan,
  renewalDate,
  paymentMethod,
  startDate,
  status,
  expanded,
  onPress,
}: SubscriptionCardProps) {
  // The custom color only shows while collapsed; expanded cards use the
  // neutral theme surface so the details stay readable.
  const colored = !!color && !expanded;

  return (
    <Pressable
      onPress={onPress}
      className={clsx(
        "sub-card",
        expanded ? "sub-card-expanded" : !colored && "bg-card",
      )}
      style={colored ? { backgroundColor: color } : undefined}
    >
      <View className="sub-head">
        <View className="sub-main">
          <Icon
            name={icon}
            className={clsx("sub-icon", colored && "sub-on-color")}
          />
          <View className="sub-copy">
            <Text
              numberOfLines={1}
              className={clsx("sub-title", colored && "sub-on-color")}
            >
              {name}
            </Text>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              className={clsx("sub-meta", colored && "sub-on-color-muted")}
            >
              {category?.trim() ||
                plan?.trim() ||
                (renewalDate ? formatSubscriptionDateTime(renewalDate) : "")}
            </Text>
          </View>
        </View>
        <View className="sub-price-box">
          <Text className={clsx("sub-price", colored && "sub-on-color")}>
            {formatCurrency(price, currency)}
          </Text>
          <Text
            className={clsx("sub-billing", colored && "sub-on-color-muted")}
          >
            {billing === "yearly" ? "Yearly" : "Monthly"}
          </Text>
        </View>
      </View>

      {expanded && (
        <View className="sub-body">
          <View className="sub-details">
            <View className="sub-row">
              <View className="sub-row-copy">
                <Text className="sub-label">Payment</Text>
                <Text
                  className="sub-value"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {paymentMethod?.trim() || "Not provided"}
                </Text>
              </View>
            </View>
            <View className="sub-row">
              <View className="sub-row-copy">
                <Text className="sub-label">Category</Text>
                <Text
                  className="sub-value"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {category?.trim() || plan?.trim() || "Not provided"}
                </Text>
              </View>
            </View>
            <View className="sub-row">
              <View className="sub-row-copy">
                <Text className="sub-label">Started</Text>
                <Text
                  className="sub-value"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {formatSubscriptionDateTime(startDate)}
                </Text>
              </View>
            </View>
            <View className="sub-row">
              <View className="sub-row-copy">
                <Text className="sub-label">Renewal</Text>
                <Text
                  className="sub-value"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {formatSubscriptionDateTime(renewalDate)}
                </Text>
              </View>
            </View>
            <View className="sub-row">
              <View className="sub-row-copy">
                <Text className="sub-label">Status</Text>
                <Text
                  className="sub-value"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {formatStatusLabel(status)}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}
