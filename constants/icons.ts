import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

export type IconName = ComponentProps<typeof Ionicons>["name"];

// Central icon registry: import icons from here instead of naming them inline.
export const icons = {
  home: "home",
  wallet: "wallet",
  activity: "pulse",
  setting: "settings",
  add: "add-circle",
  music: "musical-notes",
  film: "film",
  cloud: "cloud",
  code: "code-slash",
  fitness: "barbell",
  news: "newspaper",
  ai: "sparkles",
} as const satisfies Record<string, IconName>;
