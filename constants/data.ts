import dayjs from "dayjs";

import { icons } from "@/constants/icons";

export const tabs = [
  { name: "index", title: "Home", icon: icons.home },
  { name: "subscriptions", title: "Subscriptions", icon: icons.wallet },
  { name: "insights", title: "Insights", icon: icons.activity },
  { name: "settings", title: "Settings", icon: icons.setting },
] as const satisfies readonly AppTab[];

// ── Placeholder home screen data (replaced by real data later) ──────────────

export const homeUser: HomeUser = {
  name: "Alex Morgan",
};

// Sample renewal dates are relative to today so the demo never goes stale.
const inDays = (days: number) => dayjs().add(days, "day").format("YYYY-MM-DD");

export const homeSubscriptions: Subscription[] = [
  {
    id: "spotify",
    icon: icons.music,
    name: "Spotify",
    plan: "Premium Family",
    category: "Music",
    paymentMethod: "Visa •••• 4242",
    status: "active",
    price: 16.99,
    billing: "monthly",
    renewalDate: inDays(3),
    startDate: inDays(-420),
    color: "#c8f0d4",
  },
  {
    id: "netflix",
    icon: icons.film,
    name: "Netflix",
    plan: "Standard",
    category: "Entertainment",
    paymentMethod: "Visa •••• 4242",
    status: "active",
    price: 15.49,
    billing: "monthly",
    renewalDate: inDays(6),
    startDate: inDays(-900),
    color: "#ffd6d6",
  },
  {
    id: "icloud",
    icon: icons.cloud,
    name: "iCloud+",
    plan: "200 GB",
    category: "Storage",
    paymentMethod: "Apple Pay",
    status: "active",
    price: 2.99,
    billing: "monthly",
    renewalDate: inDays(9),
    startDate: inDays(-1500),
    color: "#d6e8ff",
  },
  {
    id: "claude",
    icon: icons.ai,
    name: "Claude",
    plan: "Pro",
    category: "Productivity",
    paymentMethod: "Mastercard •••• 8801",
    status: "active",
    price: 20,
    billing: "monthly",
    renewalDate: inDays(15),
    startDate: inDays(-200),
    color: "#f5dcc8",
  },
  {
    id: "github",
    icon: icons.code,
    name: "GitHub",
    plan: "Pro",
    category: "Developer tools",
    paymentMethod: "Mastercard •••• 8801",
    status: "active",
    price: 48,
    billing: "yearly",
    renewalDate: inDays(120),
    startDate: inDays(-610),
    color: "#e2dcf5",
  },
  {
    id: "gym",
    icon: icons.fitness,
    name: "Gym membership",
    category: "Health",
    paymentMethod: "Debit •••• 1190",
    status: "paused",
    price: 39.99,
    billing: "monthly",
    renewalDate: inDays(26),
    startDate: inDays(-75),
    color: "#fdf0c4",
  },
];

// Active subscriptions renewing in the next 30 days, soonest first.
export const upcomingSubscriptions: UpcomingSubscription[] = homeSubscriptions
  .filter((s) => s.status === "active")
  .map((s) => ({
    id: s.id,
    icon: s.icon,
    name: s.name,
    price: s.price,
    currency: s.currency,
    daysLeft: dayjs(s.renewalDate).startOf("day").diff(dayjs().startOf("day"), "day"),
  }))
  .filter((s) => s.daysLeft >= 0 && s.daysLeft <= 30)
  .sort((a, b) => a.daysLeft - b.daysLeft);

// Monthly-equivalent total of active subscriptions.
export const homeBalance: HomeBalance = {
  amount: homeSubscriptions
    .filter((s) => s.status === "active")
    .reduce((sum, s) => sum + (s.billing === "yearly" ? s.price / 12 : s.price), 0),
  nextRenewalDate:
    homeSubscriptions
      .filter((s) => s.status === "active")
      .map((s) => s.renewalDate)
      .sort()[0] ?? "",
};
