import { icons } from "@/constants/icons";

export const tabs = [
  { name: "index", title: "Home", icon: icons.home },
  { name: "subscriptions", title: "Subscriptions", icon: icons.wallet },
  { name: "insights", title: "Research", icon: icons.activity },
  { name: "settings", title: "Settings", icon: icons.setting },
] as const satisfies readonly AppTab[];
