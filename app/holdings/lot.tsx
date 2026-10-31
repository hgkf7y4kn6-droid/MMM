import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { Field, FormError } from "@/components/auth-shell";
import BackLink from "@/components/back-link";
import { SafeAreaView } from "@/components/safe-area-view";
import SegmentedControl from "@/components/segmented-control";
import StatusView from "@/components/status-view";
import { api, ApiError } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { DATE_FORMAT, parseUserDate, toFormDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const leave = () => (router.canGoBack() ? router.back() : router.replace("/holdings"));
const num = (s: string) => Number(s.replace(/[^0-9.]/g, ""));

/** Add (id "new") or edit a lot of shares. */
export default function LotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === "new";
  const data = useApi(isNew ? null : "holdings", () => api.holdings());
  const existing = isNew ? null : (data.data?.lots.find((l) => l.id === id) ?? null);
  if (!isNew && !existing) {
    return (
      <SafeAreaView className="screen" edges={["top"]}>
        <View className="screen-pad">
          <BackLink />
          <StatusView loading={data.loading} error={data.error} onRetry={data.reload} />
          {!data.loading && !data.error ? <Text className="empty-text">This lot isn&apos;t on your account.</Text> : null}
        </View>
      </SafeAreaView>
    );
  }
  return <LotForm key={existing?.id ?? "new"} existing={existing} />;
}

function LotForm({ existing }: { existing: HoldingLot | null }) {
  const [form, setForm] = useState(() => ({
    symbol: existing?.symbol ?? "",
    shares: existing ? String(existing.shares) : "",
    // Editing shows the stored total, so re-saving never rounds it through a per-share price.
    costMode: (existing?.cost_basis != null ? "total" : "per_share") as "per_share" | "total",
    cost: existing?.cost_basis != null ? existing.cost_basis.toFixed(2) : "",
    acquired: toFormDate(existing?.acquired_on),
    account: existing?.account_label ?? "",
    notes: existing?.notes ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const sharesN = num(form.shares);
  const costN = form.cost.trim() ? num(form.cost) : null;
  const total = costN == null || !sharesN ? null : form.costMode === "total" ? costN : costN * sharesN;

  const save = async () => {
    if (busy) return;
    setError(null);
    const symbol = form.symbol.trim().toUpperCase();
    const acquired = form.acquired.trim() ? parseUserDate(form.acquired) : null;
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(symbol)) return setError("Enter a ticker symbol, like VTI or BRK.B.");
    if (!form.shares.trim() || !Number.isFinite(sharesN) || sharesN <= 0) return setError("Enter how many shares.");
    if (form.cost.trim() && (costN == null || !Number.isFinite(costN))) return setError("Enter the cost as a number, or leave it blank.");
    if (form.acquired.trim() && !acquired) return setError(`Enter the purchase date as ${DATE_FORMAT}, or leave it blank.`);
    if (acquired && acquired.isAfter(new Date())) return setError("The purchase date can't be in the future.");
    const body: HoldingLotInput = {
      symbol,
      shares: sharesN,
      cost_basis: total == null ? null : Math.round(total * 100) / 100,
      acquired_on: acquired ? acquired.format("YYYY-MM-DD") : null,
      account_label: form.account.trim() || null,
      notes: form.notes.trim() || null,
    };
    setBusy(true);
    try {
      if (existing) await api.updateLot(existing.id, body);
      else await api.addLot(body);
      leave();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!existing || busy) return;
    if (!(await confirm(`Delete this ${existing.symbol} lot?`, "It will be removed from your portfolio.", "Delete"))) return;
    setBusy(true);
    try {
      await api.deleteLot(existing.id);
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
            {existing ? "Edit lot" : "Add shares"}
          </Text>
          <Text className="screen-subtitle">One purchase per lot. Bought the same stock more than once? Add each purchase.</Text>
          <View className="mt-6">
            <FormError message={error} />
            <Field label="Ticker" value={form.symbol} onChangeText={set("symbol")} placeholder="VTI" autoCapitalize="none" />
            <Field label="Shares" value={form.shares} onChangeText={set("shares")} keyboardType="decimal-pad" placeholder="10" />

            <Text className="input-label">Cost basis</Text>
            <SegmentedControl<"per_share" | "total">
              label="Cost entered as"
              value={form.costMode}
              onChange={(m) => setForm((f) => ({ ...f, costMode: m, cost: "" }))}
              options={[
                { value: "per_share", label: "Price per share" },
                { value: "total", label: "Total paid" },
              ]}
            />
            <View className="mt-3">
              <Field
                label={form.costMode === "total" ? "Total paid (incl. fees)" : "Price per share"}
                value={form.cost}
                onChangeText={set("cost")}
                keyboardType="decimal-pad"
                placeholder={form.costMode === "total" ? "2,150.00" : "215.00"}
                hint={total != null && Number.isFinite(total) ? `Cost basis ${formatMoney(total)}` : "Optional, but needed for gains."}
              />
            </View>
            <Field
              label="Purchase date"
              value={form.acquired}
              onChangeText={set("acquired")}
              keyboardType="number-pad"
              placeholder={DATE_FORMAT}
              hint="Optional. With a date, returns are measured from the day you bought."
            />
            <Field label="Account" value={form.account} onChangeText={set("account")} placeholder="Roth IRA" autoCapitalize="words" hint="Optional label for your own reference." />
            <Field label="Notes" value={form.notes} onChangeText={set("notes")} placeholder="DRIP on" autoCapitalize="sentences" />

            <Pressable
              className="btn mt-6"
              style={busy ? { opacity: 0.6 } : undefined}
              onPress={save}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
            >
              <Text className="btn-text">{busy ? "Saving…" : existing ? "Save changes" : "Add shares"}</Text>
            </Pressable>
            {existing ? (
              <Pressable className="mt-3 min-h-12 items-center justify-center" onPress={del} disabled={busy} accessibilityRole="button">
                <Text className="btn-danger-text">Delete lot</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
