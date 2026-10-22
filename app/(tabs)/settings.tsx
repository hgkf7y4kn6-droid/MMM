import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Share, Text } from "react-native";

import { Icon } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import { icons } from "@/constants/icons";
import { api, apiConfigured, ApiError } from "@/lib/api";
import { useEntitlements } from "@/lib/entitlements";

function Row({ label, value, onPress, danger }: { label: string; value?: string; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable className="settings-row" onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : "text"}>
      <Text className={danger ? "btn-danger-text text-base" : "settings-label"}>{label}</Text>
      {value ? <Text className="settings-value">{value}</Text> : onPress ? <Icon name={icons.forward} className="text-lg text-muted-foreground" /> : null}
    </Pressable>
  );
}

export default function Settings() {
  const { me } = useEntitlements();
  const [status, setStatus] = useState<string | null>(null);
  const plan = me ? (me.entitlement.plan === "pro" ? "Pro" : "Free") : apiConfigured() ? "…" : "Not connected";

  const exportData = async () => {
    setStatus(null);
    try {
      const data = await api.exportMyData();
      await Share.share({ title: "Mindful Money data export", message: JSON.stringify(data, null, 2) });
    } catch (e) {
      setStatus(e instanceof ApiError ? e.message : "Export failed.");
    }
  };

  const deleteData = () =>
    Alert.alert(
      "Delete your data?",
      "This permanently deletes your linked accounts, transactions and investment history from Mindful Money.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await api.deleteMyData();
              setStatus(res.note ?? "Your data was deleted.");
            } catch (e) {
              setStatus(e instanceof ApiError ? e.message : "Deletion failed.");
            }
          },
        },
      ],
    );

  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <ScrollView contentContainerClassName="screen-pad">
        <Text className="screen-title" accessibilityRole="header">
          Settings
        </Text>
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
