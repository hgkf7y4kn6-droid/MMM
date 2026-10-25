import { clsx } from "clsx";
import { Pressable, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { billingLabel, categoryFor } from "@/constants/categories";
import { formatCurrency, formatStatusLabel, formatSubscriptionDateTime } from "@/lib/utils";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="sub-row">
      <View className="sub-row-copy">
        <Text className="sub-label">{label}</Text>
        <Text className="sub-value" numberOfLines={1} ellipsizeMode="tail">
          {value}
        </Text>
      </View>
    </View>
  );
}

export const renewalPhrase = (days: number) =>
  days <= 0 ? "Renews today" : days === 1 ? "Renews tomorrow" : `Renews in ${days} days`;

/** A tracked subscription; tap to expand its details, then Edit to change it. */
export default function SubscriptionCard({
  name,
  price,
  currency,
  billing,
  category,
  plan,
  renewal_date,
  days_until_renewal,
  payment_method,
  start_date,
  status,
  monthly_cost,
  expanded,
  onPress,
  onEdit,
}: SubscriptionCardProps) {
  const look = categoryFor(category);
  const active = status === "active";
  // The category color only shows while collapsed; expanded cards use the
  // neutral theme surface so the details stay readable.
  const colored = !expanded;

  return (
    <Pressable
      onPress={onPress}
      className={clsx("sub-card", expanded && "sub-card-expanded")}
      style={colored ? { backgroundColor: look.color, opacity: active ? 1 : 0.7 } : undefined}
      accessibilityRole="button"
      accessibilityState={{ expanded: !!expanded }}
      accessibilityLabel={`${name}, ${formatCurrency(price, currency)} ${billingLabel(billing).toLowerCase()}${active ? `, ${renewalPhrase(days_until_renewal).toLowerCase()}` : `, ${status}`}`}
    >
      <View className="sub-head">
        <View className="sub-main">
          <View className="sub-icon-wrap" style={expanded ? { backgroundColor: look.color } : undefined}>
            <Icon name={look.icon} className="text-2xl text-[#1a1a20]" />
          </View>
          <View className="sub-copy">
            <Text numberOfLines={1} className={clsx("sub-title", colored && "sub-on-color")}>
              {name}
            </Text>
            {active ? (
              <Text numberOfLines={1} className={clsx("sub-meta", colored && "sub-on-color-muted")}>
                {renewalPhrase(days_until_renewal)}
              </Text>
            ) : (
              <Text className="sub-status">{formatStatusLabel(status)}</Text>
            )}
          </View>
        </View>
        <View className="sub-price-box">
          <Text className={clsx("sub-price", colored && "sub-on-color")}>{formatCurrency(price, currency)}</Text>
          <Text className={clsx("sub-billing", colored && "sub-on-color-muted")}>{billingLabel(billing)}</Text>
        </View>
      </View>

      {expanded && (
        <View className="sub-body">
          <View className="sub-details">
            <Row label="Next charge" value={active ? formatSubscriptionDateTime(renewal_date) : formatStatusLabel(status)} />
            {billing !== "monthly" ? <Row label="Per month" value={formatCurrency(monthly_cost, currency)} /> : null}
            <Row label="Category" value={category?.trim() || "Other"} />
            {plan ? <Row label="Plan" value={plan} /> : null}
            <Row label="Paid with" value={payment_method?.trim() || "Not provided"} />
            {start_date ? <Row label="Started" value={formatSubscriptionDateTime(start_date)} /> : null}
          </View>
          {onEdit ? (
            <Pressable className="btn-outline mt-4" onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${name}`}>
              <Text className="btn-outline-text">Edit</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}
