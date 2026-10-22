import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";

type State<T> = { data: T | null; error: ApiError | null; loading: boolean };

/**
 * Runs `load` when `key` changes (and on reload()), keeping the previous
 * data on screen while a refresh is in flight. `key` null skips the request
 * entirely -- used for Pro sections on Free accounts, so locked data is never
 * requested in the first place.
 */
export function useApi<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: key != null });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key == null) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadRef
      .current()
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((err: unknown) => {
        if (cancelled) return;
        const error = err instanceof ApiError ? err : new ApiError(String(err), 0);
        setState((s) => ({ data: s.data, error, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
