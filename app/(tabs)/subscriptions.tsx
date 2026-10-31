import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import SegmentedControl from "@/components/segmented-control";
import StatusView from "@/components/status-view";
import SubscriptionCard from "@/components/subscription-card";
import { CATEGORIES, categoryFor } from "@/constants/categories";
import { icons } from "@/constants/icons";
import { openImports } from "@/lib/imports";
import { addSubscription, editSubscription, useSubscriptions } from "@/lib/subscriptions";
import { useThemeColors } from "@/lib/theme";
import { formatCurrency } from "@/lib/utils";

type Filter = "active" | "inactive" | "all";

export default function Subscriptions() {
  const colors = useThemeColors();
  const { subscriptions, summary, loading, error, refresh } = useSubscriptions();
  const [filter, setFilter] = useState<Filter>("active");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const counts = useMemo(() => {
    const active = subscriptions.filter((s) => s.status === "active").length;
    return { active, inactive: subscriptions.length - active, all: subscriptions.length };
  }, [subscriptions]);

  const shown = useMemo(
    () =>
      subscriptions.filter((s) =>
        filter === "all" ? true : filter === "active" ? s.status === "active" : s.status !== "active",
      ),
    [subscriptions, filter],
  );

  // Monthly spend by category, largest first (single-currency lists only).
  const byCategory = useMemo(() => {
    if (!summary?.currency) return [];
    const totals = new Map<string, number>();
    for (const s of subscriptions) {
      if (s.status !== "active") continue;
      const name = categoryFor(s.category).name;
      totals.set(name, (totals.get(name) ?? 0) + s.monthly_cost);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [subscriptions, summary?.currency]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const emptyText =
    filter === "active"
      ? counts.all
        ? "No active subscriptions. Paused and cancelled ones are under the other filters."
        : null
      : filter === "inactive"
        ? "Nothing paused or cancelled."
        : null;

  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <FlatList
        data={loading || error ? [] : shown}
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
        contentContainerClassName="screen-pad"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View className="mb-4">
            <View className="screen-head">
              <Text className="screen-title" accessibilityRole="header">
                Subscriptions
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  className="icon-btn"
                  onPress={openImports}
                  accessibilityRole="button"
                  accessibilityLabel="Find subscriptions in a receipt or statement"
                >
                  <Icon name="scan" className="icon-btn-glyph" />
                </Pressable>
                <Pressable className="icon-btn" onPress={addSubscription} accessibilityRole="button" accessibilityLabel="Add a subscription">
                  <Icon name="add" className="icon-btn-glyph" />
                </Pressable>
              </View>
            </View>
            <Text className="screen-subtitle">
              {summary?.monthly_total != null && counts.active
                ? `${formatCurrency(summary.monthly_total, summary.currency ?? "USD")} a month across ${counts.active} active`
                : "Everything you pay for on repeat, in one place."}
            </Text>

            {byCategory.length > 1 ? (
              <View className="card section-gap">
                <Text className="card-title">Where it goes</Text>
                <View className="mt-3 gap-2.5">
                  {byCategory.map(([name, total]) => {
                    const share = summary?.monthly_total ? total / summary.monthly_total : 0;
                    const look = CATEGORIES.find((c) => c.name === name) ?? categoryFor(null);
                    return (
                      <View key={name} accessible accessibilityLabel={`${name}: ${formatCurrency(total, summary?.currency ?? "USD")} a month`}>
                        <View className="flex-row items-center justify-between">
                          <Text className="font-sans-medium text-sm text-foreground">{name}</Text>
                          <Text className="font-sans-semibold text-sm text-foreground">
                            {formatCurrency(total, summary?.currency ?? "USD")}
                          </Text>
                        </View>
                        <View className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                          <View className="h-2 rounded-full" style={{ width: `${Math.max(share * 100, 3)}%`, backgroundColor: look.color }} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {counts.all > 0 ? (
              <View className="section-gap">
                <SegmentedControl<Filter>
                  label="Show"
                  value={filter}
                  onChange={(f) => {
                    setFilter(f);
                    setExpanded(null);
                  }}
                  options={[
                    { value: "active", label: `Active (${counts.active})` },
                    { value: "inactive", label: `Paused & cancelled (${counts.inactive})`, disabled: !counts.inactive },
                    { value: "all", label: `All (${counts.all})` },
                  ]}
                />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading || error ? (
            <StatusView loading={loading} error={error} onRetry={refresh} rows={4} />
          ) : counts.all === 0 ? (
            <View className="empty-card">
              <Icon name={icons.wallet} className="empty-card-icon" />
              <Text className="empty-card-title">No subscriptions yet</Text>
              <Text className="empty-card-text">
                Add streaming, software, the gym — anything that bills you on repeat.
              </Text>
              <Pressable className="btn mt-5 self-stretch" onPress={openImports} accessibilityRole="button">
                <Text className="btn-text">Find them in a receipt or statement</Text>
              </Pressable>
              <Pressable className="btn-outline mt-3 self-stretch" onPress={addSubscription} accessibilityRole="button">
                <Text className="btn-outline-text">Add one by hand</Text>
              </Pressable>
            </View>
          ) : (
            <Text className="empty-text">{emptyText}</Text>
          )
        }
      />
    </SafeAreaView>
  );
}
