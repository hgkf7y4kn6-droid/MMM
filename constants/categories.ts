import type { IconName } from "@/constants/icons";

/**
 * Subscription categories. The category a user picks decides the card's icon
 * and pastel color, so nothing visual has to be stored per subscription.
 * Colors are fixed (same in light and dark) and paired with dark text
 * (sub-on-color in global.css).
 */
export type Category = { name: string; icon: IconName; color: string };

export const CATEGORIES: readonly Category[] = [
  { name: "Entertainment", icon: "film", color: "#ffd6d6" },
  { name: "Music", icon: "musical-notes", color: "#c8f0d4" },
  { name: "Software", icon: "sparkles", color: "#f5dcc8" },
  { name: "Cloud & storage", icon: "cloud", color: "#d6e8ff" },
  { name: "News & reading", icon: "newspaper", color: "#ece4d4" },
  { name: "Health & fitness", icon: "barbell", color: "#fdf0c4" },
  { name: "Food & delivery", icon: "fast-food", color: "#ffe2c4" },
  { name: "Gaming", icon: "game-controller", color: "#e2dcf5" },
  { name: "Education", icon: "school", color: "#d4f0ec" },
  { name: "Utilities", icon: "flash", color: "#e4ecd4" },
  { name: "Insurance", icon: "shield-checkmark", color: "#dde4ee" },
  { name: "Other", icon: "ellipsis-horizontal-circle", color: "#e8e6e0" },
];

const BY_NAME = new Map(CATEGORIES.map((c) => [c.name.toLowerCase(), c]));
const OTHER = CATEGORIES[CATEGORIES.length - 1];

/** The category's look; unknown or empty categories use "Other". */
export const categoryFor = (name: string | null | undefined): Category =>
  (name && BY_NAME.get(name.trim().toLowerCase())) || OTHER;

export const BILLING_CYCLES: readonly { value: BillingCycle; label: string; per: string }[] = [
  { value: "weekly", label: "Weekly", per: "wk" },
  { value: "monthly", label: "Monthly", per: "mo" },
  { value: "quarterly", label: "Quarterly", per: "qtr" },
  { value: "yearly", label: "Yearly", per: "yr" },
];

export const billingLabel = (b: BillingCycle) => BILLING_CYCLES.find((c) => c.value === b)?.label ?? "Monthly";
