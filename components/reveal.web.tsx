import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/** Fades and lifts its content in once it scrolls into view. Shown immediately under reduced motion. */
export function Reveal({ children, delay = 0, className, style }: { children: ReactNode; delay?: number; className?: string; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const ref = useRef<View>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current as unknown as Element | null;
    if (!node || typeof IntersectionObserver === "undefined") return setShown(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const on = shown || reduced;
  const motion = {
    opacity: on ? 1 : 0,
    transform: [{ translateY: on ? 0 : 28 }],
    transitionProperty: "opacity, transform",
    transitionDuration: reduced ? "0ms" : "700ms",
    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    transitionDelay: `${delay}ms`,
  };
  return (
    <View ref={ref} className={className} style={[style, motion as ViewStyle]}>
      {children}
    </View>
  );
}
