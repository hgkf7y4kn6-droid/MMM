/**
 * Format a number as money, e.g. 1234.5 -> "$1,234.50".
 * Falls back to a plain "$" + two decimals if the currency code is invalid.
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
    return `$${value.toFixed(2)}`;
  }
}
