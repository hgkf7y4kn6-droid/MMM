import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, apiConfigured } from "@/lib/api";
import { useUserId } from "@/lib/session";

type Ctx = {
  me: MeResponse | null;
  loading: boolean;
  /** True when the account can't use this Pro feature (the server enforces it either way). */
  locked: (feature: ProFeature) => boolean;
  refresh: () => Promise<void>;
};

const EntitlementsContext = createContext<Ctx>({
  me: null,
  loading: false,
  locked: () => true,
  refresh: async () => {},
});

/**
 * The signed-in account's plan, from GET /api/me. This only decides what the
 * UI offers; every Pro endpoint re-checks on the server, so a modified client
 * gets a 402, not the data. Reloaded whenever a different user signs in, and
 * cleared on sign-out so one account's plan never shows for another.
 */
export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const userId = useUserId();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(apiConfigured() && !!userId);
  // A response for a previous user (they signed out mid-request) is dropped.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    if (!apiConfigured() || !userId) {
      setMe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await api.me();
      if (ticket === latest.current) setMe(next);
    } catch {
      if (ticket === latest.current) setMe(null);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setMe(null);
    refresh();
  }, [refresh]);

  const value = useMemo<Ctx>(
    () => ({
      me,
      loading,
      locked: (feature) => !(me?.entitlement.features[feature] ?? false),
      refresh,
    }),
    [me, loading, refresh],
  );
  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

export const useEntitlements = () => useContext(EntitlementsContext);
