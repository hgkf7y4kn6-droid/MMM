import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";

/** Pulls its content toward the pointer on desktop browsers (fine pointers, motion allowed). */
export function Magnetic({ children, strength = 0.22 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<View>(null);

  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!el || !window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    el.style.transition = "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)";
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - (r.left + r.width / 2)) * strength}px, ${(e.clientY - (r.top + r.height / 2)) * strength}px)`;
    };
    const leave = () => {
      el.style.transform = "";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [strength]);

  return <View ref={ref}>{children}</View>;
}
