import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

import BackLink from "@/components/back-link";
import { Icon } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import StatusView from "@/components/status-view";
import { api, ApiError } from "@/lib/api";
import { useEntitlements } from "@/lib/entitlements";
import { formatDate } from "@/lib/format";
import { openImport } from "@/lib/imports";
import { pickDocument, pickPhoto } from "@/lib/pick-file";
import { useApi } from "@/lib/use-api";

const SOURCE_LABEL: Record<ImportSource, string> = {
  receipt: "Receipt",
  statement: "Statement",
  csv: "CSV statement",
  linked: "Linked accounts",
};
const STATUS_LABEL: Record<ImportStatus, string> = {
  queued: "Waiting to be read…",
  processing: "Reading…",
  ready: "Ready to review",
  failed: "Couldn't read",
  applied: "Added",
};

/**
 * Free: upload a receipt photo or a statement and we look for subscriptions in it.
 * Pro: scan linked bank transactions instead -- nothing to upload.
 */
export default function Imports() {
  const list = useApi("imports", () => api.imports());
  const { locked } = useEntitlements();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const native = Platform.OS !== "web";
  const readsPhotos = list.data?.reads_photos ?? true;
  const autoDetect = !locked("auto_detect_subscriptions");

  const run = async (name: string, fn: () => Promise<ImportJob | null>) => {
    if (busy) return;
    setBusy(name);
    setError(null);
    try {
      const job = await fn();
      if (job) openImport(job.id);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const upload = (name: string, pick: () => Promise<PickedFile | null>, source: "receipt" | "statement") =>
    run(name, async () => {
      const file = await pick();
      return file ? api.importFile(file, source) : null;
    });

  return (
    <SafeAreaView className="screen" edges={["top"]}>
      <ScrollView contentContainerClassName="screen-pad">
        <BackLink />
        <Text className="screen-title" accessibilityRole="header">
          Find subscriptions
        </Text>
        <Text className="screen-subtitle">
          Upload a receipt or a bank statement and we&apos;ll pick out what bills you on repeat. You review everything
          before it&apos;s added. No bank login needed.
        </Text>

        {autoDetect ? (
          <View className="card section-gap">
            <Text className="pro-kicker">KaventaFi Pro</Text>
            <Text className="card-title">Scan your linked accounts</Text>
            <Text className="card-caption">We look through up to 13 months of synced bank and card transactions.</Text>
            <Pressable
              className="btn mt-3"
              disabled={!!busy}
              onPress={() => run("linked", () => api.importLinked())}
              accessibilityRole="button"
              accessibilityState={{ busy: busy === "linked" }}
            >
              <Text className="btn-text">{busy === "linked" ? "Scanning…" : "Scan linked transactions"}</Text>
            </Pressable>
          </View>
        ) : null}

        <View className="card section-gap">
          <Text className="card-title">Receipt or confirmation</Text>
          <Text className="card-caption">
            A photo or screenshot of a receipt, invoice or “your subscription renews” email.
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {native ? (
              <UploadButton
                label="Take a photo"
                icon="camera"
                busy={busy === "camera"}
                disabled={!!busy || !readsPhotos}
                onPress={() => upload("camera", () => pickPhoto("camera"), "receipt")}
              />
            ) : null}
            <UploadButton
              label={native ? "Choose a photo" : "Upload a photo"}
              icon="image"
              busy={busy === "library"}
              disabled={!!busy || !readsPhotos}
              onPress={() => upload("library", () => pickPhoto("library"), "receipt")}
            />
          </View>
        </View>

        <View className="card section-gap">
          <Text className="card-title">Bank or card statement</Text>
          <Text className="card-caption">
            A PDF statement or a CSV export from your bank. Two or more months find the most: a charge has to repeat for us
            to be sure.
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <UploadButton
              label="Upload a statement"
              icon="document-text"
              busy={busy === "statement"}
              disabled={!!busy}
              onPress={() => upload("statement", pickDocument, "statement")}
            />
          </View>
          {!readsPhotos ? (
            <Text className="card-caption">Photos and PDFs can&apos;t be read on this server yet; CSV exports work.</Text>
          ) : null}
        </View>

        {error ? (
          <Text className="error-text mt-3" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Text className="disclaimer">
          Files are read by our AI document reader and deleted as soon as they&apos;ve been read. We keep only the merchant
          names, dates and amounts needed to suggest subscriptions. Up to {list.data?.max_file_mb ?? 10} MB per file.
        </Text>

        {!autoDetect ? (
          <Pressable
            className="pro-lock section-gap p-4"
            onPress={() => router.push({ pathname: "/pro", params: { feature: "auto_detect_subscriptions" } })}
            accessibilityRole="button"
          >
            <Text className="pro-kicker">KaventaFi Pro</Text>
            <Text className="pro-lock-title">Skip the uploads</Text>
            <Text className="pro-lock-text">
              Link your bank once and we find new subscriptions in your transactions automatically.
            </Text>
          </Pressable>
        ) : null}

        <Text className="list-title mt-6" accessibilityRole="header">
          Recent imports
        </Text>
        <StatusView
          loading={list.loading && !list.data}
          error={list.error}
          onRetry={list.reload}
          empty={list.data && !list.data.imports.length ? "Nothing imported yet." : null}
        />
        {list.data?.imports.map((job) => (
          <Pressable
            key={job.id}
            className="list-row"
            onPress={() => openImport(job.id)}
            accessibilityRole="button"
            accessibilityLabel={`${SOURCE_LABEL[job.source]} ${job.filename ?? ""}, ${STATUS_LABEL[job.status]}`}
          >
            <View className="flex-1">
              <Text className="list-row-title" numberOfLines={1}>
                {job.filename ?? SOURCE_LABEL[job.source]}
              </Text>
              <Text className="list-row-sub">
                {SOURCE_LABEL[job.source]} · {formatDate(job.created_at)} · {STATUS_LABEL[job.status]}
                {job.status === "ready" || job.status === "applied"
                  ? ` · ${job.candidates.length} found`
                  : ""}
              </Text>
            </View>
            <Icon name="chevron-forward" className="text-lg text-muted-foreground" />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function UploadButton({
  label,
  icon,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  icon: "camera" | "image" | "document-text";
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="btn-outline flex-row items-center gap-2"
      style={disabled && !busy ? { opacity: 0.5 } : undefined}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
    >
      <Icon name={icon} className="text-base text-primary" />
      <Text className="btn-outline-text">{busy ? "Uploading…" : label}</Text>
    </Pressable>
  );
}
