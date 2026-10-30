import { useId } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";

import { useThemeColors } from "@/lib/theme";

// Mark geometry, traced from the brand board (docs/brand/brand-board.jpg).
// Paths share one coordinate space; VIEWBOX centers them in a square.
export const MARK_VIEWBOX = "-45 20 960 960";
const STEM = "M285 85 C205 92 110 125 65 245 L65 682 C80 625 115 565 150 520 C200 455 250 415 285 380 Z";
const LOBE = "M285 85 C205 92 110 125 65 245 L65 570 C120 520 150 400 175 290 C195 200 235 130 285 85 Z";
const LEAF =
  "M65 955 C70 800 110 680 210 560 C300 455 420 385 560 340 C640 315 700 275 738 228 C742 345 700 445 590 510 C490 570 400 590 320 645 C240 700 190 770 150 835 C115 890 90 925 65 955 Z";
const LEAF_LIGHT =
  "M65 955 C70 800 110 680 210 560 C300 455 420 385 560 340 C640 315 700 275 738 228 C690 305 620 350 545 380 C430 425 330 480 250 570 C160 670 100 790 65 955 Z";
const LEG = "M260 718 C340 670 410 630 470 612 L805 945 C720 955 600 955 520 950 C420 935 330 830 260 718 Z";
const LEG_SHADE = "M260 718 C330 706 410 725 480 790 C560 860 650 925 805 945 C700 955 600 955 520 950 C420 935 330 830 260 718 Z";

/**
 * The KaventaFi mark: a K made of a stem, a leaf and a leg, with a gold sun.
 * Gradient ids are per instance so several marks can share a page.
 */
export function LogoMark({ size = 40 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const n = (name: string) => `${name}${id}`;
  const u = (name: string) => `url(#${n(name)})`;
  return (
    <Svg width={size} height={size} viewBox={MARK_VIEWBOX} accessibilityLabel="KaventaFi">
      <Defs>
        <LinearGradient id={n("stem")} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#6EB289" />
          <Stop offset="0.5" stopColor="#507D80" />
          <Stop offset="1" stopColor="#3F6071" />
        </LinearGradient>
        <LinearGradient id={n("lobe")} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#6EDECE" />
          <Stop offset="0.5" stopColor="#55879E" />
          <Stop offset="1" stopColor="#2A445B" />
        </LinearGradient>
        <LinearGradient id={n("leafDark")} x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7BB568" />
          <Stop offset="0.55" stopColor="#4E9A6A" />
          <Stop offset="1" stopColor="#33715C" />
        </LinearGradient>
        <LinearGradient id={n("leafLight")} x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#B9EA6E" />
          <Stop offset="0.6" stopColor="#97D866" />
          <Stop offset="1" stopColor="#6CBF6A" />
        </LinearGradient>
        <LinearGradient id={n("leg")} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#3D637A" />
          <Stop offset="0.6" stopColor="#4B8497" />
          <Stop offset="1" stopColor="#77E8E2" />
        </LinearGradient>
        <RadialGradient id={n("sun")} cx="0.62" cy="0.22" r="0.95">
          <Stop offset="0" stopColor="#F8DF82" />
          <Stop offset="0.5" stopColor="#DDB84F" />
          <Stop offset="1" stopColor="#BA954E" />
        </RadialGradient>
        <ClipPath id={n("leafClip")}>
          <Path d={LEAF} />
        </ClipPath>
      </Defs>
      <Path d={STEM} fill={u("stem")} />
      <Path d={LOBE} fill={u("lobe")} />
      <Path d={LEAF} fill={u("leafDark")} />
      <G clipPath={u("leafClip")}>
        <Path d={LEAF_LIGHT} fill={u("leafLight")} />
      </G>
      <Path d={LEG} fill={u("leg")} />
      <Path d={LEG_SHADE} fill="#27506F" fillOpacity={0.55} />
      <Circle cx={532} cy={168} r={123} fill={u("sun")} />
    </Svg>
  );
}

/**
 * Mark plus the wordmark in the rounded brand face: dark teal, "Fi" in growth green.
 * `light` is for dark backgrounds; `tagline` adds "See a brighter tomorrow" beneath.
 */
export function Logo({ size = 36, light, tagline }: { size?: number; light?: boolean; tagline?: boolean }) {
  const colors = useThemeColors();
  const font = size * 0.95;
  return (
    <View className="flex-row items-center gap-1" accessibilityRole="image" accessibilityLabel="KaventaFi">
      <LogoMark size={size * 1.45} />
      <View>
        <Text className="font-brand tracking-tight" style={{ fontSize: font, lineHeight: font * 1.1, color: light ? "#ffffff" : colors.wordmark }}>
          Kaventa<Text style={{ color: colors.growth }}>Fi</Text>
        </Text>
        {tagline ? (
          <Text
            className="font-brand-bold uppercase"
            style={{ fontSize: font * 0.3, letterSpacing: font * 0.06, color: colors.growth }}
          >
            See a brighter tomorrow
          </Text>
        ) : null}
      </View>
    </View>
  );
}
