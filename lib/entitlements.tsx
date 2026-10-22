import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, apiConfigured } from "@/lib/api";

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
 * The account's plan, from GET /api/me. This only decides what the UI
 * offers; every Pro endpoint re-checks on the server, so a modified client
 * gets a 402, not the data.
 */
export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(apiConfigured());

  const refresh = useCallback(async () => {
    if (!apiConfigured()) return;
    setLoading(true);
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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
