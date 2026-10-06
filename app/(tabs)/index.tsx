import dayjs from "dayjs";
import { Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import { homeBalance, homeUser } from "@/constants/data";
import { icons } from "@/constants/icons";
import { formatCurrency } from "@/lib/utils";

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export default function Index() {
  return (
    <SafeAreaView className="flex-1 bg-background p-5">
      <View className="home-header">
        <View className="home-user">
          <View className="home-avatar">
            <Text className="home-avatar-text">{initials(homeUser.name)}</Text>
          </View>
          <Text className="home-user-name">{homeUser.name}</Text>
        </View>
        <Icon name={icons.add} className="home-add-icon" />
      </View>

      <View className="home-balance-card">
        <Text className="home-balance-label">Monthly subscriptions</Text>
        <View className="home-balance-row">
          <Text className="home-balance-amount">
            {formatCurrency(homeBalance.amount)}
          </Text>
          <Text className="home-balance-date">
            Next: {dayjs(homeBalance.nextRenewalDate).format("MMM D")}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
