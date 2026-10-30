import type { RefObject } from "react";
import type { ScrollView } from "react-native";

/** Inertial scrolling for desktop browsers; native scrolling is already smooth, so this does nothing there. */
export function useSmoothScroll(_ref: RefObject<ScrollView | null>) {}
