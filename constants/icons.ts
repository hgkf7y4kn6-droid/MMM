import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

export type IconName = ComponentProps<typeof Ionicons>["name"];

// Central icon registry: import icons from here instead of naming them inline.
export const icons = {
  home: "home",
  wallet: "wallet",
  activity: "pulse",
  setting: "settings",
} as const satisfies Record<string, IconName>;
