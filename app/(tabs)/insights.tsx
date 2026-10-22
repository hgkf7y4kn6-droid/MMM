import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import Disclaimer from "@/components/disclaimer";
import { Icon } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import StatusView from "@/components/status-view";
import { icons } from "@/constants/icons";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useThemeColors } from "@/lib/theme";

const QUESTIONS = [
  "How quickly is the business growing?",
  "How much free cash flow does it generate, and how much capital does growth need?",
  "What return does that capital earn?",
  "Is dividend growth backed by the business — and beating the S&P 500?",
];

export default function Insights() {
  const colors = useThemeColors();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const search = useApi(`search:${debounced}`, () => api.searchStocks(debounced));
  const results = search.data?.results ?? [];

  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <FlatList
        data={results}
        keyExtractor={(item) => item.symbol}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="screen-pad"
        ListHeaderComponent={
          <>
            <Text className="screen-title" accessibilityRole="header">
              Dividend growth
            </Text>
            <Text className="screen-subtitle">
              Research how companies turn capital into growth, cash and rising dividends.
            </Text>

            <Animated.View entering={FadeInDown.duration(400)}>
              <Pressable
                className="card section-gap flex-row items-center justify-between"
                onPress={() => router.push("/portfolio")}
                accessibilityRole="button"
                accessibilityLabel="Open your portfolio: income growth and performance versus the S&P 500"
              >
                <View className="flex-1 pr-3">
                  <Text className="card-title">Your portfolio</Text>
                  <Text className="card-caption">
                    Income growth toward a 7–10%+ objective, and total return vs the S&P 500.
                  </Text>
                </View>
                <Icon name={icons.portfolio} className="text-3xl text-primary" />
              </Pressable>
            </Animated.View>

            <View className="search-box">
              <Icon name={icons.search} className="text-lg text-muted-foreground" />
              <TextInput
                className="search-input"
                value={query}
                onChangeText={setQuery}
                placeholder="Search a ticker or company"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search stocks"
              />
            </View>
            <Text className="list-title mt-6" accessibilityRole="header">
              {debounced ? "Results" : "Explore"}
            </Text>
            <StatusView
              loading={search.loading && !results.length}
              error={search.error}
              onRetry={search.reload}
              empty={!search.loading && !search.error && debounced && !results.length ? "No matches." : null}
            />
          </>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(300)}>
            <Pressable
              className="list-row"
              onPress={() => router.push({ pathname: "/stocks/[symbol]", params: { symbol: item.symbol } })}
              accessibilityRole="button"
              accessibilityLabel={`${item.symbol}, ${item.name ?? ""}${item.demo ? ", demo company" : ""}`}
            >
              <View className="flex-1 pr-3">
                <Text className="list-row-title">{item.symbol}</Text>
                <Text className="list-row-sub" numberOfLines={1}>
                  {[item.name, item.sector].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <Icon name={icons.forward} className="text-lg text-muted-foreground" />
            </Pressable>
          </Animated.View>
        )}
        ListFooterComponent={
          <>
            {!debounced ? (
              <View className="card section-gap">
                <Text className="card-title">What the analysis answers</Text>
                {QUESTIONS.map((q) => (
                  <Text key={q} className="card-caption">
                    • {q}
                  </Text>
                ))}
                <Text className="card-caption">
                  No single score: each figure shows its formula, period and source, and says so when it isn&apos;t
                  meaningful.
                </Text>
              </View>
            ) : null}
            <Disclaimer />
          </>
        }
      />
    </SafeAreaView>
  );
}
