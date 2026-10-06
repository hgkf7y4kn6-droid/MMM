import dayjs from "dayjs";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import ListHeading from "@/components/list-heading";
import { SafeAreaView } from "@/components/safe-area-view";
import SubscriptionCard from "@/components/subscription-card";
import UpcomingSubscriptionCard from "@/components/upcoming-subscription-card";
import {
  homeBalance,
  homeSubscriptions,
  homeUser,
  upcomingSubscriptions,
} from "@/constants/data";
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
  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<
    string | null
  >(null);

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
            {dayjs(homeBalance.nextRenewalDate).format("MM/DD")}
          </Text>
        </View>
      </View>

      <View>
        <ListHeading title="Upcoming" />
        <FlatList
          data={upcomingSubscriptions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <UpcomingSubscriptionCard {...item} />}
          horizontal
          showsHorizontalScrollIndicator={false}
          ListEmptyComponent={
            <Text className="home-empty-state">No upcoming renewals yet.</Text>
          }
        />
      </View>

      <View>
        <ListHeading title="All Subscriptions" />
        <FlatList
          data={homeSubscriptions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SubscriptionCard
              {...item}
              expanded={expandedSubscriptionId === item.id}
              onPress={() =>
                setExpandedSubscriptionId((currentId) =>
                  currentId === item.id ? null : item.id,
                )
              }
            />
          )}
        />
      </View>
    </SafeAreaView>
  );
}
