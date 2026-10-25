import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Field, FormError } from "@/components/auth-shell";
import BackLink from "@/components/back-link";
import { Icon } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import SegmentedControl from "@/components/segmented-control";
import { BILLING_CYCLES, CATEGORIES } from "@/constants/categories";
import { ApiError } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { useSubscriptions } from "@/lib/subscriptions";
import { useThemeColors } from "@/lib/theme";

dayjs.extend(customParseFormat);

const DATE_FORMAT = "MM/DD/YYYY";
const DATE_FORMATS = ["MM/DD/YYYY", "M/D/YYYY", "MM/DD/YY", "M/D/YY", "YYYY-MM-DD"];
const parseDate = (text: string) => {
  const d = dayjs(text.trim(), DATE_FORMATS, true);
  return d.isValid() ? d : null;
};
const QUICK_DATES = [
  { label: "Today", days: 0 },
  { label: "In a week", days: 7 },
  { label: "In 2 weeks", days: 14 },
  { label: "In a month", days: 30 },
];

/** Add (id "new") or edit a tracked subscription. */
export default function SubscriptionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { subscriptions, loading } = useSubscriptions();
  const isNew = id === "new";
  const existing = useMemo(() => (isNew ? null : subscriptions.find((s) => s.id === id) ?? null), [isNew, id, subscriptions]);

  // Opened by a link before the list has loaded, or to an id this account doesn't have.
  if (!isNew && !existing) {
    return (
      <SafeAreaView className="screen" edges={["top"]}>
        <View className="screen-pad">
          <BackLink />
          <Text className="empty-text">{loading ? "Loading…" : "This subscription isn't on your account."}</Text>
        </View>
      </SafeAreaView>
    );
  }
  return <SubscriptionForm key={existing?.id ?? "new"} existing={existing} />;
}

const leave = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/");
};

