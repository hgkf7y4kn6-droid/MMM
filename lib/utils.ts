import dayjs from "dayjs";

/**
 * Format a number as money, e.g. 1234.5 -> "$1,234.50".
 * Falls back to "1234.50 XYZ" (amount + the given code) if the currency code
 * is invalid.
 */
export function formatCurrency(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** "active" -> "Active"; falls back to "Unknown" for empty values. */
export function formatStatusLabel(status?: string): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

/** ISO date -> "Oct 9, 2026"; "Not provided" if missing or invalid. */
export function formatSubscriptionDateTime(value?: string): string {
  if (!value) return "Not provided";
  const date = dayjs(value);
  return date.isValid() ? date.format("MMM D, YYYY") : "Not provided";
}
