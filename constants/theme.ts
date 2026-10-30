// JS mirror of the design tokens in global.css, for places that need raw
// values (navigator options, style props) instead of className.
// Keep in sync with global.css.

export const colors = {
  light: {
    background: "#fbf7ec",
    card: "#ffffff",
    surface: "#fefbf3",
    muted: "#f1ecdd",
    border: "#e2dac4",
    foreground: "#0e2f38",
    mutedForeground: "#59656f",
    primary: "#3a6b7e",
    primaryForeground: "#ffffff",
    accent: "#a8861c",
    accentForeground: "#16242b",
    hero: "#0e3b45",
    wordmark: "#0e3b45",
    gold: "#d7b740",
    goldDeep: "#7f6410",
    silver: "#7c8a93",
    bronze: "#9a5a30",
    success: "#2b7746",
    growth: "#4da167",
    destructive: "#c42b47",
    subscription: "#6b4fb3",
    investment: "#2b7f86",
    info: "#2b6cb0",
    toneGreen: "#2b7746",
    toneYellow: "#7f6410",
    toneBlue: "#2b6cb0",
    tonePink: "#b02d68",
    toneOrange: "#b5540f",
  },
  dark: {
    background: "#0b1519",
    card: "#112027",
    surface: "#162830",
    muted: "#1b2f38",
    border: "#27414c",
    foreground: "#eef3f4",
    mutedForeground: "#9daeb7",
    primary: "#6aa5bc",
    primaryForeground: "#0b1519",
    accent: "#d7b740",
    accentForeground: "#0b1519",
    hero: "#0b1d23",
    wordmark: "#eef3f4",
    gold: "#d7b740",
    goldDeep: "#d7b740",
    silver: "#c4ced3",
    bronze: "#c17a4a",
    success: "#5fc083",
    growth: "#5fc083",
    destructive: "#ff6b82",
    subscription: "#b49cf0",
    investment: "#5cc8cf",
    info: "#6fa8e0",
    toneGreen: "#5fc083",
    toneYellow: "#d7b740",
    toneBlue: "#6fa8e0",
    tonePink: "#f06aa5",
    toneOrange: "#f08a3c",
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
    maxWidth: 440,
  },
} as const;

export type ThemeColors = (typeof colors)["light"] | (typeof colors)["dark"];
