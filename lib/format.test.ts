import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDate, formatMetric, formatMoney, formatMoneyCompact, formatMultiple, formatPct, formatPp, signal } from "./format.ts";

const DASH = "—";
const MINUS = "−";

test("missing and non-finite values render as a dash, never 0", () => {
  for (const fn of [formatPct, formatPp, formatMultiple, formatMoneyCompact, formatMoney]) {
    assert.equal(fn(null), DASH);
    assert.equal(fn(undefined), DASH);
    assert.equal(fn(Number.NaN), DASH);
    assert.equal(fn(Infinity), DASH);
  }
});

test("formatPct", () => {
  assert.equal(formatPct(0.1234), "12.3%");
  assert.equal(formatPct(-0.05), `${MINUS}5.0%`);
  assert.equal(formatPct(0.1234, { signed: true }), "+12.3%");
  assert.equal(formatPct(0, { signed: true }), "0.0%");
  assert.equal(formatPct(0.12345, { digits: 2 }), "12.35%");
});

test("formatPp and formatMultiple", () => {
  assert.equal(formatPp(0.04), "+4.0 pp");
  assert.equal(formatPp(-0.025), `${MINUS}2.5 pp`);
  assert.equal(formatMultiple(12.345), "12.3x");
  assert.equal(formatMultiple(-1.5), `${MINUS}1.5x`);
});

test("formatMoneyCompact", () => {
  assert.equal(formatMoneyCompact(2_643_512_524), "$2.6B");
  assert.equal(formatMoneyCompact(-643e6), `${MINUS}$643M`);
  assert.equal(formatMoneyCompact(1500), "$1.5K");
  assert.equal(formatMoneyCompact(0.2), "$0");
  assert.equal(formatMoneyCompact(5, "EUR"), "EUR 5");
});

test("formatMoneyCompact never prints a value that rounds up to the next unit's 1000", () => {
  assert.equal(formatMoneyCompact(999_999), "$1.0M");
  assert.equal(formatMoneyCompact(999_999_999), "$1.0B");
  assert.equal(formatMoneyCompact(-999_999), `${MINUS}$1.0M`);
});

test("formatMoney", () => {
  assert.equal(formatMoney(1234.5), "$1,234.50");
  assert.equal(formatMoney(-0.001), "$0.00");
  assert.equal(formatMoney(-12.5), "-$12.50");
});

test("formatMetric uses the metric's own unit", () => {
  assert.equal(formatMetric({ value: 0.08, unit: "pct" }, { key: "revenue_cagr" }), "+8.0%");
  assert.equal(formatMetric({ value: 0.5, unit: "ratio" }), "50.0%");
  assert.equal(formatMetric({ value: 1, unit: "years" }), "1 yr");
  assert.equal(formatMetric({ value: 5, unit: "years" }), "5 yrs");
  assert.equal(formatMetric({ value: null, unit: "years" }), DASH);
  assert.equal(formatMetric({ value: null, unit: "pct" }), DASH);
});

test("signal only colors growth-like units", () => {
  assert.equal(signal({ value: 0.1, unit: "pct" }, true), 1);
  assert.equal(signal({ value: -0.1, unit: "pct" }, true), -1);
  assert.equal(signal({ value: 0.1, unit: "pct" }, false), -1);
  assert.equal(signal({ value: 0.5, unit: "ratio" }, true), 0);
  assert.equal(signal({ value: 0, unit: "pct" }, true), 0);
  assert.equal(signal({ value: 0.1, unit: "pct" }, null), 0);
});

test("formatDate treats date-only strings as local calendar days", () => {
  assert.equal(formatDate("2024-03-05"), "Mar 5, 2024");
  assert.equal(formatDate(null), DASH);
  assert.equal(formatDate("not a date"), DASH);
});
