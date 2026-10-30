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
  "M65 955 C70 800 110 680 210 560 C300 455 420 385 560 340 C640 315 700 275 738 228 C660 360 530 450 390 520 C290 570 210 640 150 740 C110 810 80 880 65 955 Z";
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
          <Stop offset="0" stopColor="#3CA98A" />
          <Stop offset="0.45" stopColor="#2F7F8F" />
          <Stop offset="1" stopColor="#26496A" />
        </LinearGradient>
        <LinearGradient id={n("lobe")} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2FE0C6" />
          <Stop offset="0.5" stopColor="#2C9FB0" />
          <Stop offset="1" stopColor="#2B6A8C" />
        </LinearGradient>
        <LinearGradient id={n("leafDark")} x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#4FA567" />
          <Stop offset="0.6" stopColor="#37966A" />
          <Stop offset="1" stopColor="#2E8A72" />
        </LinearGradient>
        <LinearGradient id={n("leafLight")} x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#A4E64D" />
          <Stop offset="0.55" stopColor="#7DD14E" />
          <Stop offset="1" stopColor="#4FB566" />
        </LinearGradient>
        <LinearGradient id={n("leg")} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#2D5B7C" />
          <Stop offset="0.55" stopColor="#3C8FA7" />
          <Stop offset="1" stopColor="#32EAD2" />
        </LinearGradient>
        <RadialGradient id={n("sun")} cx="0.62" cy="0.22" r="0.95">
          <Stop offset="0" stopColor="#FCE790" />
          <Stop offset="0.45" stopColor="#E8BC45" />
          <Stop offset="1" stopColor="#CF9124" />
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
      <Path d={LEG_SHADE} fill="#27506F" fillOpacity={0.7} />
      <Circle cx={532} cy={168} r={123} fill={u("sun")} />
    </Svg>
  );
}

/** Mark plus the wordmark: dark teal, "Fi" in growth green. `light` is for dark backgrounds. */
export function Logo({ size = 36, light }: { size?: number; light?: boolean }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center gap-1" accessibilityRole="image" accessibilityLabel="KaventaFi">
      <LogoMark size={size * 1.5} />
      <Text
        className="font-sans-extrabold tracking-tight"
        style={{ fontSize: size * 0.72, color: light ? "#ffffff" : colors.wordmark }}
      >
        Kaventa<Text style={{ color: colors.growth }}>Fi</Text>
      </Text>
    </View>
  );
}
