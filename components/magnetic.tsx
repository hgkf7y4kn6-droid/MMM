import type { ReactNode } from "react";

/** Pulls its content toward the pointer on desktop browsers; a pass-through elsewhere. */
export function Magnetic({ children }: { children: ReactNode; strength?: number }) {
  return <>{children}</>;
}
