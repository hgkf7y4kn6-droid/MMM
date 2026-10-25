import { useAuth, useUser } from "@clerk/expo";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Share, Text } from "react-native";

import { Icon } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import { icons } from "@/constants/icons";
import { api, apiConfigured, ApiError } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { useEntitlements } from "@/lib/entitlements";
import { useSubscriptions } from "@/lib/subscriptions";

function Row({ label, value, onPress, danger }: { label: string; value?: string; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable className="settings-row" onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : "text"}>
      <Text className={danger ? "btn-danger-text text-base" : "settings-label"}>{label}</Text>
      {value ? (
        <Text className="settings-value ml-4 flex-shrink" numberOfLines={1}>
          {value}
        </Text>
      ) : onPress ? <Icon name={icons.forward} className="text-lg text-muted-foreground" /> : null}
    </Pressable>
  );
}

export default function Settings() {
  const { me } = useEntitlements();
  const { signOut } = useAuth();
  const { user } = useUser();
  const { refresh: refreshSubscriptions } = useSubscriptions();
  const [status, setStatus] = useState<string | null>(null);
  const plan = me ? (me.entitlement.plan === "pro" ? "Pro" : "Free") : apiConfigured() ? "…" : "Not connected";
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.username ?? "";

  const exportData = async () => {
    setStatus(null);
    try {
      const data = await api.exportMyData();
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === "web") {
        // Browsers: save a file (the share sheet isn't available on most desktops).
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `mindful-money-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setStatus("Your data was downloaded.");
      } else {
        await Share.share({ title: "Mindful Money data export", message: json });
      }
    } catch (e) {
      setStatus(e instanceof ApiError ? e.message : "Export failed.");
    }
  };

  const deleteData = async () => {
    const ok = await confirm(
      "Delete your data?",
      "This permanently deletes your tracked subscriptions, linked accounts, transactions and investment history from Mindful Money. Your sign-in account stays, so you can keep using the app.",
      "Delete",
    );
    if (!ok) return;
    try {
      const res = await api.deleteMyData();
      await refreshSubscriptions();
      setStatus(res.note ?? "Your data was deleted.");
    } catch (e) {
      setStatus(e instanceof ApiError ? e.message : "Deletion failed.");
    }
  };

  const doSignOut = async () => {
    if (await confirm("Sign out?", "You can sign back in any time with the same account.", "Sign out")) await signOut();
  };

  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <ScrollView contentContainerClassName="screen-pad">
        <Text className="screen-title" accessibilityRole="header">
          Settings
        </Text>
        <Text className="list-title mt-6">Account</Text>
        <Row label="Signed in as" value={email} />
        <Row label="Sign out" onPress={doSignOut} />
        <Text className="list-title mt-6">Plan</Text>
        <Row label="Mindful Money Pro" value={plan} />
        <Row label={me?.entitlement.plan === "pro" ? "Manage subscription" : "Upgrade to Pro"} onPress={() => router.push("/pro")} />
        <Text className="list-title mt-6">Your data</Text>
        <Row label="Export my data" onPress={apiConfigured() ? exportData : undefined} />
        <Row label="Delete my data" onPress={apiConfigured() ? deleteData : undefined} danger />
        {status ? (
          <Text className="card-caption" accessibilityLiveRegion="polite">
            {status}
          </Text>
        ) : null}
        <Text className="list-title mt-6">About</Text>
        <Row label="Methodology & disclosures" onPress={() => router.push("/disclosures")} />
        <Row label="Version" value={Constants.expoConfig?.version ?? "—"} />
      </ScrollView>
    </SafeAreaView>
  );
}
