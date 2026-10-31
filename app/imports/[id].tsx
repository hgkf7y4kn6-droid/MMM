import dayjs from "dayjs";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { FormError } from "@/components/auth-shell";
import BackLink from "@/components/back-link";
import { Icon } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import SegmentedControl from "@/components/segmented-control";
import StatusView from "@/components/status-view";
import { BILLING_CYCLES, billingLabel } from "@/constants/categories";
import { api, ApiError } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { DATE_FORMAT, parseUserDate as parseDate, toFormDate } from "@/lib/dates";
import { useSubscriptions } from "@/lib/subscriptions";
import { useThemeColors } from "@/lib/theme";
import { useApi } from "@/lib/use-api";
import { formatCurrency } from "@/lib/utils";

const POLL_MS = 2000;
const CONFIDENCE: Record<ImportCandidate["confidence"], string> = {
  high: "Very likely",
  medium: "Likely",
  low: "Possible",
};

type Draft = { name: string; price: string; billing: BillingCycle; renewal: string };
const draftOf = (c: ImportCandidate): Draft => ({
  name: c.name,
  price: c.price.toFixed(2),
  billing: c.billing,
  renewal: toFormDate(c.renewal_date),
});

/** Review what an import found and add the ones the user picks. */
export default function ImportReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tick, setTick] = useState(0);
  const job = useApi(`import:${id}:${tick}`, () => api.importJob(id));
  const pending = job.data?.status === "queued" || job.data?.status === "processing";

  // The file is read in the background; check back until it's done.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => clearTimeout(t);
  }, [pending, tick]);

  const data = job.data;
  return (
    <SafeAreaView className="screen" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="screen-pad" keyboardShouldPersistTaps="handled">
        <BackLink />
        <Text className="screen-title" accessibilityRole="header">
          {pending ? "Reading your file…" : "Review subscriptions"}
        </Text>
        {data?.filename ? <Text className="screen-subtitle">{data.filename}</Text> : null}
        <StatusView loading={!data && job.loading} error={!data ? job.error : null} onRetry={job.reload} />
        {pending ? (
          <View className="card section-gap" accessibilityLiveRegion="polite">
            <Text className="card-caption">
              This usually takes under a minute. You can leave this screen; the result is saved under Recent imports.
            </Text>
          </View>
        ) : null}
        {data?.status === "failed" ? (
          <View className="card section-gap">
            <Text className="error-text">{data.error ?? "We couldn't read this file."}</Text>
            <Pressable className="btn-outline mt-3" onPress={() => router.back()} accessibilityRole="button">
              <Text className="btn-outline-text">Try another file</Text>
            </Pressable>
          </View>
        ) : null}
        {data && (data.status === "ready" || data.status === "applied") ? <Candidates job={data} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Candidates({ job }: { job: ImportJob }) {
  const colors = useThemeColors();
  const { refresh } = useSubscriptions();
  const open = job.candidates.filter((c) => !c.added_subscription_id);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(open.filter((c) => !c.already_tracked && c.confidence !== "low").map((c) => c.id)),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(job.candidates.map((c) => [c.id, draftOf(c)])),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = useMemo(() => open.filter((c) => selected.has(c.id)).length, [open, selected]);

  const toggle = (cid: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  const setDraft = (cid: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [cid]: { ...d[cid], ...patch } }));

  const add = async () => {
    setError(null);
    const items: { candidate_id: string; subscription: SubscriptionInput }[] = [];
    for (const c of open.filter((x) => selected.has(x.id))) {
      const d = drafts[c.id];
      const price = Number(d.price.replace(/[^0-9.]/g, ""));
      const renewal = parseDate(d.renewal);
      if (!d.name.trim()) return setError("Each subscription needs a name.");
      if (!Number.isFinite(price) || !d.price.trim()) return setError(`Enter a price for ${d.name}.`);
      if (!renewal) return setError(`Enter the next charge for ${d.name} as ${DATE_FORMAT}.`);
      items.push({
        candidate_id: c.id,
        subscription: {
          name: d.name.trim(),
          price: Math.round(price * 100) / 100,
          currency: c.currency,
          billing: d.billing,
          category: c.category,
          plan: c.plan,
          payment_method: null,
          status: "active",
          start_date: null,
          renewal_date: renewal.format("YYYY-MM-DD"),
          notes: null,
        },
      });
    }
    if (!items.length) return;
    setBusy(true);
    try {
      await api.applyImport(job.id, items);
      await refresh();
      router.replace("/subscriptions");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't add them. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!(await confirm("Delete this import?", "The suggestions from this file will be removed.", "Delete"))) return;
    try {
      await api.deleteImport(job.id);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete it.");
    }
  };

  return (
    <View>
      <Text className="screen-subtitle">
        {job.candidates.length
          ? `We found ${job.candidates.length} possible subscription${job.candidates.length === 1 ? "" : "s"}${
              job.transactions_found ? ` in ${job.transactions_found} charges` : ""
            }. Pick the ones to track; tap Edit to fix anything we got wrong.`
          : "We didn't find any subscriptions in this file."}
      </Text>
      {job.notes.map((n) => (
        <Text key={n} className="card-caption">
          {n}
        </Text>
      ))}

      {job.candidates.map((c) => {
        const d = drafts[c.id];
        const done = !!c.added_subscription_id;
        const on = selected.has(c.id) && !done;
        return (
          <View key={c.id} className="card section-gap" style={done ? { opacity: 0.6 } : undefined}>
            <Pressable
              className="flex-row items-start gap-3"
              onPress={() => !done && toggle(c.id)}
              disabled={done}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on || done, disabled: done }}
              accessibilityLabel={`${d.name}, ${formatCurrency(Number(d.price) || 0, c.currency)} ${billingLabel(d.billing)}`}
            >
              <Icon
                name={done ? "checkmark-done-circle" : on ? "checkbox" : "square-outline"}
                className="text-2xl text-primary"
              />
              <View className="flex-1">
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="card-title flex-shrink" numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text className="metric-value">{formatCurrency(Number(d.price) || 0, c.currency)}</Text>
                </View>
                <Text className="card-caption mt-0">
                  {billingLabel(d.billing)} · next {d.renewal}
                  {c.plan ? ` · ${c.plan}` : ""}
                </Text>
                <View className="badge-row mt-1">
                  <View className={c.confidence === "low" ? "badge-warn" : "badge"}>
                    <Text className={c.confidence === "low" ? "badge-warn-text" : "badge-text"}>
                      {CONFIDENCE[c.confidence]}
                    </Text>
                  </View>
                  {done ? (
                    <View className="badge">
                      <Text className="badge-text">Added</Text>
                    </View>
                  ) : c.already_tracked ? (
                    <View className="badge-warn">
                      <Text className="badge-warn-text">Already tracked</Text>
                    </View>
                  ) : null}
                </View>
                <Text className="card-caption">{c.reason}</Text>
              </View>
            </Pressable>
            {!done ? (
              <Pressable
                className="mt-2 min-h-11 justify-center self-start"
                onPress={() => setEditing((e) => (e === c.id ? null : c.id))}
                accessibilityRole="button"
                accessibilityState={{ expanded: editing === c.id }}
              >
                <Text className="link-text">{editing === c.id ? "Done editing" : "Edit"}</Text>
              </Pressable>
            ) : null}
            {editing === c.id ? (
              <View className="mt-1">
                <Text className="input-label">Name</Text>
                <TextInput
                  className="input mb-3"
                  value={d.name}
                  onChangeText={(name) => setDraft(c.id, { name })}
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel="Name"
                />
                <Text className="input-label">Price ({c.currency})</Text>
                <TextInput
                  className="input mb-3"
                  value={d.price}
                  onChangeText={(price) => setDraft(c.id, { price })}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Price"
                />
                <Text className="input-label">Billed</Text>
                <SegmentedControl<BillingCycle>
                  label="Billed"
                  value={d.billing}
                  onChange={(billing) => setDraft(c.id, { billing })}
                  options={BILLING_CYCLES.map((b) => ({ value: b.value, label: b.label }))}
                />
                <Text className="input-label mt-3">Next charge</Text>
                <TextInput
                  className="input"
                  value={d.renewal}
                  onChangeText={(renewal) => setDraft(c.id, { renewal })}
                  keyboardType="number-pad"
                  placeholder={DATE_FORMAT}
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel="Next charge date"
                />
                {c.charges.length ? (
                  <View className="mt-3">
                    <Text className="stat-label">Charges we saw</Text>
                    {c.charges.map((ch) => (
                      <Text key={`${ch.date}-${ch.amount}-${ch.merchant}`} className="card-caption mt-0">
                        {dayjs(ch.date).format("MMM D, YYYY")} · {ch.merchant} · {formatCurrency(ch.amount, c.currency)}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}

      <View className="mt-4">
        <FormError message={error} />
      </View>
      {open.length ? (
        <Pressable
          className="btn mt-2"
          style={busy || !count ? { opacity: 0.6 } : undefined}
          disabled={busy || !count}
          onPress={add}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy || !count }}
        >
          <Text className="btn-text">
            {busy ? "Adding…" : count ? `Add ${count} subscription${count === 1 ? "" : "s"}` : "Select subscriptions to add"}
          </Text>
        </Pressable>
      ) : null}
      <Pressable className="mt-3 min-h-12 items-center justify-center" onPress={discard} disabled={busy} accessibilityRole="button">
        <Text className="btn-danger-text">Delete this import</Text>
      </Pressable>
    </View>
  );
}
