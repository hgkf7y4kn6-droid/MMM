// JS mirror of the design tokens in global.css, for places that need raw
// values (navigator options, style props) instead of className.
// Keep in sync with global.css.

export const colors = {
  light: {
    background: "#f7f4ec",
    card: "#ffffff",
    surface: "#fbf9f3",
    muted: "#f0ece0",
    border: "#ddd6c4",
    foreground: "#1a1a20",
    mutedForeground: "#726c5c",
    primary: "#a8791f",
    primaryForeground: "#ffffff",
    accent: "#1668c9",
    accentForeground: "#ffffff",
    gold: "#a8791f",
    silver: "#7c7c86",
    bronze: "#9a5a30",
    success: "#0a9e6e",
    destructive: "#d6284a",
    subscription: "#7a3fd6",
    investment: "#0a9891",
    info: "#0678a0",
  },
  dark: {
    background: "#0a0a10",
    card: "#121218",
    surface: "#17171f",
    muted: "#1e1e28",
    border: "#2a2a38",
    foreground: "#f2ede0",
    mutedForeground: "#8b8574",
    primary: "#d4af37",
    primaryForeground: "#0a0a10",
    accent: "#4a9eff",
    accentForeground: "#0a0a10",
    gold: "#d4af37",
    silver: "#c4c4cc",
    bronze: "#c17a4a",
    success: "#00e8a0",
    destructive: "#ff4d6a",
    subscription: "#a06bff",
    investment: "#00d4c8",
    info: "#22d3ee",
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const components = {
  tabBar: {
    height: 72,
    horizontalInset: 20,
    radius: 36,
    iconFrame: 48,
  },
} as const;
