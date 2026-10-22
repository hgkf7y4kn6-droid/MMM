import { useColorScheme } from "react-native";

import { colors } from "@/constants/theme";

/** Raw theme colors for props that can't take a className (SVG fills, strokes). */
export function useThemeColors() {
  return colors[useColorScheme() === "dark" ? "dark" : "light"];
}
