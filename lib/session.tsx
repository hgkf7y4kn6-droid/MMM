import { useAuth } from "@clerk/expo";
import { useEffect, useRef, type ReactNode } from "react";

import { setTokenSource } from "@/lib/api";

/**
 * Hands the signed-in user's Clerk session token to every API request
 * (lib/api.ts), and takes it away on sign-out. The token source is set during
 * render, before any child provider's effects fetch data, so the first request
 * after sign-in already carries the session.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, userId, getToken } = useAuth();
  // getToken changes identity between renders; read it through a ref.
  const tokenRef = useRef(getToken);
  useEffect(() => {
    tokenRef.current = getToken;
  }, [getToken]);

  const me = isSignedIn && userId ? userId : null;
  const current = useRef<string | null | undefined>(undefined);
  if (current.current !== me) {
    current.current = me;
    setTokenSource(me ? (fresh) => tokenRef.current(fresh ? { skipCache: true } : undefined) : null);
  }
  return <>{children}</>;
}

/** The signed-in user's id (null when signed out); providers key their data on it. */
export function useUserId(): string | null {
  const { isSignedIn, userId } = useAuth();
  return isSignedIn && userId ? userId : null;
}
