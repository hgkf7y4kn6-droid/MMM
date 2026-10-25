import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { router } from "expo-router";

import { api, apiConfigured, ApiError } from "@/lib/api";
import { useUserId } from "@/lib/session";

type Ctx = {
  subscriptions: Subscription[];
  summary: SubscriptionsSummary | null;
  /** True until the first load for this user finishes. */
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
  /** Each returns the saved subscription (or throws ApiError with a readable message). */
  create: (input: SubscriptionInput) => Promise<Subscription>;
  update: (id: string, input: SubscriptionInput) => Promise<Subscription>;
  remove: (id: string) => Promise<void>;
};

/** Open the add / edit form. */
export const addSubscription = () => router.push({ pathname: "/subscriptions/[id]", params: { id: "new" } });
export const editSubscription = (id: string) => router.push({ pathname: "/subscriptions/[id]", params: { id } });

const SubscriptionsContext = createContext<Ctx | null>(null);

/**
 * The signed-in user's tracked subscriptions, stored by the API so they follow
 * the account to every device. Loaded once per sign-in and reloaded after each
 * change (the server rolls renewal dates forward and computes the totals).
 */
export function SubscriptionsProvider({ children }: { children: ReactNode }) {
  const userId = useUserId();
  const [data, setData] = useState<SubscriptionsResponse | null>(null);
  const [loading, setLoading] = useState(!!userId && apiConfigured());
  const [error, setError] = useState<ApiError | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    if (!userId) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      const next = await api.subscriptions();
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (ticket !== latest.current) return;
      setError(e instanceof ApiError ? e : new ApiError("Couldn't load your subscriptions.", 0));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(!!userId && apiConfigured());
    refresh();
  }, [refresh, userId]);

  const create = useCallback(
    async (input: SubscriptionInput) => {
      const saved = await api.createSubscription(input);
      await refresh();
      return saved;
    },
    [refresh],
  );
  const update = useCallback(
    async (id: string, input: SubscriptionInput) => {
      const saved = await api.updateSubscription(id, input);
      await refresh();
      return saved;
    },
    [refresh],
  );
  const remove = useCallback(
    async (id: string) => {
      await api.deleteSubscription(id);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<Ctx>(
    () => ({
      subscriptions: data?.subscriptions ?? [],
      summary: data?.summary ?? null,
      loading,
      error,
      refresh,
      create,
      update,
      remove,
    }),
    [data, loading, error, refresh, create, update, remove],
  );
  return <SubscriptionsContext.Provider value={value}>{children}</SubscriptionsContext.Provider>;
}

export function useSubscriptions(): Ctx {
  const ctx = useContext(SubscriptionsContext);
  if (!ctx) throw new Error("useSubscriptions must be used inside SubscriptionsProvider");
  return ctx;
}
