import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { formatDate } from "@/lib/format";

const PLAID_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
const OAUTH_TOKEN_KEY = "kaventafi.plaid.link_token";
const OAUTH_MODE_KEY = "kaventafi.plaid.link_mode";

/** new: link an institution (replaces any current link). update: repair the current link in place. */
type LinkMode = "new" | "update";

type PlaidHandler = { open: () => void; destroy: () => void };
type PlaidGlobal = {
  create: (config: {
    token: string;
    receivedRedirectUri?: string;
    onSuccess: (publicToken: string) => void;
    onExit: (error: { display_message?: string | null; error_message?: string } | null) => void;
  }) => PlaidHandler;
};
declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

function loadPlaid(): Promise<PlaidGlobal> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PLAID_SCRIPT;
    script.async = true;
    script.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error("Plaid didn't load.")));
    script.onerror = () => reject(new Error("Couldn't load the bank connection window. Check your connection."));
    document.head.appendChild(script);
  });
}

/** sessionStorage can be unavailable (private mode); linking then just can't resume after an OAuth redirect. */
const stash = {
  get: (): { token: string; mode: LinkMode } | null => {
    try {
      const token = window.sessionStorage.getItem(OAUTH_TOKEN_KEY);
      const mode = window.sessionStorage.getItem(OAUTH_MODE_KEY) === "update" ? "update" : "new";
      return token ? { token, mode } : null;
    } catch {
      return null;
    }
  },
  set: (token: string, mode: LinkMode) => {
    try {
      window.sessionStorage.setItem(OAUTH_TOKEN_KEY, token);
      window.sessionStorage.setItem(OAUTH_MODE_KEY, mode);
    } catch {}
  },
  clear: () => {
    try {
      window.sessionStorage.removeItem(OAUTH_TOKEN_KEY);
      window.sessionStorage.removeItem(OAUTH_MODE_KEY);
    } catch {}
  },
};

/**
 * Connect (or reconnect) a brokerage account through Plaid Link, and show whether the
 * data is current. Link runs in the browser; the iOS and Android apps point to the
 * web app for now (Plaid's native SDK needs a development build). The bank
 * credentials go to Plaid, never to this app: the server only receives a one-time public
 * token and exchanges it.
 */
export default function LinkAccount({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<PlaidStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const web = Platform.OS === "web";

  const refresh = useCallback(() => {
    api.plaidStatus().then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(refresh, [refresh]);

  const open = useCallback(
    async (mode: LinkMode, resumeToken?: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const Plaid = await loadPlaid();
        const token = resumeToken ?? (await api.plaidLinkToken(mode)).link_token;
        stash.set(token, mode);
        const handler = Plaid.create({
          token,
          receivedRedirectUri: resumeToken ? window.location.href : undefined,
          onSuccess: async (publicToken) => {
            try {
              // Update mode repairs the existing link: there is no new token to exchange,
              // and the imported history is kept.
              if (mode === "update") await api.plaidReconnected();
              else await api.plaidExchange(publicToken);
              stash.clear();
              setMessage(
                mode === "update"
                  ? "Reconnected. Your history is intact; new activity appears within a minute."
                  : "Connected. Your investment history is being imported; it can take a minute.",
              );
              refresh();
              onChanged();
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "Couldn't finish connecting. Try again.");
            } finally {
              setBusy(false);
            }
          },
          onExit: (error) => {
            stash.clear();
            if (error) setMessage(error.display_message || error.error_message || "The connection was cancelled.");
            setBusy(false);
            handler.destroy();
          },
        });
        handler.open();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Couldn't start the connection.");
        setBusy(false);
      }
    },
    [onChanged, refresh],
  );

  // Back from a bank's own sign-in page (OAuth): resume the same Link session.
  useEffect(() => {
    if (!web || !window.location.search.includes("oauth_state_id")) return;
    const saved = stash.get();
    if (saved) open(saved.mode, saved.token);
  }, [web, open]);

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.plaidSync();
      setMessage("Refreshing. New data usually appears within a minute.");
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't start a refresh.");
    } finally {
      setBusy(false);
    }
  };

  // Connecting a different institution replaces the current link and its imported history
  // (two institutions' histories are never mixed into one portfolio), so ask first.
  const connectDifferent = async () => {
    const ok = await confirm(
      "Replace your connected account?",
      "Connecting a different brokerage disconnects the current one and removes the history imported from it.",
      "Replace",
    );
    if (ok) open("new");
  };

  if (status && !status.configured) return null; // the server has no Plaid credentials: nothing to offer

  const repairable = status?.linked && status.status !== "revoked";
  const prompt = repairable
    ? status?.needs_reconnect
      ? "Reconnect"
      : status?.expiring_soon
        ? "Renew connection"
        : status?.new_accounts_available
          ? "Add new accounts"
          : null
    : null;

  const stale = status?.linked && status.last_synced_at ? `Last updated ${formatDate(status.last_synced_at)}.` : null;
  return (
    <View className="card section-gap">
      <Text className="card-title" accessibilityRole="header">
        Brokerage account
      </Text>
      {status?.needs_reconnect ? (
        <Text className="error-text" accessibilityLiveRegion="polite">
          {status.status === "revoked"
            ? "Access to this account was removed. Reconnect to keep your portfolio up to date."
            : "Your bank needs you to sign in again before we can update this account."}
        </Text>
      ) : status?.linked ? (
        <Text className="card-caption">
          Connected. {stale ?? "Waiting for the first import."}
          {status.expiring_soon ? " Your connection expires soon; renew it to avoid a gap." : ""}
          {status.new_accounts_available && !status.expiring_soon
            ? " You have new accounts at this brokerage that you can add."
            : ""}
        </Text>
      ) : (
        <Text className="card-caption">
          Connect a brokerage account to analyze your real holdings, dividends and performance against the S&P 500. We
          import up to 24 months of history; positions opened earlier are noted as not included.
        </Text>
      )}
      {message ? (
        <Text className="card-caption" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {web ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          {prompt ? (
            <Pressable
              className="btn-outline"
              onPress={() => open("update")}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
            >
              <Text className="btn-outline-text">{prompt}</Text>
            </Pressable>
          ) : null}
          <Pressable
            className="btn-outline"
            onPress={status?.linked && status.status !== "revoked" ? connectDifferent : () => open("new")}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
          >
            <Text className="btn-outline-text">
              {status?.status === "revoked" ? "Connect again" : status?.linked ? "Connect a different account" : "Connect account"}
            </Text>
          </Pressable>
          {status?.linked && !status.needs_reconnect ? (
            <Pressable className="btn-outline" onPress={sync} disabled={busy} accessibilityRole="button">
              <Text className="btn-outline-text">Refresh now</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Text className="card-caption">
          Connecting an account is available in the web app at mmm.richesdigitalventures.com for now. Once connected,
          your portfolio shows here too.
        </Text>
      )}
    </View>
  );
}
