import { useId } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { useThemeColors } from "@/lib/theme";

const LEAF = "M16 90 C28 56 58 32 95 18 C90 54 58 82 16 90 Z";

/**
 * The KaventaFi mark: a K made of a leaf and two blades, with a gold sun.
 * Gradient ids are per instance so several marks can share a page.
 */
export function LogoMark({ size = 40 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const g = (name: string) => `${name}${id}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="KaventaFi">
      <Defs>
        <LinearGradient id={g("blade")} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#2FA6B0" />
          <Stop offset="1" stopColor="#2F5F7A" />
        </LinearGradient>
        <LinearGradient id={g("leaf")} x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor="#2FA564" />
          <Stop offset="0.6" stopColor="#4DBE5A" />
          <Stop offset="1" stopColor="#A5E34E" />
        </LinearGradient>
        <LinearGradient id={g("leg")} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#2F5F7A" />
          <Stop offset="1" stopColor="#2BD4C4" />
        </LinearGradient>
        <RadialGradient id={g("sun")} cx="0.35" cy="0.3" r="0.8">
          <Stop offset="0" stopColor="#F8DC73" />
          <Stop offset="1" stopColor="#D79A1E" />
        </RadialGradient>
        <Mask id={g("gap")}>
          <Rect width={100} height={100} fill="#ffffff" />
          <Path d={LEAF} fill="#000000" stroke="#000000" strokeWidth={5} strokeLinejoin="round" />
        </Mask>
      </Defs>
      <G mask={`url(#${g("gap")})`}>
        <Path d="M30 8 C16 18 10 44 10 94 C24 78 40 52 42 30 C42 20 38 12 30 8 Z" fill={`url(#${g("blade")})`} />
        <Path d="M36 66 C50 60 64 70 90 96 L46 96 C38 88 34 78 36 66 Z" fill={`url(#${g("leg")})`} />
      </G>
      <Path d={LEAF} fill={`url(#${g("leaf")})`} />
      <Circle cx={72} cy={12} r={11} fill={`url(#${g("sun")})`} />
    </Svg>
  );
}

/** Mark plus the wordmark: dark teal, "Fi" in growth green. `light` is for dark backgrounds. */
export function Logo({ size = 36, light }: { size?: number; light?: boolean }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center gap-2" accessibilityRole="image" accessibilityLabel="KaventaFi">
      <LogoMark size={size} />
      <Text
        className="font-sans-extrabold tracking-tight"
        style={{ fontSize: size * 0.7, color: light ? "#ffffff" : colors.wordmark }}
      >
        Kaventa<Text style={{ color: colors.growth }}>Fi</Text>
      </Text>
    </View>
  );
}
