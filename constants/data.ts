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
    renewalDate: "2026-10-09",
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
    renewalDate: "2026-10-12",
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
    renewalDate: "2026-10-15",
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
    renewalDate: "2026-10-21",
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
    renewalDate: "2027-02-03",
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
    renewalDate: "2026-11-01",
  },
];

// Active subscriptions, soonest renewal first.
export const upcomingSubscriptions: Subscription[] = homeSubscriptions
  .filter((s) => s.status === "active")
  .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))
  .slice(0, 4);

// Monthly-equivalent total of active subscriptions.
export const homeBalance: HomeBalance = {
  amount: homeSubscriptions
    .filter((s) => s.status === "active")
    .reduce((sum, s) => sum + (s.billing === "yearly" ? s.price / 12 : s.price), 0),
  nextRenewalDate: upcomingSubscriptions[0]?.renewalDate ?? "",
};
