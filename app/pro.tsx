import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import BackLink from "@/components/back-link";
import { PRO_FEATURE_COPY } from "@/components/pro-lock";
import { SafeAreaView } from "@/components/safe-area-view";
import { BILLING_RETURN_URL } from "@/constants/config";
import { api, ApiError } from "@/lib/api";
import { useEntitlements } from "@/lib/entitlements";
import { formatDate } from "@/lib/format";

const STATUS_COPY: Record<string, string> = {
  active: "Active",
  trialing: "Free trial",
  grace: "Payment issue — access continues while billing retries",
  canceled: "Canceled — access until the end of the paid period",
  expired: "Expired",
  admin: "Admin",
  complimentary: "Complimentary",
  ungated: "All features unlocked",
  none: "Free plan",
};

const PRO_LIST: ProFeature[] = [
  "fcf_vs_benchmark",
  "roic",
  "dividend_vs_benchmark",
  "capital_allocation",
  "portfolio_income_growth",
  "portfolio_income_vs_benchmark",
  "portfolio_performance",
  "export",
];

export default function Pro() {
  const { feature } = useLocalSearchParams<{ feature?: ProFeature }>();
  const { me, refresh } = useEntitlements();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const ent = me?.entitlement;
  const isPro = ent?.plan === "pro";

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const openUrl = async (url: string) => {
    await WebBrowser.openAuthSessionAsync(url, BILLING_RETURN_URL);
    await refresh();
  };

  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <ScrollView contentContainerClassName="screen-pad">
        <BackLink />
        <Text className="pro-kicker">KaventaFi Pro</Text>
        <Text className="screen-title" accessibilityRole="header">
          {isPro ? "You have Pro" : "Research that compounds"}
        </Text>
        {feature && PRO_FEATURE_COPY[feature] ? (
          <Text className="screen-subtitle">{PRO_FEATURE_COPY[feature].title} is part of Pro.</Text>
        ) : null}

        <View className="card section-gap">
          <Text className="stat-label">Your plan</Text>
          <Text className="stat-value">{isPro ? "Pro" : "Free"}</Text>
          <Text className="stat-sub">
            {STATUS_COPY[ent?.status ?? "none"] ?? ent?.status}
            {ent?.access_until ? ` · ${ent.cancel_at_period_end || ent.status === "canceled" ? "ends" : "renews"} ${formatDate(ent.access_until)}` : ""}
          </Text>
        </View>

        <View className="card section-gap">
          <Text className="card-title">Pro includes</Text>
          {PRO_LIST.map((f) => (
            <View key={f} className="mt-3">
              <Text className="metric-detail-strong">{PRO_FEATURE_COPY[f].title}</Text>
              <Text className="card-caption mt-0">{PRO_FEATURE_COPY[f].pitch}</Text>
            </View>
          ))}
          <Text className="card-caption mt-4">
            Free always includes the stock analysis matrix, dividend history, your holdings and income overview, and
            exporting or deleting your data.
          </Text>
        </View>

        {!isPro ? (
          <Pressable
            className="btn section-gap"
            disabled={!!busy || !me?.pricing.web_checkout}
            style={!me?.pricing.web_checkout ? { opacity: 0.5 } : undefined}
            onPress={() => run("checkout", async () => openUrl((await api.checkout(BILLING_RETURN_URL)).url))}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!busy || !me?.pricing.web_checkout, busy: busy === "checkout" }}
          >
            <Text className="btn-text">
              {busy === "checkout" ? "Opening checkout…" : me?.pricing.display ? `Upgrade · ${me.pricing.display}` : "Upgrade to Pro"}
            </Text>
          </Pressable>
        ) : ent?.provider === "stripe" ? (
          <Pressable
            className="btn-outline section-gap"
            disabled={!!busy}
            onPress={() => run("portal", async () => openUrl((await api.billingPortal(BILLING_RETURN_URL)).url))}
            accessibilityRole="button"
          >
            <Text className="btn-outline-text">{busy === "portal" ? "Opening…" : "Manage billing"}</Text>
          </Pressable>
        ) : ent?.provider === "revenuecat" ? (
          <Text className="card-caption section-gap">Manage this subscription in your App Store or Google Play settings.</Text>
        ) : null}

        <Pressable
          className="btn-outline mt-3"
          disabled={!!busy}
          onPress={() =>
            run("restore", async () => {
              await api.syncBilling();
              await refresh();
              setMessage("Your plan is up to date.");
            })
          }
          accessibilityRole="button"
        >
          <Text className="btn-outline-text">{busy === "restore" ? "Checking…" : "Restore purchase"}</Text>
        </Pressable>
        {me && !me.pricing.web_checkout && !isPro ? (
          <Text className="card-caption mt-3">Pro sign-ups aren&apos;t open on this server yet.</Text>
        ) : null}
        {message ? (
          <Text className="card-caption mt-3" accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}
        <Text className="disclaimer">
          Prices and billing terms are shown at checkout. Subscriptions renew until canceled; you keep access through
          the end of a paid period after canceling.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
