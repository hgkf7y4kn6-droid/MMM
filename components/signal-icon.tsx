import { clsx } from "clsx";

import { Icon } from "@/components/icon";
import { icons } from "@/constants/icons";

/**
 * Favorable (check) or unfavorable (alert) marker beside a figure. The value's
 * own sign shows direction; this shows whether that direction is good, so
 * the meaning never rests on color alone.
 */
export default function SignalIcon({ signal }: { signal: number }) {
  if (!signal) return null;
  return (
    <Icon
      name={signal > 0 ? icons.favorable : icons.unfavorable}
      className={clsx("text-base", signal > 0 ? "text-success" : "text-destructive")}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
