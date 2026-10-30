import type { ReactNode } from "react";
import type { ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

/** Fades and lifts its content in on mount (native; the web version waits until it scrolls into view). */
export function Reveal({ children, delay = 0, className, style }: { children: ReactNode; delay?: number; className?: string; style?: ViewStyle }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(600)} className={className} style={style}>
      {children}
    </Animated.View>
  );
}
