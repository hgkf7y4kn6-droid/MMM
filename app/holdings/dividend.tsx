import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { Field, FormError } from "@/components/auth-shell";
import BackLink from "@/components/back-link";
import { SafeAreaView } from "@/components/safe-area-view";
import StatusView from "@/components/status-view";
import { api, ApiError } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { DATE_FORMAT, parseUserDate, toFormDate } from "@/lib/dates";
import { useApi } from "@/lib/use-api";

const leave = () => (router.canGoBack() ? router.back() : router.replace("/holdings"));

/** Record (id "new") or edit a dividend payment. */
export default function DividendScreen() {
  const { id, symbol } = useLocalSearchParams<{ id: string; symbol?: string }>();
  const isNew = !id || id === "new";
  const data = useApi(isNew ? null : "holdings", () => api.holdings());
  const existing = isNew ? null : (data.data?.dividends.find((d) => d.id === id) ?? null);
  if (!isNew && !existing) {
    return (
      <SafeAreaView className="screen" edges={["top"]}>
        <View className="screen-pad">
          <BackLink />
          <StatusView loading={data.loading} error={data.error} onRetry={data.reload} />
          {!data.loading && !data.error ? <Text className="empty-text">This dividend isn&apos;t on your account.</Text> : null}
        </View>
      </SafeAreaView>
    );
  }
  return <DividendForm key={existing?.id ?? "new"} existing={existing} symbol={symbol} />;
}

function DividendForm({ existing, symbol }: { existing: DividendEntry | null; symbol?: string }) {
  const [form, setForm] = useState(() => ({
    symbol: existing?.symbol ?? symbol ?? "",
    amount: existing ? existing.amount.toFixed(2) : "",
    paid: toFormDate(existing?.paid_on),
    reinvested: existing?.reinvested ?? false,
    notes: existing?.notes ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (busy) return;
    setError(null);
    const sym = form.symbol.trim().toUpperCase();
    const amount = Number(form.amount.replace(/[^0-9.]/g, ""));
    const paid = parseUserDate(form.paid);
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(sym)) return setError("Enter the ticker that paid it, like VTI.");
    if (!form.amount.trim() || !Number.isFinite(amount) || amount <= 0) return setError("Enter the amount you received.");
    if (!paid) return setError(`Enter the payment date as ${DATE_FORMAT}.`);
    if (paid.isAfter(new Date())) return setError("The payment date can't be in the future.");
    const body: DividendInput = {
      symbol: sym,
      amount: Math.round(amount * 100) / 100,
      paid_on: paid.format("YYYY-MM-DD"),
      reinvested: form.reinvested,
      notes: form.notes.trim() || null,
    };
    setBusy(true);
    try {
      if (existing) await api.updateDividend(existing.id, body);
      else await api.addDividend(body);
      leave();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!existing || busy) return;
    if (!(await confirm("Delete this dividend?", "It will be removed from your income.", "Delete"))) return;
    setBusy(true);
    try {
      await api.deleteDividend(existing.id);
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
            {existing ? "Edit dividend" : "Record a dividend"}
          </Text>
          <View className="mt-6">
            <FormError message={error} />
            <Field label="Ticker" value={form.symbol} onChangeText={set("symbol")} placeholder="VTI" />
            <Field label="Amount received" value={form.amount} onChangeText={set("amount")} keyboardType="decimal-pad" placeholder="42.18" />
            <Field label="Paid on" value={form.paid} onChangeText={set("paid")} keyboardType="number-pad" placeholder={DATE_FORMAT} />
            <View className="settings-row">
              <View className="mr-4 flex-1">
                <Text className="settings-label">Reinvested (DRIP)</Text>
                <Text className="input-hint">If it bought more shares, also add those shares as a lot.</Text>
              </View>
              <Switch
                value={form.reinvested}
                onValueChange={set("reinvested")}
                accessibilityLabel="Reinvested"
              />
            </View>
            <View className="mt-4">
              <Field label="Notes" value={form.notes} onChangeText={set("notes")} placeholder="Special dividend" autoCapitalize="sentences" />
            </View>
            <Pressable
              className="btn mt-6"
              style={busy ? { opacity: 0.6 } : undefined}
              onPress={save}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
            >
              <Text className="btn-text">{busy ? "Saving…" : existing ? "Save changes" : "Record dividend"}</Text>
            </Pressable>
            {existing ? (
              <Pressable className="mt-3 min-h-12 items-center justify-center" onPress={del} disabled={busy} accessibilityRole="button">
                <Text className="btn-danger-text">Delete dividend</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
