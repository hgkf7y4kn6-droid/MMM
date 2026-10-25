import Ionicons from "@expo/vector-icons/Ionicons";
import { styled } from "nativewind";
import { createElement, type ComponentProps } from "react";

// Ionicons with className support (color via text-* color classes).
const StyledIonicons = styled(Ionicons);

// Tailwind's text sizes in px. Ionicons writes its `size` as an inline font
// size, which beats a CSS class on the web, so a text-* size in className is
// also passed as `size` -- otherwise every icon renders at the 12px default.
const TEXT_SIZES: Record<string, number> = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48,
};

// Icon utilities in global.css that set a text size (keep in sync).
const UTILITY_SIZES: Record<string, number> = {
  "tabs-glyph": 24, "icon-btn-glyph": 24, "empty-card-icon": 36, "auth-feature-icon": 20,
  "sub-icon": 30, "upcoming-icon": 30, "home-add-icon": 36,
};

function sizeFromClass(className?: string): number | undefined {
  if (!className) return undefined;
  for (const token of className.split(/\s+/)) {
    if (UTILITY_SIZES[token]) return UTILITY_SIZES[token];
    const m = /^text-(xs|sm|base|lg|xl|[2-5]xl)$/.exec(token);
    if (m) return TEXT_SIZES[m[1]];
  }
  return undefined;
}

type IconProps = ComponentProps<typeof StyledIonicons> & { className?: string };

export function Icon({ className, size, ...rest }: IconProps) {
  return createElement(StyledIonicons, { className, size: size ?? sizeFromClass(className), ...rest });
}
