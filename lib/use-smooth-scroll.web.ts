import Lenis from "lenis";
import { useEffect, type RefObject } from "react";
import type { ScrollView } from "react-native";

/**
 * Lenis inertial scrolling on a ScrollView's scroll container, for fine pointers
 * only (touch keeps native momentum) and never under reduced motion.
 */
export function useSmoothScroll(ref: RefObject<ScrollView | null>) {
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    const node = (ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
    if (!node) return;
    const lenis = new Lenis({ wrapper: node, content: node.firstElementChild as HTMLElement, lerp: 0.1, smoothWheel: true });
    let raf = 0;
    const tick = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, [ref]);
}
