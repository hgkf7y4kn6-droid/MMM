import { useEffect } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import { useThemeColors } from "@/lib/theme";

/** A gently pulsing block where content is about to appear (from DFS-Riches). */
export function Skeleton({ style }: { style?: ViewStyle }) {
  const colors = useThemeColors();
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity]);
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ backgroundColor: colors.muted, borderRadius: 8 }, style, pulse]} />;
}

/** Placeholder metric rows: a label and a value. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className="flex-row items-center justify-between py-3">
          <Skeleton style={{ height: 14, width: "55%" }} />
          <Skeleton style={{ height: 14, width: 56 }} />
        </View>
      ))}
    </View>
  );
}
