import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

const PLAID_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
const OAUTH_TOKEN_KEY = "kaventafi.plaid.link_token";

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
  get: () => {
    try {
      return window.sessionStorage.getItem(OAUTH_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      window.sessionStorage.setItem(OAUTH_TOKEN_KEY, v);
    } catch {}
  },
  clear: () => {
    try {
      window.sessionStorage.removeItem(OAUTH_TOKEN_KEY);
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
    async (resumeToken?: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const Plaid = await loadPlaid();
        const token = resumeToken ?? (await api.plaidLinkToken()).link_token;
        stash.set(token);
        const handler = Plaid.create({
          token,
          receivedRedirectUri: resumeToken ? window.location.href : undefined,
          onSuccess: async (publicToken) => {
            try {
              await api.plaidExchange(publicToken);
              stash.clear();
              setMessage("Connected. Your investment history is being imported; it can take a minute.");
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
    const token = stash.get();
    if (token) open(token);
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

  if (status && !status.configured) return null; // the server has no Plaid credentials: nothing to offer

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
          {status.expiring_soon ? " Your connection expires soon; reconnect to avoid a gap." : ""}
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
          <Pressable
            className="btn-outline"
            onPress={() => open()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
          >
            <Text className="btn-outline-text">
              {status?.needs_reconnect ? "Reconnect" : status?.linked ? "Connect a different account" : "Connect account"}
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
