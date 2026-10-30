import { Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";

import { useThemeColors } from "@/lib/theme";

/** The KaventaFi mark: rising bars on a teal tile, the tallest in gold. */
export function LogoMark({ size = 40 }: { size?: number }) {
  const colors = useThemeColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="KaventaFi">
      <Rect width={100} height={100} rx={24} fill={colors.tile} />
      <Rect x={20} y={54} width={16} height={22} rx={4} fill="#ffffff" fillOpacity={0.55} />
      <Rect x={42} y={38} width={16} height={38} rx={4} fill="#ffffff" fillOpacity={0.85} />
      <Rect x={64} y={20} width={16} height={56} rx={4} fill={colors.gold} />
    </Svg>
  );
}

/** Mark plus the serif wordmark, "Fi" in the brand teal. */
export function Logo({ size = 36, light }: { size?: number; light?: boolean }) {
  return (
    <View className="flex-row items-center gap-2.5" accessibilityRole="image" accessibilityLabel="KaventaFi">
      <LogoMark size={size} />
      <Text
        className={light ? "font-display-bold text-white" : "font-display-bold text-foreground"}
        style={{ fontSize: size * 0.62 }}
      >
        Kaventa<Text className={light ? "text-gold" : "text-primary"}>Fi</Text>
      </Text>
    </View>
  );
}
