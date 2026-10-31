import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import BackLink from "@/components/back-link";
import { Icon } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import StatusView from "@/components/status-view";
import { api } from "@/lib/api";
import { useEntitlements } from "@/lib/entitlements";
import { formatDate, formatMoney } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const editLot = (id = "new") => router.push({ pathname: "/holdings/lot", params: { id } });
const editDividend = (id = "new", symbol?: string) =>
  router.push({ pathname: "/holdings/dividend", params: symbol ? { id, symbol } : { id } });

const shares = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });

/** Free: the shares, cost basis and dividends the user enters by hand. */
export default function Holdings() {
  const data = useApi("holdings", () => api.holdings());
  const { locked } = useEntitlements();
  const { reload } = data;
  // Reload when coming back from the add/edit forms (the first focus is the initial load).
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) first.current = false;
      else reload();
    }, [reload]),
  );
  const h = data.data;
  const empty = h && !h.lots.length && !h.dividends.length;

  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <ScrollView contentContainerClassName="screen-pad">
        <BackLink />
        <View className="screen-head">
          <Text className="screen-title" accessibilityRole="header">
            My holdings
          </Text>
          <Pressable className="icon-btn" onPress={() => editLot()} accessibilityRole="button" accessibilityLabel="Add shares">
            <Icon name="add" className="icon-btn-glyph" />
          </Pressable>
        </View>
        <Text className="screen-subtitle">
          Enter what you own and what you paid. Your portfolio, income and returns are calculated from these.
        </Text>

        {locked("account_linking") ? (
          <Pressable
            className="pro-lock section-gap p-4"
            onPress={() => router.push({ pathname: "/pro", params: { feature: "account_linking" } })}
            accessibilityRole="button"
          >
            <Text className="pro-kicker">KaventaFi Pro</Text>
            <Text className="pro-lock-title">Never type a trade again</Text>
            <Text className="pro-lock-text">
              Link your brokerage and your holdings, cost basis and dividends stay up to date automatically.
            </Text>
          </Pressable>
        ) : null}

        <StatusView loading={data.loading && !h} error={data.error} onRetry={data.reload} />
        {empty ? (
          <View className="empty-card section-gap">
            <Icon name="pie-chart" className="empty-card-icon" />
            <Text className="empty-card-title">No holdings yet</Text>
            <Text className="empty-card-text">Add each purchase as a lot: the ticker, how many shares, and what you paid.</Text>
            <Pressable className="btn mt-5 self-stretch" onPress={() => editLot()} accessibilityRole="button">
              <Text className="btn-text">Add shares</Text>
            </Pressable>
          </View>
        ) : null}

        {h && h.summary.length ? (
          <View className="card section-gap">
            <Text className="card-title" accessibilityRole="header">
              By holding
            </Text>
            <View className="tbl-head mt-3">
              <Text className="tbl-cell tbl-head-text">Symbol</Text>
              <Text className="tbl-cell-num tbl-head-text">Shares</Text>
              <Text className="tbl-cell-num tbl-head-text">Cost basis</Text>
              <Text className="tbl-cell-num tbl-head-text">Divs (12m)</Text>
            </View>
            {h.summary.map((s) => (
              <View
                key={s.symbol}
                className="tbl-row"
                accessible
                accessibilityLabel={`${s.symbol}: ${shares(s.shares)} shares, cost basis ${formatMoney(s.cost_basis)}, ${formatMoney(s.dividends_12m)} dividends in the last 12 months`}
              >
                <Text className="tbl-cell">{s.symbol}</Text>
                <Text className="tbl-cell-num">{shares(s.shares)}</Text>
                <Text className="tbl-cell-num">{formatMoney(s.cost_basis)}</Text>
                <Text className="tbl-cell-num">{formatMoney(s.dividends_12m)}</Text>
              </View>
            ))}
            <Pressable className="btn-outline mt-4" onPress={() => router.push("/portfolio")} accessibilityRole="button">
              <Text className="btn-outline-text">See value and income</Text>
            </Pressable>
          </View>
        ) : null}

        {h && h.lots.length ? (
          <View className="card section-gap">
            <Text className="card-title" accessibilityRole="header">
              Lots
            </Text>
            {h.lots.map((l) => (
              <Pressable key={l.id} className="list-row" onPress={() => editLot(l.id)} accessibilityRole="button">
                <View className="flex-1">
                  <Text className="list-row-title">
                    {l.symbol} · {shares(l.shares)} shares
                  </Text>
                  <Text className="list-row-sub">
                    {l.acquired_on ? `Bought ${formatDate(l.acquired_on)}` : "Purchase date not set"}
                    {l.cost_basis != null ? ` · ${formatMoney(l.cost_basis)} (${formatMoney(l.cost_per_share)}/sh)` : " · Cost not set"}
                    {l.account_label ? ` · ${l.account_label}` : ""}
                  </Text>
                </View>
                <Icon name="chevron-forward" className="text-lg text-muted-foreground" />
              </Pressable>
            ))}
          </View>
        ) : null}

        {h && !empty ? (
          <View className="card section-gap">
            <View className="flex-row items-center justify-between">
              <Text className="card-title" accessibilityRole="header">
                Dividends received
              </Text>
              <Pressable className="min-h-11 justify-center" onPress={() => editDividend()} accessibilityRole="button">
                <Text className="link-text">Add</Text>
              </Pressable>
            </View>
            {!h.dividends.length ? (
              <Text className="card-caption">Record dividend payments to track your income and its growth.</Text>
            ) : null}
            {h.dividends.slice(0, 50).map((d) => (
              <Pressable key={d.id} className="list-row" onPress={() => editDividend(d.id)} accessibilityRole="button">
                <View className="flex-1">
                  <Text className="list-row-title">
                    {d.symbol} · {formatMoney(d.amount)}
                  </Text>
                  <Text className="list-row-sub">
                    Paid {formatDate(d.paid_on)}
                    {d.reinvested ? " · Reinvested" : ""}
                  </Text>
                </View>
                <Icon name="chevron-forward" className="text-lg text-muted-foreground" />
              </Pressable>
            ))}
            {h.dividends.length > 50 ? (
              <Text className="card-caption">Showing the latest 50 of {h.dividends.length}.</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
