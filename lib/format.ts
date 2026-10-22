/**
 * Number formatting for financial figures. Every formatter takes null and
 * returns an em dash for it, so a missing value can never render as 0.
 */

const DASH = "—";
const MINUS = "−"; // U+2212, aligns with digits better than a hyphen

const signed = (n: number, text: string) => (n > 0 ? `+${text}` : n < 0 ? `${MINUS}${text}` : text);

/** 0.1234 -> "12.3%"; signed: "+12.3%". */
export function formatPct(v: number | null | undefined, opts: { signed?: boolean; digits?: number } = {}) {
  if (v == null || !Number.isFinite(v)) return DASH;
  const text = `${Math.abs(v * 100).toFixed(opts.digits ?? 1)}%`;
  return opts.signed ? signed(v, text) : v < 0 ? `${MINUS}${text}` : text;
}

/** A difference of two percentages, 0.04 -> "+4.0 pp". */
export function formatPp(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return DASH;
  return signed(v, `${Math.abs(v * 100).toFixed(1)} pp`);
}

/** 12.345 -> "12.3x". */
export function formatMultiple(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return DASH;
  return `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(1)}x`;
}

/** Compact money: 2_643_512_524 -> "$2.6B", -643e6 -> "−$643M". */
export function formatMoneyCompact(v: number | null | undefined, currency = "USD") {
  if (v == null || !Number.isFinite(v)) return DASH;
  if (Math.abs(v) < 0.5) v = 0;
  const abs = Math.abs(v);
  const [div, suffix] =
    abs >= 1e12 ? [1e12, "T"] : abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const digits = div === 1 || abs / div >= 100 ? 0 : 1;
  return `${v < 0 ? MINUS : ""}${symbol}${(abs / div).toFixed(digits)}${suffix}`;
}

/** Full money: 1234.5 -> "$1,234.50". */
export function formatMoney(v: number | null | undefined, currency = "USD") {
  if (v == null || !Number.isFinite(v)) return DASH;
  if (Math.abs(v) < 0.005) v = 0; // float dust would otherwise print as "−$0.00"
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

const SIGNED_KEYS = /cagr|growth|change|spread|advantage|excess/;

/** A Metric from the API in its own unit. */
export function formatMetric(m: Pick<Metric, "value" | "unit">, opts: { key?: string; currency?: string } = {}) {
  const { value, unit } = m;
  switch (unit) {
    case "pct":
      return formatPct(value, { signed: SIGNED_KEYS.test(opts.key ?? "") });
    case "pp":
      return formatPp(value);
    case "ratio":
      return formatPct(value);
    case "x":
      return formatMultiple(value);
    case "usd":
      return formatMoneyCompact(value, opts.currency);
    case "years":
      return value == null ? DASH : `${value} ${value === 1 ? "yr" : "yrs"}`;
    default:
      return value == null ? DASH : String(Math.round(value));
  }
}

const STATUS_LABEL: Record<MetricStatus, string> = {
  ok: "",
  not_meaningful: "Not meaningful",
  not_applicable: "Not applicable",
  insufficient_data: "Not available",
};

export const statusLabel = (s: MetricStatus) => STATUS_LABEL[s];

/**
 * Whether a value reads as favorable (+1), unfavorable (-1) or neither (0),
 * for growth-like units only: a payout ratio of 50% isn't "good" or "bad" by sign.
 */
export function signal(m: Pick<Metric, "value" | "unit">, higherIsBetter: boolean | null | undefined) {
  if (m.value == null || higherIsBetter == null || m.value === 0) return 0;
  if (m.unit !== "pct" && m.unit !== "pp" && m.unit !== "usd") return 0;
  return (m.value > 0 ? 1 : -1) * (higherIsBetter ? 1 : -1);
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return DASH;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
