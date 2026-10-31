import { useUser } from "@clerk/expo";
import dayjs from "dayjs";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import ListHeading from "@/components/list-heading";
import { SafeAreaView } from "@/components/safe-area-view";
import StatusView from "@/components/status-view";
import SubscriptionCard from "@/components/subscription-card";
import UpcomingSubscriptionCard from "@/components/upcoming-subscription-card";
import { icons } from "@/constants/icons";
import { openImports } from "@/lib/imports";
import { addSubscription, editSubscription, useSubscriptions } from "@/lib/subscriptions";
import { useThemeColors } from "@/lib/theme";
import { formatCurrency } from "@/lib/utils";

const HOME_LIST_LIMIT = 5;
const UPCOMING_DAYS = 30;

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

function EmptyState() {
  return (
    <View className="empty-card">
      <Icon name={icons.wallet} className="empty-card-icon" />
      <Text className="empty-card-title">Track your first subscription</Text>
      <Text className="empty-card-text">
        Snap a receipt or upload a statement and we&apos;ll find what bills you on repeat, total it up and show you
        what renews next.
      </Text>
      <Pressable className="btn mt-5 self-stretch" onPress={openImports} accessibilityRole="button">
        <Text className="btn-text">Find my subscriptions</Text>
      </Pressable>
      <Pressable className="btn-outline mt-3 self-stretch" onPress={addSubscription} accessibilityRole="button">
        <Text className="btn-outline-text">Add one by hand</Text>
      </Pressable>
    </View>
  );
}

export default function Home() {
  const { user } = useUser();
  const colors = useThemeColors();
  const { subscriptions, summary, loading, error, refresh } = useSubscriptions();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const name = user?.firstName || user?.username || "there";
  const initials = (user?.firstName?.[0] ?? user?.username?.[0] ?? "M").toUpperCase() + (user?.lastName?.[0] ?? "").toUpperCase();

  const upcoming = useMemo(
    () => subscriptions.filter((s) => s.status === "active" && s.days_until_renewal <= UPCOMING_DAYS),
    [subscriptions],
  );
  const shown = subscriptions.slice(0, HOME_LIST_LIMIT);
  const hasAny = subscriptions.length > 0;

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <FlatList
        data={hasAny ? shown : []}
        keyExtractor={(item) => item.id}
        extraData={expanded}
        renderItem={({ item }) => (
          <SubscriptionCard
            {...item}
            expanded={expanded === item.id}
            onPress={() => setExpanded((current) => (current === item.id ? null : item.id))}
            onEdit={() => editSubscription(item.id)}
          />
        )}
        ItemSeparatorComponent={() => <View className="h-3" />}
        showsVerticalScrollIndicator={false}
        contentContainerClassName="screen-pad"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <>
            <View className="screen-head">
              <Pressable
                className="home-user flex-1"
                onPress={() => router.push("/settings")}
                accessibilityRole="button"
                accessibilityLabel="Account and settings"
              >
                <View className="home-avatar">
                  <Text className="home-avatar-text">{initials}</Text>
                </View>
                <View className="flex-1">
                  <Text className="home-greeting">{greeting()},</Text>
                  <Text className="home-user-name" numberOfLines={1}>
                    {name}
                  </Text>
                </View>
              </Pressable>
              <Pressable className="icon-btn" onPress={addSubscription} accessibilityRole="button" accessibilityLabel="Add a subscription">
                <Icon name="add" className="icon-btn-glyph" />
              </Pressable>
            </View>

            <LinearGradient
              colors={["#0e3b45", "#125a5c", "#1c7a63"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ marginTop: 16, borderRadius: 28, padding: 20, overflow: "hidden" }}
            >
              <View pointerEvents="none" style={{ position: "absolute", right: -28, top: -28, width: 120, height: 120, borderRadius: 60, backgroundColor: "#d7b740", opacity: 0.22 }} />
              <Text className="home-balance-label">Subscriptions per month</Text>
              <View className="home-balance-row">
                <Text className="home-balance-amount" adjustsFontSizeToFit numberOfLines={1}>
                  {summary?.monthly_total != null
                    ? formatCurrency(summary.monthly_total, summary.currency ?? "USD")
                    : loading
                      ? "—"
                      : hasAny
                        ? "Mixed"
                        : formatCurrency(0)}
                </Text>
              </View>
              <View className="home-balance-foot">
                <Text className="home-balance-sub">
                  {summary?.yearly_total != null
                    ? `${formatCurrency(summary.yearly_total, summary.currency ?? "USD")} a year · ${summary.active_count} active`
                    : summary && hasAny
                      ? `${summary.active_count} active · several currencies`
                      : "Nothing tracked yet"}
                </Text>
                {summary?.next_renewal_date ? (
                  <Text className="home-balance-sub">Next {dayjs(summary.next_renewal_date).format("MMM D")}</Text>
                ) : null}
              </View>
            </LinearGradient>

            {loading || error ? (
              <View className="mt-6">
                <StatusView loading={loading} error={error} onRetry={refresh} rows={3} />
              </View>
            ) : !hasAny ? (
              <View className="mt-6">
                <EmptyState />
              </View>
            ) : (
              <>
                {upcoming.length > 0 ? (
                  <View>
                    <ListHeading title="Coming up" />
                    <FlatList
                      data={upcoming}
                      keyExtractor={(item) => item.id}
                      renderItem={({ item }) => <UpcomingSubscriptionCard {...item} />}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    />
                  </View>
                ) : null}
                <ListHeading
                  title="Your subscriptions"
                  onPress={subscriptions.length > HOME_LIST_LIMIT ? () => router.push("/subscriptions") : undefined}
                />
              </>
            )}
          </>
        }
      />
    </SafeAreaView>
  );
}