function SubscriptionForm({ existing }: { existing: Subscription | null }) {
  const colors = useThemeColors();
  const { create, update, remove } = useSubscriptions();
  const isNew = !existing;

  const [form, setForm] = useState(() => ({
    name: existing?.name ?? "",
    price: existing ? String(existing.price) : "",
    billing: (existing?.billing ?? "monthly") as BillingCycle,
    renewal: existing ? dayjs(existing.renewal_date).format(DATE_FORMAT) : "",
    category: existing?.category ?? "",
    status: (existing?.status ?? "active") as SubscriptionStatus,
    plan: existing?.plan ?? "",
    payment_method: existing?.payment_method ?? "",
    start: existing?.start_date ? dayjs(existing.start_date).format(DATE_FORMAT) : "",
    currency: existing?.currency ?? "USD",
    notes: existing?.notes ?? "",
  }));
  const [moreOpen, setMoreOpen] = useState(!!(existing?.plan || existing?.payment_method || existing?.start_date || existing?.notes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (busy) return;
    setError(null);
    const name = form.name.trim();
    const price = Number(form.price.replace(/[^0-9.]/g, ""));
    const renewal = parseDate(form.renewal);
    const start = form.start.trim() ? parseDate(form.start) : null;
    if (!name) return setError("Give it a name, like Netflix or Gym.");
    if (!form.price.trim() || !Number.isFinite(price)) return setError("Enter the price, like 15.49.");
    if (!renewal) return setError(`Enter the next charge date as ${DATE_FORMAT}.`);
    if (form.start.trim() && !start) return setError(`Enter the start date as ${DATE_FORMAT}, or leave it blank.`);
    if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) return setError("Currency is a 3-letter code, like USD.");

    const input: SubscriptionInput = {
      name,
      price: Math.round(price * 100) / 100,
      currency: form.currency.trim().toUpperCase(),
      billing: form.billing,
      category: form.category || null,
      plan: form.plan.trim() || null,
      payment_method: form.payment_method.trim() || null,
      status: form.status,
      start_date: start ? start.format("YYYY-MM-DD") : null,
      renewal_date: renewal.format("YYYY-MM-DD"),
      notes: form.notes.trim() || null,
    };
    setBusy(true);
    try {
      if (existing) await update(existing.id, input);
      else await create(input);
      leave();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!existing || busy) return;
    const ok = await confirm(`Delete ${existing.name}?`, "It will be removed from your totals on every device.", "Delete");
    if (!ok) return;
    setBusy(true);
    try {
      await remove(existing.id);
      leave();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete. Try again.");
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="screen" edges={["top", "bottom"]}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerClassName="w-full max-w-[680px] self-center px-5 pb-16 pt-2" keyboardShouldPersistTaps="handled">
          <BackLink label="Cancel" />
          <Text className="screen-title" accessibilityRole="header">
            {isNew ? "Add subscription" : "Edit subscription"}
          </Text>
          <View className="mt-6">
            <FormError message={error} />
            <Field label="Name" value={form.name} onChangeText={set("name")} placeholder="Netflix" autoCapitalize="words" />

            <View className="input-field">
              <Text className="input-label">Price</Text>
              <View className="input-prefix-row">
                <Text className="mr-1 font-sans-semibold text-base text-muted-foreground">
                  {form.currency.trim().toUpperCase() === "USD" ? "$" : form.currency.trim().toUpperCase()}
                </Text>
                <TextInput
                  className="input-bare"
                  value={form.price}
                  onChangeText={set("price")}
                  keyboardType="decimal-pad"
                  placeholder="15.49"
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel="Price"
                />
              </View>
            </View>

            <Text className="input-label">Billed</Text>
            <SegmentedControl<BillingCycle>
              label="Billed"
              value={form.billing}
              onChange={set("billing")}
              options={BILLING_CYCLES.map((c) => ({ value: c.value, label: c.label }))}
            />

            <View className="mt-4">
              <Field
                label="Next charge"
                value={form.renewal}
                onChangeText={set("renewal")}
                keyboardType="number-pad"
                placeholder={DATE_FORMAT}
                hint={
                  parseDate(form.renewal)
                    ? parseDate(form.renewal)!.format("dddd, MMMM D, YYYY")
                    : "We roll this forward automatically after each charge."
                }
              />
              <View className="-mt-2 mb-4 flex-row flex-wrap gap-2">
                {QUICK_DATES.map((q) => (
                  <Pressable
                    key={q.label}
                    className="chip-sm"
                    onPress={() => set("renewal")(dayjs().add(q.days, "day").format(DATE_FORMAT))}
                    accessibilityRole="button"
                  >
                    <Text className="chip-text text-xs">{q.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Text className="input-label">Category</Text>
            <View className="chip-wrap" accessibilityRole="radiogroup" accessibilityLabel="Category">
              {CATEGORIES.map((c) => {
                const active = form.category === c.name;
                return (
                  <Pressable
                    key={c.name}
                    className="chip-sm"
                    style={active ? { backgroundColor: c.color, borderColor: c.color } : undefined}
                    onPress={() => set("category")(active ? "" : c.name)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <Icon name={c.icon} className={active ? "text-sm text-[#1a1a20]" : "text-sm text-muted-foreground"} />
                    <Text className={active ? "font-sans-semibold text-xs text-[#1a1a20]" : "chip-text text-xs"}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>

            {!isNew ? (
              <View className="mt-4">
                <Text className="input-label">Status</Text>
                <SegmentedControl<SubscriptionStatus>
                  label="Status"
                  value={form.status}
                  onChange={set("status")}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "paused", label: "Paused" },
                    { value: "cancelled", label: "Cancelled" },
                  ]}
                />
                <Text className="input-hint">Paused and cancelled subscriptions don&apos;t count toward your totals.</Text>
              </View>
            ) : null}

            <Pressable
              className="mt-6 min-h-11 flex-row items-center justify-between"
              onPress={() => setMoreOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityState={{ expanded: moreOpen }}
            >
              <Text className="form-section mb-0 mt-0">More details (optional)</Text>
              <Icon name={moreOpen ? "chevron-up" : "chevron-down"} className="text-lg text-muted-foreground" />
            </Pressable>
            {moreOpen ? (
              <View className="mt-2">
                <Field label="Plan" value={form.plan} onChangeText={set("plan")} placeholder="Premium Family" autoCapitalize="words" />
                <Field
                  label="Paid with"
                  value={form.payment_method}
                  onChangeText={set("payment_method")}
                  placeholder="Visa ending 4242"
                  hint="A label for your own reference. Never enter a full card number."
                  autoCapitalize="words"
                />
                <Field label="Started" value={form.start} onChangeText={set("start")} keyboardType="number-pad" placeholder={DATE_FORMAT} />
                <Field label="Currency" value={form.currency} onChangeText={set("currency")} placeholder="USD" hint="3-letter code, like USD, EUR or GBP." />
                <Field label="Notes" value={form.notes} onChangeText={set("notes")} placeholder="Shared with family, cancel before trial ends…" autoCapitalize="sentences" />
              </View>
            ) : null}

            <Pressable
              className="btn mt-6"
              style={busy ? { opacity: 0.6 } : undefined}
              onPress={save}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
            >
              <Text className="btn-text">{busy ? "Saving…" : isNew ? "Add subscription" : "Save changes"}</Text>
            </Pressable>
            {existing ? (
              <Pressable className="mt-3 min-h-12 items-center justify-center" onPress={del} disabled={busy} accessibilityRole="button">
                <Text className="btn-danger-text">Delete subscription</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
