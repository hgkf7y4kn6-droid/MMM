import { useState, useMemo, useRef, useEffect, useCallback, useId } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from "recharts";

// ── TOKENS — Dark / Light / System theme ─────────────────────────────────────
// Palette pulled from the MMM logo: deep near-black background with gold,
// silver, and bronze metallic accents on an ascending diagonal.
// T is intentionally a MUTABLE object (not reassigned) rather than a plain
// const swapped per-theme: hundreds of style objects throughout this file
// read T.xxx directly, and mutating T's properties in place means every one
// of those reads picks up the new theme on the next render, without having
// to thread a theme value through every component. CS below (which style
// objects are read from) is a Proxy for the same reason — see its comment.
const THEMES = {
  dark: {
    bg: "#0a0a10", s1: "#121218", s2: "#17171f", s3: "#1e1e28",
    border: "#2a2a38", text: "#f2ede0", sub: "#8b8574",
    green: "#00e8a0", red: "#ff4d6a",
    gold: "#d4af37", silver: "#c4c4cc", bronze: "#c17a4a",
    blue: "#4a9eff", purple: "#a06bff", teal: "#00d4c8", cyan: "#22d3ee",
    gradGold: "linear-gradient(135deg,#f5d685,#d4af37,#a8791f)",
    gradBlue: "linear-gradient(135deg,#4a9eff,#a06bff)",
    gradBronze: "linear-gradient(135deg,#e0a878,#c17a4a,#8b4f28)",
    gradSilver: "linear-gradient(135deg,#eaeaef,#c4c4cc,#96969e)",
  },
  light: {
    bg: "#f7f4ec", s1: "#ffffff", s2: "#fbf9f3", s3: "#f0ece0",
    border: "#ddd6c4", text: "#1a1a20", sub: "#726c5c",
    green: "#0a9e6e", red: "#d6284a",
    gold: "#a8791f", silver: "#7c7c86", bronze: "#9a5a30",
    blue: "#1668c9", purple: "#7a3fd6", teal: "#0a9891", cyan: "#0678a0",
    gradGold: "linear-gradient(135deg,#e8c874,#b8912e,#8f6c1c)",
    gradBlue: "linear-gradient(135deg,#1668c9,#7a3fd6)",
    gradBronze: "linear-gradient(135deg,#c88858,#9a5a30,#6e3d1c)",
    gradSilver: "linear-gradient(135deg,#e0e0e6,#a8a8b2,#78787f)",
  },
};

const T = { ...THEMES.dark };
let themeVersion = 0;

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
// pref is "dark" | "light" | "system" (the user's stored choice);
// returns the actually-resolved "dark" | "light" mode to render.
function resolveThemeMode(pref) {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref === "light" ? "light" : "dark";
}
function applyTheme(pref) {
  const resolved = resolveThemeMode(pref);
  Object.assign(T, THEMES[resolved]);
  themeVersion++; // bump so CS's memoized cache below knows to recompute
  return resolved;
}

// ── BACKEND API (FastAPI service: Plaid bank sync + Tiingo market data) ─────
// This app is a client-only artifact — it cannot host Plaid's secret key or run
// Playwright/Celery itself. Those live in the separate FastAPI service from
// the pasted workflow, deployed on its own (Render/Fly/EC2/etc). Point this at
// that deployment's public URL. Every call below fails soft (returns null /
// shows a status message) so the rest of the app works fine with it unset.
const API_BASE = ""; // e.g. "https://your-finance-api.onrender.com" — leave blank to disable live sync

// Multiple components can independently fetch the same endpoint on mount
// (e.g. LinkedAccountsCard and TransferCard both request /api/accounts when
// the Accounts tab renders). This cache dedupes CONCURRENT identical GETs by
// sharing the in-flight promise — it's cleared as soon as the request
// settles, so an intentional later re-fetch (e.g. the "Sync" button) always
// gets a fresh network call rather than a stale cached value.
const _inFlightGets = new Map();
async function apiGet(path) {
  if (!API_BASE) return null;
  if (_inFlightGets.has(path)) return _inFlightGets.get(path);
  const promise = (async () => {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  })();
  _inFlightGets.set(path, promise);
  try {
    return await promise;
  } finally {
    _inFlightGets.delete(path);
  }
}
async function apiPost(path, body) {
  if (!API_BASE) return null;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// ── STORAGE KEYS (personal scope — window.storage isolates per logged-in user) ─
const SK = {
  PROFILE:    "profile",
  ACCOUNTS:   "accounts",
  LIAB:       "liabilities",
  REC:        "recurring",
  TXN:        "transactions",
  DIV:        "dividends",
  GOALS:      "goals",
  INSURANCE:  "insurance",
  ONBOARDED:  "onboarded",
  IS_PRO:     "isPro",
};

// ── TAX BRACKETS 2026 ─────────────────────────────────────────────────────────
const MFJ_BRACKETS = [
  { min: 0,      max: 23200,  r: 10 }, { min: 23200,  max: 94300,   r: 12 },
  { min: 94300,  max: 201050, r: 22 }, { min: 201050, max: 383900,  r: 24 },
  { min: 383900, max: 487450, r: 32 }, { min: 487450, max: 731200,  r: 35 },
  { min: 731200, max: 9999999,r: 37 },
];
const SGL_BRACKETS = [
  { min: 0,      max: 11600,  r: 10 }, { min: 11600,  max: 47150,   r: 12 },
  { min: 47150,  max: 100525, r: 22 }, { min: 100525, max: 191950,  r: 24 },
  { min: 191950, max: 243725, r: 32 }, { min: 243725, max: 609350,  r: 35 },
  { min: 609350, max: 9999999,r: 37 },
];
function calcTax(ann, filing) {
  const bs = filing === "mfj" ? MFJ_BRACKETS : SGL_BRACKETS;
  const br = bs.find(b => ann >= b.min && ann < b.max) || bs[bs.length - 1];
  let tax = 0;
  for (let b of bs) {
    if (ann <= b.min) break;
    tax += (Math.min(ann, b.max) - b.min) * (b.r / 100);
    if (ann <= b.max) break;
  }
  return {
    rate: br.r,
    label: `${br.r}%`,
    effective: ann > 0 ? ((tax / ann) * 100).toFixed(1) : "0.0",
    est: Math.round(tax),
  };
}

// ── PAY FREQUENCY ─────────────────────────────────────────────────────────────
const PAY_FREQ = [
  { id: "weekly",      l: "Weekly",       perYear: 52 },
  { id: "biweekly",    l: "Bi-Weekly",    perYear: 26 },
  { id: "semimonthly", l: "Semi-Monthly", perYear: 24 },
  { id: "monthly",     l: "Monthly",      perYear: 12 },
];
const getFreq = id => PAY_FREQ.find(f => f.id === id) || PAY_FREQ[1];

// ── US STATES (for onboarding) ────────────────────────────────────────────────
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

// ── CATEGORIES ────────────────────────────────────────────────────────────────
const INC = [
  { id: "salary",    l: "Salary",       c: "#00e8a0", i: "💼" },
  { id: "bonus",     l: "Bonus",        c: "#34d399", i: "🎯" },
  { id: "freelance", l: "Freelance",    c: "#6ee7b7", i: "💻" },
  { id: "rental",    l: "Rental",       c: "#009688", i: "🏠" },
  { id: "dividends", l: "Dividends",    c: "#00d4c8", i: "📊" },
  { id: "other_inc", l: "Other Income", c: "#22d3ee", i: "💰" },
];
const EXP = [
  { id: "housing",       l: "Housing",       c: "#ff3d5c", i: "🏡" },
  { id: "groceries",     l: "Groceries",     c: "#ff7043", i: "🛒" },
  { id: "dining",        l: "Dining",        c: "#ffa726", i: "🍽️" },
  { id: "transport",     l: "Transport",     c: "#ffd60a", i: "🚗" },
  { id: "utilities",     l: "Utilities",     c: "#a3e635", i: "⚡" },
  { id: "insurance",     l: "Insurance",     c: "#22d3ee", i: "🛡️" },
  { id: "healthcare",    l: "Healthcare",    c: "#60a5fa", i: "🏥" },
  { id: "childcare",     l: "Childcare",     c: "#818cf8", i: "👶" },
  { id: "subscriptions", l: "Subscriptions", c: "#c084fc", i: "📱" },
  { id: "entertainment", l: "Entertainment", c: "#f472b6", i: "🎬" },
  { id: "travel",        l: "Travel",        c: "#fb923c", i: "✈️" },
  { id: "gifts",         l: "Gifts",         c: "#e879f9", i: "🎁" },
  { id: "savings_xfer",  l: "Savings Xfer",  c: "#2dd4bf", i: "💸" },
  { id: "debt",          l: "Debt",          c: "#ef4444", i: "📉" },
  { id: "other_exp",     l: "Other",         c: "#64748b", i: "🧾", needsNote: true },
];
const ALL_CATS = [...INC, ...EXP];
const gc = id => ALL_CATS.find(c => c.id === id) || { l: id, c: T.sub, i: "•" };

// ── LIABILITY TYPES ───────────────────────────────────────────────────────────
const LIAB_TYPES = [
  { id: "mortgage",   l: "Mortgage",      i: "🏡", c: "#ff3d5c", isMortgage: true  },
  { id: "auto",       l: "Auto Loan",     i: "🚗", c: "#ffa726", isMortgage: false },
  { id: "credit_card",l: "Credit Card",   i: "💳", c: "#c084fc", isMortgage: false },
  { id: "student",    l: "Student Loan",  i: "📚", c: "#60a5fa", isMortgage: false },
  { id: "personal",   l: "Personal Loan", i: "💸", c: "#f472b6", isMortgage: false },
  { id: "heloc",      l: "HELOC",         i: "🏦", c: "#f5a623", isMortgage: true  },
  { id: "other_debt", l: "Other Debt",    i: "📉", c: "#64748b", isMortgage: false },
];
const getLT = id => LIAB_TYPES.find(t => t.id === id) || LIAB_TYPES[6];

// ── DIVIDEND TICKER REFERENCE DATA ────────────────────────────────────────────
// No live market-data connector is available in this environment, so this is a
// static reference table of common dividend payers (approximate figures as of
// late 2025 / early 2026) used to auto-populate the add-holding form when a
// user types a known ticker. Every field remains user-editable after autofill
// — this is a helpful starting point, not a live quote, and figures will
// drift from real market values over time.
const DIV_TICKER_DATA = {
  VYM:  { name: "Vanguard High Dividend Yield ETF", annualDiv: 3.12, yieldPct: 2.9, divGrowthRate: 6.2,  sector: "ETF",        payDays: [24], payMonths: [2,5,8,11] },
  SCHD: { name: "Schwab US Dividend Equity ETF",    annualDiv: 2.68, yieldPct: 3.5, divGrowthRate: 10.1, sector: "ETF",        payDays: [22], payMonths: [2,5,8,11] },
  O:    { name: "Realty Income Corp",               annualDiv: 3.16, yieldPct: 5.6, divGrowthRate: 3.5,  sector: "REIT",       payDays: [15], payMonths: [0,1,2,3,4,5,6,7,8,9,10,11] },
  JNJ:  { name: "Johnson & Johnson",                annualDiv: 5.15, yieldPct: 3.1, divGrowthRate: 5.2,  sector: "Healthcare", payDays: [3],  payMonths: [2,5,8,11] },
  PG:   { name: "Procter & Gamble",                 annualDiv: 4.03, yieldPct: 2.4, divGrowthRate: 5.0,  sector: "Consumer",   payDays: [15], payMonths: [1,4,7,10] },
  KO:   { name: "Coca-Cola Co",                     annualDiv: 1.94, yieldPct: 3.0, divGrowthRate: 4.5,  sector: "Consumer",   payDays: [1],  payMonths: [3,6,9,11] },
  PEP:  { name: "PepsiCo Inc",                      annualDiv: 5.42, yieldPct: 3.4, divGrowthRate: 6.8,  sector: "Consumer",   payDays: [30], payMonths: [0,2,5,8] },
  MO:   { name: "Altria Group",                     annualDiv: 4.16, yieldPct: 7.8, divGrowthRate: 4.0,  sector: "Consumer",   payDays: [10], payMonths: [0,3,6,9] },
  T:    { name: "AT&T Inc",                         annualDiv: 1.11, yieldPct: 5.2, divGrowthRate: 1.5,  sector: "Technology", payDays: [1],  payMonths: [0,3,6,9] },
  VZ:   { name: "Verizon Communications",           annualDiv: 2.71, yieldPct: 6.2, divGrowthRate: 2.0,  sector: "Technology", payDays: [1],  payMonths: [0,3,6,9] },
  XOM:  { name: "Exxon Mobil Corp",                 annualDiv: 3.96, yieldPct: 3.3, divGrowthRate: 4.0,  sector: "Energy",     payDays: [10], payMonths: [2,5,8,11] },
  CVX:  { name: "Chevron Corp",                     annualDiv: 6.84, yieldPct: 4.0, divGrowthRate: 6.0,  sector: "Energy",     payDays: [10], payMonths: [2,5,8,11] },
  MSFT: { name: "Microsoft Corp",                   annualDiv: 3.32, yieldPct: 0.7, divGrowthRate: 10.5, sector: "Technology", payDays: [12], payMonths: [2,5,8,11] },
  AAPL: { name: "Apple Inc",                        annualDiv: 1.04, yieldPct: 0.4, divGrowthRate: 4.5,  sector: "Technology", payDays: [15], payMonths: [1,4,7,10] },
  ABBV: { name: "AbbVie Inc",                       annualDiv: 6.56, yieldPct: 3.4, divGrowthRate: 8.0,  sector: "Healthcare", payDays: [15], payMonths: [1,4,7,10] },
  HD:   { name: "Home Depot Inc",                   annualDiv: 9.00, yieldPct: 2.3, divGrowthRate: 7.5,  sector: "Consumer",   payDays: [19], payMonths: [2,5,8,11] },
  MAIN: { name: "Main Street Capital Corp",          annualDiv: 3.06, yieldPct: 5.8, divGrowthRate: 5.0,  sector: "Financial",  payDays: [1],  payMonths: [0,1,2,3,4,5,6,7,8,9,10,11] },
  JEPI: { name: "JPMorgan Equity Premium Income ETF",annualDiv: 5.20, yieldPct: 8.9, divGrowthRate: 1.0,  sector: "ETF",        payDays: [1],  payMonths: [0,1,2,3,4,5,6,7,8,9,10,11] },
  VNQ:  { name: "Vanguard Real Estate ETF",         annualDiv: 3.44, yieldPct: 3.9, divGrowthRate: 3.0,  sector: "REIT",       payDays: [27], payMonths: [2,5,8,11] },
  IBM:  { name: "IBM Corp",                         annualDiv: 6.68, yieldPct: 3.5, divGrowthRate: 4.5,  sector: "Technology", payDays: [10], payMonths: [2,5,8,11] },
};

// ── INVESTMENT STRATEGIES ─────────────────────────────────────────────────────
const STRATS = [
  { id: "conservative", l: "Conservative", alloc: "80% Bonds / 20% Stocks", ret: 4, risk: "Low",    i: "🛡️", desc: "Capital preservation. Best within 5 yrs of retirement." },
  { id: "moderate",     l: "Moderate",     alloc: "50% Bonds / 50% Stocks", ret: 6, risk: "Medium", i: "⚖️", desc: "Balanced growth. Most popular for families." },
  { id: "aggressive",   l: "Aggressive",   alloc: "20% Bonds / 80% Stocks", ret: 8, risk: "High",   i: "🚀", desc: "Max growth. Best for 20+ year horizons." },
  { id: "index",        l: "Index (VTI)",  alloc: "100% Total Market",       ret: 9,   risk: "High",   i: "📊", desc: "100% equities, no bond cushion. Low-cost, broadly diversified — but fully exposed to market swings." },
  { id: "dividend",     l: "Dividend",     alloc: "Dividend-focused stocks", ret: 9.5, risk: "Medium", i: "💎", desc: "Regular cash income supplement, with price appreciation historically averaging near 9.5%." },
  { id: "target",       l: "Target Date",  alloc: "Auto-adjusting mix",      ret: 7, risk: "Low-Med",i: "🎯", desc: "Auto grows conservative near retirement." },
];

// ── HELPERS ───────────────────────────────────────────────────────────────────
const fmt  = v => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v || 0);
const fmtD = v => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v || 0);
const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// A transaction's `aId` can point at either a real account or a liability
// (e.g. a credit card charge/payment). Liability IDs are distinguished with
// a "liab:" prefix so the two ID spaces never collide, letting `aId` stay a
// single field everywhere else in the app.
const isLiabId = aId => typeof aId === "string" && aId.startsWith("liab:");
const liabIdOf = liabilityId => `liab:${liabilityId}`;
const rawLiabId = aId => aId.slice(5);
function resolveTxnSource(aId, accounts, liabilities) {
  if (isLiabId(aId)) {
    const l = liabilities.find(x => x.id === rawLiabId(aId));
    return l ? { name: l.name, kind: "liability", ref: l } : null;
  }
  const a = accounts.find(x => x.id === aId);
  return a ? { name: a.name, kind: "account", ref: a } : null;
}

function projRet(bal, mo, yrs, rate) {
  const r = rate / 100 / 12, n = yrs * 12;
  return Math.round(bal * Math.pow(1 + r, n) + mo * ((Math.pow(1 + r, n) - 1) / r));
}
function buildProj(bal, mo, yrs, rate, goal) {
  const data = [], r = rate / 100 / 12, startYr = new Date().getFullYear();
  let b = bal;
  for (let y = 0; y <= yrs; y++) {
    data.push({ year: startYr + y, balance: Math.round(b), goal });
    for (let m = 0; m < 12; m++) b = b * (1 + r) + mo;
  }
  return data;
}
function buildRetHist(currentBal, monthlyInvest, rate) {
  // Walk backwards from today's real balance, undoing one month of
  // growth + contribution at a time. Returns 7 points (6 months ago → now).
  const r = rate / 100 / 12;
  const now = new Date();
  const bals = [currentBal];
  let b = currentBal;
  for (let i = 0; i < 6; i++) {
    b = (b - monthlyInvest) / (1 + r);
    bals.unshift(Math.max(0, b));
  }
  return bals.map((bal, idx) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (6 - idx), 1);
    return { mo: `${MO[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`, bal: Math.round(bal) };
  });
}
function exportCSV(txns, accounts, liabilities) {
  const header = ["Date","Description","Category","Category Detail","Account","Amount","Type"];
  const rows = [...txns].sort((a, b) => new Date(a.date) - new Date(b.date)).map(t => {
    const src = resolveTxnSource(t.aId, accounts, liabilities || []);
    return [t.date, `"${t.desc}"`, gc(t.cat).l, `"${t.catNote || ""}"`, src ? src.name : "", fmtD(Math.abs(t.amt)), t.amt > 0 ? "Income" : "Expense"];
  });
  const csv = [header, ...rows].map(r => r.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `family-finance-${new Date().getFullYear()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── DEFAULT (BLANK) STATE — new users start with nothing ──────────────────────
// U.S. Bureau of Labor Statistics / Gallup survey data consistently puts the
// average retirement age in the low-to-mid 60s; 65 is the commonly cited
// reference point (also the traditional Medicare-eligibility age).
const AVG_RETIREMENT_AGE = 65;

// Age-based retirement savings-multiple benchmark (smoothly interpolated,
// not bucketed by decade): roughly 0.5x salary at 25, 1x by 30, 3x by 40,
// 6x by 50, 8x by 60, 10x by 67 — standard retirement-planning rules of
// thumb. Interpolating between anchor points means a 45-year-old and a
// 49-year-old get meaningfully different targets instead of both being
// lumped into "40s." Module-scope (not defined inside FinancialHealthScore)
// so this static reference data and its lookup function are created once,
// not recreated on every render — the same class of avoidable per-render
// cost that GaugeArc had, though here it's a plain data function rather
// than a JSX component, so the earlier bug's remounting/animation issue
// does not apply — this is purely an allocation saving, not a correctness fix.
const AGE_MULT_ANCHORS = [[25, 0.5], [30, 1], [35, 2], [40, 3], [45, 4.5], [50, 6], [55, 7], [60, 8], [67, 10]];
function ageMultiple(age) {
  if (age <= AGE_MULT_ANCHORS[0][0]) return AGE_MULT_ANCHORS[0][1];
  for (let i = 0; i < AGE_MULT_ANCHORS.length - 1; i++) {
    const [a0, m0] = AGE_MULT_ANCHORS[i], [a1, m1] = AGE_MULT_ANCHORS[i + 1];
    if (age >= a0 && age <= a1) return m0 + (m1 - m0) * ((age - a0) / (a1 - a0));
  }
  return AGE_MULT_ANCHORS[AGE_MULT_ANCHORS.length - 1][1];
}
const BLANK_PROFILE = { firstName: "", lastName: "", email: "", state: "", payFrequency: "biweekly", takeHomePerPeriod: "" };
const BLANK_GOALS = {
  savingsRatePct: 20, monthlySavings: 0,
  retireAge: AVG_RETIREMENT_AGE, currentAge: 30, nestEgg: 1000000,
  investStrategy: "index", monthlyInvest: 0, filing: "single",
  categoryBudgets: {},
};
const BLANK_INSURANCE = {
  wholeLife:  { answered: false, has: false, coverage: 0, monthlyPremium: 0 },
  termLife:   { answered: false, has: false, coverage: 0, monthlyPremium: 0, termYears: 20 },
  disability: { answered: false, has: false, monthlyBenefit: 0, monthlyPremium: 0 },
  // Populated by AI document analysis (see InsuranceDocAnalyzer). Never holds
  // the uploaded file itself — only the extracted, structured findings — so
  // storage stays small and no document image/PDF persists after analysis.
  docAnalysis: null, // { analyzedAt, policyType, findings: [], gaps: [], constraints: [], maxMonthlyDistribution, summary }
};

// ── SHARED STYLE OBJECTS (responsive) ──────────────────────────────────────────
// CS's values embed T.xxx color strings — if CS were a plain object like
// before, those strings would be frozen at module-load time (the original
// dark palette) and never update when the theme changes. Wrapping it in a
// Proxy means every `CS.card` (etc.) access anywhere in the file re-reads
// T's *current* values, so theme switching works without touching any of
// the ~300 call sites that already do `style={CS.card}` and similar.
//
// PERFORMANCE: computeCS() was being called fresh on every single property
// access (CS.card, CS.lbl, CS.inp, ...) — hundreds of times per render,
// each one rebuilding ~10 style objects from scratch just to read one of
// them. Cached here, keyed on `themeVersion` (bumped only inside
// applyTheme): the cache is reused for every access between theme changes,
// and only rebuilt on the render right after the user actually switches
// theme. Behavior is identical; this only removes redundant recomputation.
let _csCache = null;
let _csCacheVersion = -1;
function computeCS() {
  if (_csCache && _csCacheVersion === themeVersion) return _csCache;
  _csCache = {
    card:     { background: T.s2, borderRadius: "14px", padding: "18px 22px", border: `1px solid ${T.border}` },
    lbl:      { fontSize: "9px", color: T.sub, letterSpacing: "2px", textTransform: "uppercase", fontWeight: "700", marginBottom: "4px" },
    big:      { fontSize: "24px", fontWeight: "900", letterSpacing: "-0.5px" },
    sec:      { fontSize: "10px", color: T.sub, letterSpacing: "2px", textTransform: "uppercase", fontWeight: "700", marginBottom: "12px" },
    inp:      { width: "100%", padding: "9px 11px", borderRadius: "8px", border: `1px solid ${T.border}`, background: T.s1, color: T.text, fontFamily: "inherit", fontSize: "12px", boxSizing: "border-box" },
    // Responsive grids: minmax() lets columns collapse to fewer per row on narrow screens instead of overflowing.
    g4:       { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "18px" },
    g3:       { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "18px" },
    g2:       { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px", marginBottom: "18px" },
    txnRow:   { display: "flex", alignItems: "center", gap: "11px", padding: "10px 0", borderBottom: `1px solid ${T.s1}` },
    recRow:   { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${T.border}`, flexWrap: "wrap", gap: "6px" },
    modalWrap:{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, backdropFilter: "blur(6px)", padding: "16px", boxSizing: "border-box" },
    // maxWidth caps at 90vw so modals never overflow a phone screen; width is a ceiling, not a fixed size.
    mbox:     { background: T.s2, borderRadius: "16px", padding: "24px", width: "440px", maxWidth: "90vw", border: `1px solid ${T.border}`, maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box" },
  };
  _csCacheVersion = themeVersion;
  return _csCache;
}
const CS = new Proxy({}, { get: (_target, prop) => computeCS()[prop] });
const btn  = (bg, c) => ({ padding: "8px 16px", borderRadius: "8px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: "700", background: bg || T.s3, color: c || T.text });
const navB = a => ({ padding: "6px 13px", borderRadius: "7px", border: "none", cursor: "pointer", fontSize: "11px", fontWeight: "700", fontFamily: "inherit", background: a ? T.blue : "transparent", color: a ? "#fff" : T.sub, whiteSpace: "nowrap" });
const stab = a => ({ padding: "6px 14px", borderRadius: "6px", border: a ? `1px solid ${T.blue}44` : "1px solid transparent", cursor: "pointer", fontSize: "11px", fontWeight: "700", fontFamily: "inherit", background: a ? `${T.blue}22` : T.s1, color: a ? T.blue : T.sub, whiteSpace: "nowrap" });

// ── APP LOGO — SVG recreation of the MMM mark (bronze/silver/gold, ascending) ─
// Built as inline SVG rather than the uploaded PNG: an artifact this size
// can't embed a multi-hundred-KB photographic render as a data URI without
// bloating the file, and SVG scales cleanly at any header size and adapts
// automatically if the metallic tones ever need tweaking per-theme.
function MMMLogo({ size = 34 }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, ""); // gradient ids must be unique per instance if the logo renders more than once on a page
  const h = size, w = size * 1.7;
  return (
    <svg width={w} height={h} viewBox="0 0 170 100" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={`mmmBronze${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#8b4f28" /><stop offset="50%" stopColor="#c17a4a" /><stop offset="100%" stopColor="#e8bd94" />
        </linearGradient>
        <linearGradient id={`mmmSilver${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#96969e" /><stop offset="50%" stopColor="#d4d4dc" /><stop offset="100%" stopColor="#f5f5fa" />
        </linearGradient>
        <linearGradient id={`mmmGold${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#a8791f" /><stop offset="50%" stopColor="#e0b23f" /><stop offset="100%" stopColor="#fce8a8" />
        </linearGradient>
      </defs>
      {/* Three "M"s stepping up a diagonal, each one larger — mirrors the uploaded mark */}
      <text x="0"  y="92" fontFamily="Georgia,'Times New Roman',serif" fontWeight="700" fontSize="46" fill={`url(#mmmBronze${uid})`}>M</text>
      <text x="46" y="72" fontFamily="Georgia,'Times New Roman',serif" fontWeight="700" fontSize="58" fill={`url(#mmmSilver${uid})`}>M</text>
      <text x="98" y="48" fontFamily="Georgia,'Times New Roman',serif" fontWeight="700" fontSize="70" fill={`url(#mmmGold${uid})`}>M</text>
    </svg>
  );
}

// ── THEME PREFERENCE — dark | light | system, persisted via window.storage ──
function useThemePreference() {
  const [pref, setPrefState] = useState("dark");
  const [resolved, setResolved] = useState("dark");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let stored = "dark";
      if (window.storage) {
        try {
          const r = await window.storage.get("themePreference", false);
          if (r && r.value) stored = r.value;
        } catch {} // no saved preference yet — default to dark
      }
      if (!cancelled) {
        setPrefState(stored);
        setResolved(applyTheme(stored));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // While set to "system", follow live OS-level changes (e.g. auto dark mode at sunset).
  useEffect(() => {
    if (pref !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(applyTheme("system"));
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange); };
  }, [pref]);

  async function setPref(next) {
    setPrefState(next);
    setResolved(applyTheme(next));
    if (window.storage) { try { await window.storage.set("themePreference", next, false); } catch {} }
  }

  return { pref, resolved, setPref };
}

function ThemeToggle({ pref, setPref }) {
  const [open, setOpen] = useState(false);
  const OPTIONS = [["dark", "🌙", "Dark"], ["light", "☀️", "Light"], ["system", "🖥️", "System"]];
  const current = OPTIONS.find(o => o[0] === pref) || OPTIONS[0];
  return (
    <div style={{ position: "relative" }}>
      <button style={btn(T.s3)} onClick={() => setOpen(o => !o)} title="Theme">{current[1]} {current[2]}</button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: T.s2, border: `1px solid ${T.border}`, borderRadius: "10px", padding: "6px", zIndex: 91, minWidth: "140px", boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
            {OPTIONS.map(([id, icon, label]) => (
              <button key={id} onClick={() => { setPref(id); setOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "8px 10px", borderRadius: "6px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: pref === id ? "800" : "500", background: pref === id ? `${T.blue}1f` : "transparent", color: pref === id ? T.blue : T.text, textAlign: "left" }}>
                <span>{icon}</span><span>{label}</span>{pref === id && <span style={{ marginLeft: "auto" }}>✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── DISCLAIMER ───────────────────────────────────────────────────────────────
const APP_NAME = "Mindful Money Management";

function DisclaimerModal({ onClose }) {
  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "520px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "18px", marginBottom: "4px" }}>Disclaimer</div>
        <div style={{ fontSize: "10px", color: T.sub, marginBottom: "18px" }}>Please read before using {APP_NAME}.</div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "12px", fontWeight: "800", color: T.gold, marginBottom: "6px" }}>Not Financial Advice</div>
          <div style={{ fontSize: "12px", color: T.text, lineHeight: "1.6" }}>
            The content and tools provided by {APP_NAME} are for informational and educational purposes only. Nothing in this app constitutes professional financial, investment, tax, or legal advice, and no output should be treated as certified or personalized advice from a licensed professional. You should consult a licensed financial advisor before making any financial decisions.
          </div>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "12px", fontWeight: "800", color: T.silver, marginBottom: "6px" }}>No Guarantees</div>
          <div style={{ fontSize: "12px", color: T.text, lineHeight: "1.6" }}>
            {APP_NAME} makes no representations or warranties regarding the accuracy, completeness, or reliability of any financial data, projections, or calculations shown. Synced and market data may be delayed, incomplete, or contain errors, and is not guaranteed to be real-time. Past performance of any financial asset or strategy does not guarantee future results — investing involves risk, including the possible loss of principal.
          </div>
        </div>

        <div style={{ marginBottom: "6px" }}>
          <div style={{ fontSize: "12px", fontWeight: "800", color: T.bronze, marginBottom: "6px" }}>Limitation of Liability</div>
          <div style={{ fontSize: "12px", color: T.text, lineHeight: "1.6" }}>
            Use of {APP_NAME} is at your own risk. The developers and owners of this app are not liable for any financial losses, damages, or errors resulting from the use of its tools or content. You are solely responsible for your own financial decisions and their outcomes.
          </div>
        </div>

        <button style={{ ...btn(T.blue, "#fff"), width: "100%", marginTop: "20px" }} onClick={onClose}>I Understand</button>
      </div>
    </div>
  );
}

function DisclaimerFooter({ onOpen }) {
  return (
    <div style={{ textAlign: "center", padding: "20px 16px 32px", fontSize: "10px", color: T.sub, lineHeight: "1.6" }}>
      {APP_NAME} is for informational and educational purposes only and is not financial advice.{" "}
      <button onClick={onOpen} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "10px", color: T.blue, textDecoration: "underline" }}>Read full disclaimer</button>
    </div>
  );
}

// "Received" / "Declared" / "Estimated" are inferred from each holding's pay
// calendar (payMonths/payDays) relative to today — that's still the only
// source for months with no linked brokerage account, or for the "Estimated"
// portion of any future month (nobody can confirm a dividend that hasn't
// been paid yet). But wherever `confirmedByMonth`/`confirmedByYear` (built
// from Plaid's /investments/transactions/get, see useConfirmedDividends
// below) has real data for a period, that real total REPLACES the estimate
// for "received" rather than sitting alongside it — each series entry
// carries a `confirmed` flag so the UI can show which is which.

function perPaymentAmount(h) {
  return (h.annualDiv * h.shares) / Math.max(h.payMonths.length, 1);
}

function buildMonthlyIncomeSeries(holdings, now, direction, confirmedByMonth = {}) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const offset = direction === "FWD" ? i : i - 11;
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = d.getFullYear(), month = d.getMonth();
    const isPast = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth());
    const isFuture = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());
    let received = 0, declared = 0, estRegular = 0;
    holdings.forEach(h => {
      if (!h.payMonths.includes(month)) return;
      const amt = perPaymentAmount(h);
      if (isPast) received += amt;
      else if (isFuture) estRegular += amt;
      else { // current month — split on whether the pay day has happened yet
        if (now.getDate() >= Math.min(...h.payDays)) received += amt; else declared += amt;
      }
    });

    const key = `${year}-${month}`;
    const confirmedAmt = confirmedByMonth[key];
    let confirmed = false;
    if (confirmedAmt != null && !isFuture) {
      received = confirmedAmt; declared = 0; confirmed = true;
    }

    out.push({
      label: `${MO[month]} '${String(year).slice(2)}`, year, month, confirmed,
      received: Math.round(received * 100) / 100, declared: Math.round(declared * 100) / 100,
      estRegular: Math.round(estRegular * 100) / 100, estIrregular: 0,
    });
  }
  return out;
}

function buildYearlyIncomeSeries(holdings, now, direction, confirmedByYear = {}, count = 10) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const n = direction === "FWD" ? i : -(count - 1 - i);
    const year = now.getFullYear() + n;
    let total = holdings.reduce((s, h) => s + h.shares * h.annualDiv * Math.pow(1 + h.divGrowthRate / 100, n), 0);
    let confirmed = false;
    // Only override with confirmed data for a year that's actually over (or
    // the current year, where it's a real partial total) — never for a
    // future projected year, which by definition has no transactions yet.
    if (n <= 0 && confirmedByYear[year] != null) {
      total = confirmedByYear[year];
      confirmed = true;
    }
    out.push({ label: String(year), total: Math.round(total), confirmed });
  }
  return out;
}

function receivedForPeriod(holdings, now, granularity, confirmedByMonth = {}) {
  // granularity: "MTD" | "YTD"
  let received = 0, estTotal = 0;
  const monthsToScan = granularity === "YTD" ? [...Array(now.getMonth() + 1).keys()] : [now.getMonth()];
  monthsToScan.forEach(m => {
    const isPastMonth = m < now.getMonth();
    const key = `${now.getFullYear()}-${m}`;
    const confirmedAmt = confirmedByMonth[key];
    let monthReceived = 0, monthEst = 0;
    holdings.forEach(h => {
      if (!h.payMonths.includes(m)) return;
      const amt = perPaymentAmount(h);
      monthEst += amt;
      if (isPastMonth) monthReceived += amt;
      else if (now.getDate() >= Math.min(...h.payDays)) monthReceived += amt;
    });
    if (confirmedAmt != null) monthReceived = confirmedAmt; // real data wins over the projection
    received += monthReceived;
    estTotal += monthEst;
  });
  return { received, estTotal };
}

function upcomingExDates(holdings, now, count = 6) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const events = [];
  holdings.forEach(h => {
    h.payMonths.forEach(m => {
      h.payDays.forEach(d => {
        let dt = new Date(now.getFullYear(), m, d);
        if (dt < startOfToday) dt = new Date(now.getFullYear() + 1, m, d);
        const payout = new Date(dt); payout.setDate(payout.getDate() + 8); // typical ~1wk ex→pay lag, estimated
        events.push({ ticker: h.ticker, date: dt, payout, amount: perPaymentAmount(h) });
      });
    });
  });
  return events.sort((a, b) => a.date - b.date).slice(0, count);
}

const fmtMD = d => `${MO[d.getMonth()]} ${d.getDate()}`;

// ── CONFIRMED DIVIDENDS — GET /api/dividends/confirmed/{user} (Plaid) ───────
// Fetched once and reshaped into the lookup maps the merge logic above
// needs: byMonth ("2026-7" -> $) and byYear (2026 -> $), plus the raw list
// for a transaction-level view in the details modal.
function useConfirmedDividends() {
  const [state, setState] = useState({ status: API_BASE ? "loading" : "off", list: [], byMonth: {}, byYear: {} });

  useEffect(() => {
    if (!API_BASE) return;
    let cancelled = false;
    apiGet("/api/dividends/confirmed/demo-user?months=24")
      .then(list => {
        if (cancelled) return;
        const rows = list || [];
        const byMonth = {}, byYear = {};
        rows.forEach(d => {
          const dt = new Date(d.date);
          const mKey = `${dt.getFullYear()}-${dt.getMonth()}`;
          byMonth[mKey] = (byMonth[mKey] || 0) + d.amount;
          byYear[dt.getFullYear()] = (byYear[dt.getFullYear()] || 0) + d.amount;
        });
        setState({ status: "ok", list: rows, byMonth, byYear });
      })
      .catch(() => { if (!cancelled) setState({ status: "error", list: [], byMonth: {}, byYear: {} }); });
    return () => { cancelled = true; };
  }, []);

  return state;
}

// ── DIVIDEND ANALYTICS MODAL — GET /api/market/dividend-analytics/{symbol} (Tiingo) ─

// Shows dividend CAGR, yield on cost, current yield, and price appreciation
// vs. the S&P 500, computed server-side from Tiingo's EOD history endpoint
// (which includes per-day dividend cash amounts, unlike the IEX quote used
// by LivePriceBadge). Silent no-op UI when API_BASE isn't configured.
const PERIODS = [1, 3, 5, 10];

function StatRow({ label, values, suffix = "%", color }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 56px)", gap: "6px", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.s1}` }}>
      <div style={{ fontSize: "11px", color: "#8ab4cc" }}>{label}</div>
      {PERIODS.map(p => {
        const v = values ? values[`${p}y`] : null;
        return (
          <div key={p} style={{ textAlign: "right", fontSize: "11px", fontWeight: "700", color: v == null ? T.sub : color }}>
            {v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}${suffix}`}
          </div>
        );
      })}
    </div>
  );
}

function DividendAnalyticsModal({ holding, onClose }) {
  const [state, setState] = useState({ status: API_BASE ? "loading" : "off", data: null });

  useEffect(() => {
    if (!API_BASE) return;
    let cancelled = false;
    setState({ status: "loading", data: null });
    const qs = holding.costBasis ? `?cost_basis=${encodeURIComponent(holding.costBasis)}` : "";
    apiGet(`/api/market/dividend-analytics/${encodeURIComponent(holding.ticker)}${qs}`)
      .then(d => { if (!cancelled) setState({ status: "ok", data: d }); })
      .catch(() => { if (!cancelled) setState({ status: "error", data: null }); });
    return () => { cancelled = true; };
  }, [holding.ticker, holding.costBasis]);

  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "480px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "4px" }}>{holding.ticker} — Dividend & Growth Analytics</div>
        <div style={{ fontSize: "11px", color: T.sub, marginBottom: "16px" }}>Sourced from Tiingo end-of-day history · benchmarked against the S&amp;P 500 (SPY)</div>

        {state.status === "off" && (
          <div style={{ fontSize: "12px", color: T.sub, padding: "20px 0" }}>Backend not configured — set API_BASE to enable live analytics.</div>
        )}
        {state.status === "loading" && (
          <div style={{ fontSize: "12px", color: T.sub, padding: "20px 0" }}>Loading dividend history…</div>
        )}
        {state.status === "error" && (
          <div style={{ fontSize: "12px", color: T.red, padding: "20px 0" }}>Couldn't load analytics for {holding.ticker}. The backend or Tiingo may be unavailable, or this ticker may not have enough history.</div>
        )}

        {state.status === "ok" && state.data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "18px" }}>
              <div style={CS.card}><div style={CS.lbl}>Current Yield</div><div style={{ ...CS.big, fontSize: "20px", color: T.green }}>{state.data.current_yield_pct != null ? `${state.data.current_yield_pct.toFixed(2)}%` : "—"}</div>{state.data.yield_source === "computed" && <div style={{ fontSize: "8px", color: T.sub, marginTop: "3px" }}>Computed (Tiingo yield series unavailable)</div>}</div>
              <div style={CS.card}><div style={CS.lbl}>Yield on Cost</div><div style={{ ...CS.big, fontSize: "20px", color: T.cyan }}>{state.data.yield_on_cost_pct != null ? `${state.data.yield_on_cost_pct.toFixed(2)}%` : "— (no cost basis)"}</div></div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 56px)", gap: "6px", marginBottom: "4px" }}>
              <div />
              {PERIODS.map(p => <div key={p} style={{ textAlign: "right", fontSize: "9px", color: T.sub, fontWeight: "700" }}>{p}Y</div>)}
            </div>
            <StatRow label="Dividend CAGR" values={state.data.dividend_cagr_pct} color={T.gold} />
            <StatRow label="Share Appreciation" values={state.data.price_appreciation_cagr_pct} color={T.blue} />
            <StatRow label="vs. S&P 500 (excess)" values={state.data.vs_benchmark_excess_return_pct} color={T.purple} />

            {state.data.recent_distributions && state.data.recent_distributions.length > 0 && (
              <div style={{ marginTop: "16px" }}>
                <div style={{ fontSize: "10px", color: T.sub, letterSpacing: "1px", textTransform: "uppercase", fontWeight: "700", marginBottom: "8px" }}>
                  Recent Distributions{state.data.distribution_frequency ? ` · ${state.data.distribution_frequency}` : ""}
                </div>
                {state.data.recent_distributions.map((d, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", padding: "4px 0", borderBottom: `1px solid ${T.s1}` }}>
                    <span style={{ color: T.sub }}>Ex-Date {d.ex_date}{d.payment_date ? ` · Paid ${d.payment_date}` : ""}</span>
                    <span style={{ fontWeight: "700", color: T.green }}>${d.amount.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            )}

            {state.data.distribution_source === "eod-divcash-fallback" && (
              <div style={{ fontSize: "9px", color: T.gold, marginTop: "10px" }}>
                ⚠ Distribution detail (payment dates, frequency) unavailable from Tiingo's corporate-actions endpoint for this ticker — figures above are derived from adjusted price history instead. Totals are still accurate; per-payment dates are not shown.
              </div>
            )}

            <div style={{ fontSize: "9px", color: T.sub, marginTop: "14px", lineHeight: "1.5" }}>
              Dividend CAGR compares full completed calendar years N years apart. Share appreciation is price-only (adjusted close), calculated separately from yield so dividends aren't double-counted. As of {new Date(state.data.fetched_at * 1000).toLocaleString()}.
            </div>
          </>
        )}

        <button style={{ ...btn(T.s3), width: "100%", marginTop: "18px" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── LIVE PRICE BADGE — GET /api/market/ticker/{symbol} (Tiingo) ─────────────
// Small inline pill used next to a holding's ticker. Silent no-op when
// API_BASE isn't configured, so it never breaks the offline experience.
function LivePriceBadge({ symbol }) {
  const [state, setState] = useState({ status: API_BASE ? "loading" : "off", price: null });

  useEffect(() => {
    if (!API_BASE || !symbol) return;
    let cancelled = false;
    setState({ status: "loading", price: null });
    apiGet(`/api/market/ticker/${encodeURIComponent(symbol)}`)
      .then(d => { if (!cancelled) setState({ status: "ok", price: d?.current_price ?? null }); })
      .catch(() => { if (!cancelled) setState({ status: "error", price: null }); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (state.status === "off") return null;
  if (state.status === "loading") return <span style={{ fontSize: "9px", color: T.sub }}>···</span>;
  if (state.status === "error" || state.price == null) return <span style={{ fontSize: "9px", color: T.sub }} title="Live price unavailable">—</span>;
  return <span style={{ fontSize: "10px", fontWeight: "800", color: T.cyan }} title="Live price via Tiingo">${state.price.toFixed(2)}</span>;
}

// ── BANK SYNC CARD — Plaid Link flow (create-link-token → exchange-public-token) ─
// This only requests a link_token from the backend and reports status; actually
// opening Plaid's secure hosted login modal requires Plaid's own Link script
// (loaded from cdn.plaid.com, outside this artifact's sandbox), so wire
// `linkToken` into `Plaid.create({...}).open()` once this runs on your own
// domain. The public_token that callback returns should then go to
// POST /api/plaid/exchange-public-token exactly as the backend expects.
function BankSyncCard() {
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error | off
  const [linkToken, setLinkToken] = useState(null);

  async function connect() {
    if (!API_BASE) { setStatus("off"); return; }
    setStatus("loading");
    try {
      const d = await apiPost("/api/plaid/create-link-token", { user_id: "demo-user" });
      setLinkToken(d?.link_token || null);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div style={{ ...CS.card, border: `1px solid ${T.blue}44`, display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", marginBottom: "16px" }}>
      <div style={{ fontSize: "22px" }}>🏦</div>
      <div style={{ flex: 1, minWidth: "180px" }}>
        <div style={{ fontSize: "12px", fontWeight: "800" }}>Bank Sync (Plaid)</div>
        <div style={{ fontSize: "10px", color: T.sub, marginTop: "2px" }}>
          {status === "idle" && "Link a real account to auto-import balances, transactions & confirmed dividends."}
          {status === "loading" && "Requesting a secure link token…"}
          {status === "ready" && "Link token issued — open Plaid Link to finish connecting."}
          {status === "error" && "Couldn't reach the sync backend. Check API_BASE / server logs."}
          {status === "off" && "Backend not configured — set API_BASE to enable live sync."}
        </div>
      </div>
      <button style={btn(T.blue, "#fff")} onClick={connect} disabled={status === "loading"}>
        {status === "ready" ? "✓ Token Ready" : "Connect Bank"}
      </button>
    </div>
  );
}

// ── PLAID DATA MERGE — folds synced accounts/transactions into the app's own
// income, expense & liability models, instead of living in a separate,
// parallel "Plaid data" silo. ─────────────────────────────────────────────
//
// Sign convention: Plaid's `amount` is positive when money LEAVES the
// account (a purchase, a card charge) and negative when money ENTERS it (a
// deposit, a paycheck, a refund) — the opposite of this app's convention,
// where amt > 0 = income. Flipping the sign (`-pt.amount`) converts either
// direction correctly, including for a credit card: a positive Plaid amount
// (a charge) becomes a negative app amt (an "expense"), which is exactly
// the txn type applyTxnEffect uses to INCREASE what's owed on a liability.
//
// Balances for linked accounts/liabilities are set directly from Plaid's
// own current_balance/credit_limit, not accumulated from imported
// transactions — Plaid's balance is authoritative, so imported txns are
// historical/categorization records only and never call applyTxnEffect.

function mapPlaidCategory(primary, detailed) {
  const p = (primary || "").toUpperCase();
  const d = (detailed || "").toUpperCase();
  if (p === "INCOME") {
    if (d.includes("DIVIDEND")) return "dividends";
    if (d.includes("WAGE") || d.includes("SALARY") || d.includes("PAYROLL")) return "salary";
    if (d.includes("INTEREST")) return "other_inc";
    return "other_inc";
  }
  if (p === "LOAN_PAYMENTS") return "debt";
  if (p === "FOOD_AND_DRINK") return d.includes("GROCER") ? "groceries" : "dining";
  if (p === "ENTERTAINMENT") return "entertainment";
  if (p === "MEDICAL") return "healthcare";
  if (p === "TRANSPORTATION") return "transport";
  if (p === "TRAVEL") return "travel";
  if (p === "HOME_IMPROVEMENT") return "housing";
  if (p === "RENT_AND_UTILITIES") return (d.includes("RENT") || d.includes("MORTGAGE")) ? "housing" : "utilities";
  if (p === "GENERAL_SERVICES") return d.includes("SUBSCRIPTION") ? "subscriptions" : "other_exp";
  if (p === "PERSONAL_CARE") return "other_exp";
  if (p === "BANK_FEES") return "other_exp";
  return "other_exp";
}

// TRANSFER_IN/TRANSFER_OUT are money moving between the person's own linked
// accounts (e.g. checking → savings) — importing those as income/expense
// would double-count money that never actually left the household.
const isPlaidTransferCategory = primary => ["TRANSFER_IN", "TRANSFER_OUT"].includes((primary || "").toUpperCase());

function upsertPlaidAccounts(plaidAccounts, accounts, liabilities) {
  let nextAccounts = [...accounts];
  let nextLiabilities = [...liabilities];
  const idMap = {}; // Plaid account_id -> app aId ("liab:<id>" for credit cards)

  plaidAccounts.forEach(pa => {
    const isCredit = pa.type === "credit" || pa.credit_limit != null;
    if (isCredit) {
      const i = nextLiabilities.findIndex(l => l.plaidAccountId === pa.account_id);
      if (i === -1) {
        const row = {
          id: uid(), plaidAccountId: pa.account_id, name: pa.name, type: "credit_card",
          originalAmt: pa.credit_limit || 0, currentBal: Math.abs(pa.current_balance || 0),
          rate: 0, termMonths: 0, monthsPaid: 0, monthlyPayment: 0,
          notes: "Synced via Plaid", homeValue: 0, homeAppreciation: 0, zipCode: "",
        };
        nextLiabilities.push(row);
        idMap[pa.account_id] = liabIdOf(row.id);
      } else {
        const row = { ...nextLiabilities[i], currentBal: Math.abs(pa.current_balance || 0), originalAmt: pa.credit_limit || nextLiabilities[i].originalAmt };
        nextLiabilities[i] = row;
        idMap[pa.account_id] = liabIdOf(row.id);
      }
    } else {
      const i = nextAccounts.findIndex(a => a.plaidAccountId === pa.account_id);
      if (i === -1) {
        const row = { id: uid(), plaidAccountId: pa.account_id, name: pa.name, type: pa.subtype || "checking", balance: pa.current_balance || 0, owner: "" };
        nextAccounts.push(row);
        idMap[pa.account_id] = row.id;
      } else {
        const row = { ...nextAccounts[i], balance: pa.current_balance || 0 };
        nextAccounts[i] = row;
        idMap[pa.account_id] = row.id;
      }
    }
  });
  return { nextAccounts, nextLiabilities, idMap };
}

function mergePlaidTransactions(plaidTxns, idMap, existingTxns, customRules = []) {
  const alreadyImported = new Set(existingTxns.filter(t => t.plaidTxnId).map(t => t.plaidTxnId));
  const imported = [];
  plaidTxns.forEach(pt => {
    if (alreadyImported.has(pt.transaction_id)) return;
    if (isPlaidTransferCategory(pt.category_primary)) return;
    const aId = idMap[pt.account_id];
    if (!aId) return; // account not part of this sync batch
    const merchant = (pt.merchant_name || "").toLowerCase();
    // A user-defined Rule (see RulesModal) overrides the built-in Plaid
    // category mapping whenever the merchant name matches — rules are
    // meant to correct or personalize categorization, so they should win.
    const matchedRule = merchant && customRules.find(r => merchant.includes(r.matchText.toLowerCase()));
    imported.push({
      id: uid(), plaidTxnId: pt.transaction_id, aId,
      cat: matchedRule ? matchedRule.cat : mapPlaidCategory(pt.category_primary, pt.category_detailed), catNote: "",
      desc: pt.merchant_name || pt.category_detailed || "Plaid Transaction",
      amt: -pt.amount, date: pt.date, rec: false, synced: true,
    });
  });
  return imported;
}

// ── LINKED ACCOUNTS — GET /api/accounts/{user} (checking, savings, credit, loans) ─
// credit_limit is only non-null for credit-card accounts (Plaid's own
// convention), which is how this decides whether to show a utilization bar.
// The "Sync Transactions" button also pulls /api/transactions and merges
// both into the app's own accounts/liabilities/txns state (see helpers above).
function LinkedAccountsCard({ accounts, setAccounts, liabilities, setLiabilities, txns, setTxns, customRules }) {
  const [state, setState] = useState({ status: API_BASE ? "loading" : "off", accounts: [] });
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const fetchAccounts = () => {
    if (!API_BASE) return;
    apiGet("/api/accounts/demo-user")
      .then(list => setState({ status: "ok", accounts: list || [] }))
      .catch(() => setState({ status: "error", accounts: [] }));
  };

  useEffect(fetchAccounts, []);

  async function syncNow() {
    if (!API_BASE || syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const plaidAccounts = await apiGet("/api/accounts/demo-user") || [];
      const { nextAccounts, nextLiabilities, idMap } = upsertPlaidAccounts(plaidAccounts, accounts, liabilities);

      const plaidTxns = await apiGet("/api/transactions/demo-user?limit=1000") || [];
      const imported = mergePlaidTransactions(plaidTxns, idMap, txns, customRules);

      setAccounts(nextAccounts);
      setLiabilities(nextLiabilities);
      if (imported.length > 0) setTxns(p => [...imported, ...p]);
      setState({ status: "ok", accounts: plaidAccounts });
      setSyncMsg(`Synced ${plaidAccounts.length} account${plaidAccounts.length === 1 ? "" : "s"} · imported ${imported.length} new transaction${imported.length === 1 ? "" : "s"}.`);
    } catch {
      setSyncMsg("Sync failed — check the backend connection.");
    } finally {
      setSyncing(false);
    }
  }

  if (state.status === "off") return null;
  if (state.status === "loading") return <div style={{ ...CS.card, marginBottom: "16px", fontSize: "11px", color: T.sub }}>Loading linked accounts…</div>;
  if (state.status === "error") return <div style={{ ...CS.card, marginBottom: "16px", fontSize: "11px", color: T.red }}>Couldn't load linked accounts from the sync backend.</div>;
  if (state.accounts.length === 0) return null; // nothing linked yet — BankSyncCard above covers that empty state

  return (
    <div style={{ ...CS.card, marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "8px" }}>
        <div style={CS.sec}>Linked Accounts (via Plaid)</div>
        <button style={btn(T.teal, "#001410")} onClick={syncNow} disabled={syncing}>{syncing ? "Syncing…" : "🔄 Sync Transactions"}</button>
      </div>
      {syncMsg && <div style={{ fontSize: "10px", color: T.sub, marginBottom: "10px" }}>{syncMsg}</div>}
      {state.accounts.map(a => {
        const isCredit = a.type === "credit" || a.credit_limit != null;
        const util = isCredit && a.credit_limit ? Math.min(100, Math.round((Math.max(a.current_balance || 0, 0) / a.credit_limit) * 100)) : null;
        return (
          <div key={a.account_id} style={{ padding: "10px 0", borderBottom: `1px solid ${T.s1}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
              <div>
                <div style={{ fontSize: "12px", fontWeight: "700" }}>{a.name}{a.mask ? ` ····${a.mask}` : ""}</div>
                <div style={{ fontSize: "9px", color: T.sub, textTransform: "capitalize" }}>{a.subtype || a.type}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "13px", fontWeight: "800", color: isCredit ? T.red : T.green }}>
                  {isCredit ? "-" : ""}{fmt(Math.abs(a.current_balance || 0))}
                </div>
                {isCredit && a.credit_limit != null && <div style={{ fontSize: "9px", color: T.sub }}>of {fmt(a.credit_limit)} limit</div>}
              </div>
            </div>
            {util != null && (
              <div style={{ height: "5px", borderRadius: "3px", background: T.s1, overflow: "hidden", marginTop: "6px" }}>
                <div style={{ height: "100%", width: `${util}%`, borderRadius: "3px", background: util > 70 ? T.red : util > 30 ? T.gold : T.green }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── TRANSFER MONEY — Plaid Transfer product ─────────────────────────────────
// Sequence is fixed by Plaid: authorize first (their real-time risk/NSF
// check), then create using the authorization_id it returns. This UI walks
// the user through exactly those two steps rather than hiding them behind
// one button, since a declined authorization is a normal, expected outcome
// (insufficient funds, risk flags) that the person needs to see, not an
// error to swallow.
function TransferCard() {
  const [accountsState, setAccountsState] = useState({ status: API_BASE ? "loading" : "off", accounts: [] });
  const [open, setOpen] = useState(false);
  const blankForm = { accountId: "", type: "credit", amount: "", legalName: "", description: "Transfer" };
  const [form, setForm] = useState(blankForm);
  const [status, setStatus] = useState("idle"); // idle | authorizing | authorized | creating | done | error
  const [message, setMessage] = useState(null);
  const [authId, setAuthId] = useState(null);
  const [capabilities, setCapabilities] = useState(null);

  useEffect(() => {
    if (!API_BASE) return;
    apiGet("/api/accounts/demo-user")
      .then(list => setAccountsState({ status: "ok", accounts: list || [] }))
      .catch(() => setAccountsState({ status: "error", accounts: [] }));
  }, []);

  async function checkCapabilities(accountId, type) {
    setCapabilities(null);
    if (!accountId) return;
    try {
      const d = await apiGet(`/api/transfer/capabilities/${encodeURIComponent(accountId)}?transfer_type=${type}&network=ach`);
      setCapabilities(d);
    } catch {
      setCapabilities({ error: true });
    }
  }

  function reset() {
    setForm(blankForm); setStatus("idle"); setMessage(null); setAuthId(null); setCapabilities(null);
  }

  async function authorize() {
    setStatus("authorizing"); setMessage(null);
    try {
      const amt = parseFloat(form.amount || "0").toFixed(2);
      const d = await apiPost("/api/transfer/authorize", {
        user_id: "demo-user", account_id: form.accountId, type: form.type,
        amount: amt, legal_name: form.legalName,
      });
      if (d.decision !== "approved") {
        setStatus("error");
        setMessage(`Not approved (${d.decision}).${d.decision_rationale?.description ? " " + d.decision_rationale.description : ""}`);
        return;
      }
      setAuthId(d.authorization_id);
      setStatus("authorized");
      setMessage("Authorized — review and send below.");
    } catch {
      setStatus("error");
      setMessage("Authorization request failed — check the backend connection.");
    }
  }

  async function createTransfer() {
    setStatus("creating");
    try {
      const amt = parseFloat(form.amount || "0").toFixed(2);
      const d = await apiPost("/api/transfer/create", {
        user_id: "demo-user", account_id: form.accountId, authorization_id: authId,
        amount: amt, description: (form.description || "Transfer").slice(0, 10),
        type: form.type,
      });
      setStatus("done");
      setMessage(`Transfer ${d.status} — ID ${d.transfer_id.slice(0, 8)}…`);
    } catch {
      setStatus("error");
      setMessage("Transfer could not be created.");
    }
  }

  if (accountsState.status === "off" || accountsState.status === "loading") return null;
  if (accountsState.accounts.length === 0) return null; // nothing linked to transfer to/from yet

  return (
    <div style={{ ...CS.card, marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <div style={CS.sec}>Transfer Money (via Plaid)</div>
        <button style={btn(T.s3)} onClick={() => { setOpen(o => !o); if (open) reset(); }}>{open ? "Close" : "New Transfer"}</button>
      </div>

      {open && (
        <div style={{ marginTop: "12px" }}>
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <button style={{ ...stab(form.type === "credit"), flex: 1 }} onClick={() => { setForm(f => ({ ...f, type: "credit" })); checkCapabilities(form.accountId, "credit"); }}>⬇ Transfer In</button>
            <button style={{ ...stab(form.type === "debit"), flex: 1 }} onClick={() => { setForm(f => ({ ...f, type: "debit" })); checkCapabilities(form.accountId, "debit"); }}>⬆ Transfer Out</button>
          </div>
          <div style={{ fontSize: "10px", color: T.sub, marginBottom: "10px" }}>
            {form.type === "credit" ? "Money moves FROM Mindful Money Management's ledger INTO the selected account." : "Money moves FROM the selected account INTO Mindful Money Management's ledger."}
          </div>

          <select style={{ ...CS.inp, marginBottom: "8px" }} value={form.accountId}
            onChange={e => { setForm(f => ({ ...f, accountId: e.target.value })); checkCapabilities(e.target.value, form.type); }}>
            <option value="">Select linked account…</option>
            {accountsState.accounts.map(a => <option key={a.account_id} value={a.account_id}>{a.name}{a.mask ? ` ····${a.mask}` : ""}</option>)}
          </select>
          {capabilities && !capabilities.error && (
            <div style={{ fontSize: "9px", color: T.sub, marginBottom: "8px" }}>Rails available on this account: {JSON.stringify(capabilities).length < 200 ? JSON.stringify(capabilities) : "checked ✓"}</div>
          )}

          <input style={{ ...CS.inp, marginBottom: "8px" }} type="number" placeholder="Amount ($)" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          <input style={{ ...CS.inp, marginBottom: "8px" }} placeholder="Account holder legal name" value={form.legalName} onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))} />
          <input style={{ ...CS.inp, marginBottom: "10px" }} placeholder="Description (10 char max)" maxLength={10} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />

          {message && <div style={{ fontSize: "11px", color: status === "error" ? T.red : T.green, marginBottom: "10px" }}>{message}</div>}

          <div style={{ display: "flex", gap: "8px" }}>
            <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} disabled={status === "authorizing" || status === "authorized" || status === "done" || !form.accountId || !form.amount || !form.legalName} onClick={authorize}>
              {status === "authorizing" ? "Authorizing…" : "1. Authorize"}
            </button>
            <button style={{ ...btn(T.green, "#000"), flex: 1 }} disabled={status !== "authorized" && status !== "creating"} onClick={createTransfer}>
              {status === "creating" ? "Sending…" : "2. Send Transfer"}
            </button>
          </div>
          {status === "done" && <button style={{ ...btn(T.s3), width: "100%", marginTop: "8px" }} onClick={reset}>Start Another Transfer</button>}
        </div>
      )}
    </div>
  );
}

function MonthlyIncomeCard({ holdings, confirmed }) {
  const [mode, setMode] = useState("FWD"); // TTM | FWD
  const [showDetails, setShowDetails] = useState(false);
  const now = new Date();
  const series = useMemo(() => buildMonthlyIncomeSeries(holdings, now, mode, confirmed.byMonth), [holdings, mode, confirmed.byMonth]);
  const total = series.reduce((s, m) => s + m.received + m.declared + m.estRegular + m.estIrregular, 0);
  const anyConfirmed = series.some(m => m.confirmed);

  return (
    <div style={{ ...CS.card, marginBottom: "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={CS.sec}>Monthly Income, $</div>
          {anyConfirmed && <span style={{ fontSize: "9px", padding: "2px 7px", borderRadius: "20px", background: `${T.green}22`, color: T.green, fontWeight: "700", marginBottom: "12px" }}>✓ Plaid-confirmed months included</span>}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button style={stab(mode === "TTM")} onClick={() => setMode("TTM")}>TTM</button>
          <button style={stab(mode === "FWD")} onClick={() => setMode("FWD")}>FWD</button>
        </div>
      </div>
      <div style={{ fontSize: "12px", color: T.sub, marginBottom: "8px" }}>12-Month Total: ~{fmt(total)}</div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={series} margin={{ bottom: 30 }}>
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 9 }} interval={0} angle={-45} textAnchor="end" height={50} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 10 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v} />
          <Tooltip content={<CTip />} />
          <Legend wrapperStyle={{ fontSize: "10px", color: T.sub }} />
          <Bar dataKey="received" name="Received" stackId="inc" radius={[0, 0, 0, 0]}>
            {series.map((m, i) => <Cell key={i} fill={m.confirmed ? T.green : T.teal} />)}
          </Bar>
          <Bar dataKey="declared" name="Declared" stackId="inc" fill={`${T.cyan}77`} />
          <Bar dataKey="estRegular" name="Est. Regular" stackId="inc" fill={T.s3} radius={[3, 3, 0, 0]} />
          <Bar dataKey="estIrregular" name="Est. Irregular" stackId="inc" fill={T.red} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button style={{ background: "none", border: "none", color: T.blue, fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "inherit" }} onClick={() => setShowDetails(true)}>Details →</button>
      </div>
      {showDetails && <MonthlyIncomeDetailsModal series={series} mode={mode} confirmedList={confirmed.list} onClose={() => setShowDetails(false)} />}
    </div>
  );
}

function MonthlyIncomeDetailsModal({ series, mode, confirmedList, onClose }) {
  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "480px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "16px", marginBottom: "4px" }}>Monthly Income Detail ({mode})</div>
        <div style={{ fontSize: "10px", color: T.sub, marginBottom: "14px" }}>Rows marked <span style={{ color: T.green }}>✓</span> are confirmed dividend transactions from a linked brokerage account (via Plaid); the rest are estimated from each holding's pay calendar.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 62px)", gap: "4px", fontSize: "9px", color: T.sub, fontWeight: "700", textTransform: "uppercase", paddingBottom: "6px", borderBottom: `1px solid ${T.border}` }}>
          <div>Month</div><div style={{ textAlign: "right" }}>Recv.</div><div style={{ textAlign: "right" }}>Decl.</div><div style={{ textAlign: "right" }}>Est.</div><div style={{ textAlign: "right" }}>Total</div>
        </div>
        {series.map((m, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr repeat(4, 62px)", gap: "4px", fontSize: "11px", padding: "6px 0", borderBottom: `1px solid ${T.s1}` }}>
            <div>{m.label}{m.confirmed && <span style={{ color: T.green }}> ✓</span>}</div>
            <div style={{ textAlign: "right", color: m.confirmed ? T.green : T.teal }}>{m.received ? fmt(m.received) : "—"}</div>
            <div style={{ textAlign: "right", color: T.cyan }}>{m.declared ? fmt(m.declared) : "—"}</div>
            <div style={{ textAlign: "right", color: T.sub }}>{m.estRegular ? fmt(m.estRegular) : "—"}</div>
            <div style={{ textAlign: "right", fontWeight: "700" }}>{fmt(m.received + m.declared + m.estRegular + m.estIrregular)}</div>
          </div>
        ))}

        {confirmedList && confirmedList.length > 0 && (
          <div style={{ marginTop: "18px" }}>
            <div style={{ fontSize: "10px", color: T.sub, letterSpacing: "1px", textTransform: "uppercase", fontWeight: "700", marginBottom: "8px" }}>Recent Confirmed Transactions</div>
            {confirmedList.slice(0, 6).map((d, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", padding: "4px 0", borderBottom: `1px solid ${T.s1}` }}>
                <span style={{ color: T.sub }}>{d.date} · {d.ticker || "—"}{d.subtype === "dividend reinvestment" ? " (DRIP)" : ""}</span>
                <span style={{ fontWeight: "700", color: T.green }}>{fmtD(d.amount)}</span>
              </div>
            ))}
          </div>
        )}

        <button style={{ ...btn(T.s3), width: "100%", marginTop: "16px" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function YearlyIncomeCard({ holdings, confirmed }) {
  const [mode, setMode] = useState("FWD"); // BWD | FWD
  const [showDetails, setShowDetails] = useState(false);
  const now = new Date();
  const series = useMemo(() => buildYearlyIncomeSeries(holdings, now, mode, confirmed.byYear), [holdings, mode, confirmed.byYear]);

  return (
    <div style={CS.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "8px" }}>
        <div style={CS.sec}>Yearly Income, $</div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button style={stab(mode === "BWD")} onClick={() => setMode("BWD")}>BWD</button>
          <button style={stab(mode === "FWD")} onClick={() => setMode("FWD")}>FWD</button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={series}>
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 10 }} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 10 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
          <Tooltip content={<CTip />} />
          <Bar dataKey="total" name="Total" radius={[4, 4, 0, 0]}>
            {series.map((y, i) => <Cell key={i} fill={y.confirmed ? T.green : T.s3} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button style={{ background: "none", border: "none", color: T.blue, fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "inherit" }} onClick={() => setShowDetails(true)}>Details →</button>
      </div>
      {showDetails && <YearlyIncomeDetailsModal series={series} mode={mode} onClose={() => setShowDetails(false)} />}
    </div>
  );
}

function YearlyIncomeDetailsModal({ series, mode, onClose }) {
  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "380px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "16px", marginBottom: "4px" }}>Yearly Income Detail ({mode})</div>
        <div style={{ fontSize: "10px", color: T.sub, marginBottom: "14px" }}>Years marked <span style={{ color: T.green }}>✓</span> use confirmed dividend totals from a linked brokerage account; others are modeled from each holding's current dividend growth rate, compounded from today.</div>
        {series.map((y, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "7px 0", borderBottom: `1px solid ${T.s1}` }}>
            <span>{y.label}{y.confirmed && <span style={{ color: T.green }}> ✓</span>}</span><span style={{ fontWeight: "700", color: y.confirmed ? T.green : T.text }}>{fmt(y.total)}</span>
          </div>
        ))}
        <button style={{ ...btn(T.s3), width: "100%", marginTop: "16px" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── PASSIVE INCOME GOAL — Year/Month/Week/Day toggle, persisted via window.storage ─
function PassiveIncomeGoalCard({ totalAnnual }) {
  const PERIODS_G = ["Year", "Month", "Week", "Day"];
  const DIVISORS = { Year: 1, Month: 12, Week: 52, Day: 365 };
  const defaultGoals = useMemo(() => {
    const yearGoal = Math.max(1000, Math.ceil((totalAnnual * 1.1) / 1000) * 1000);
    return { Year: yearGoal, Month: Math.round(yearGoal / 12), Week: Math.round(yearGoal / 52), Day: Math.round(yearGoal / 365) };
  }, [totalAnnual]);

  const [period, setPeriod] = useState("Month");
  const [goals, setGoals] = useState(defaultGoals);
  const [customized, setCustomized] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");

  useEffect(() => {
    if (!window.storage) return;
    window.storage.get("dividendIncomeGoal", false)
      .then(r => { if (r && r.value) { setGoals(JSON.parse(r.value)); setCustomized(true); } })
      .catch(() => {}); // no saved goal yet — defaults stand
  }, []);

  async function saveGoal() {
    const v = parseFloat(editVal);
    if (!v || v <= 0) { setEditing(false); return; }
    const next = { ...(customized ? goals : defaultGoals), [period]: v };
    setGoals(next);
    setCustomized(true);
    setEditing(false);
    if (window.storage) {
      try { await window.storage.set("dividendIncomeGoal", JSON.stringify(next), false); } catch {}
    }
  }

  const activeGoals = customized ? goals : defaultGoals;
  const actual = totalAnnual / DIVISORS[period];
  const goal = activeGoals[period];
  const pct = goal > 0 ? Math.min(100, Math.round((actual / goal) * 100)) : 0;

  return (
    <div style={CS.card}>
      <div style={CS.sec}>Passive Income Goal, $</div>
      <div style={{ display: "flex", gap: "4px", margin: "8px 0 14px" }}>
        {PERIODS_G.map(p => (
          <button key={p} onClick={() => { setPeriod(p); setEditing(false); }} style={{ ...stab(period === p), flex: 1, textAlign: "center" }}>{p}</button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", justifyContent: "center" }}>
        <span style={{ fontSize: "26px", fontWeight: "800" }}>{fmt(actual)}</span>
        <span style={{ fontSize: "15px", color: T.sub }}>/ {fmt(goal)}</span>
      </div>
      <div style={{ textAlign: "center", fontSize: "10px", color: T.sub, marginBottom: "12px" }}>{period.toLowerCase()}ly average</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: T.sub, marginBottom: "4px" }}>
        <span>Goal Progress</span><span style={{ color: T.text, fontWeight: "700" }}>{pct}%</span>
      </div>
      <div style={{ height: "8px", borderRadius: "4px", background: T.s1, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: T.teal, borderRadius: "4px", transition: "width .3s" }} />
      </div>
      {editing ? (
        <div style={{ display: "flex", gap: "6px", marginTop: "14px" }}>
          <input style={{ ...CS.inp, flex: 1 }} type="number" value={editVal} onChange={e => setEditVal(e.target.value)} placeholder={`${period} goal`} autoFocus />
          <button style={btn(T.blue, "#fff")} onClick={saveGoal}>Save</button>
        </div>
      ) : (
        <div style={{ textAlign: "right", marginTop: "10px" }}>
          <button style={{ background: "none", border: "none", color: T.blue, fontSize: "12px", fontWeight: "700", cursor: "pointer", fontFamily: "inherit" }} onClick={() => { setEditVal(String(goal)); setEditing(true); }}>Set Goal →</button>
        </div>
      )}
    </div>
  );
}

// ── RECEIVED INCOME — MTD/YTD toggle, confirmed data overrides the estimate ─
function ReceivedIncomeCard({ holdings, confirmed }) {
  const [mode, setMode] = useState("YTD"); // MTD | YTD
  const now = new Date();
  const { received, estTotal } = useMemo(() => receivedForPeriod(holdings, now, mode, confirmed.byMonth), [holdings, mode, confirmed.byMonth, now.getDate()]);
  const label = mode === "YTD" ? `Year of ${now.getFullYear()}, Est.` : `${MO[now.getMonth()]} ${now.getFullYear()}, Est.`;

  return (
    <div style={CS.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={CS.sec}>Received Income, $</div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button style={stab(mode === "MTD")} onClick={() => setMode("MTD")}>MTD</button>
          <button style={stab(mode === "YTD")} onClick={() => setMode("YTD")}>YTD</button>
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: "24px", fontWeight: "800", color: T.green }}>{fmt(received)}</span>
        <span style={{ fontSize: "15px", color: T.sub }}> / {fmt(estTotal)}</span>
      </div>
      <div style={{ textAlign: "center", fontSize: "10px", color: T.sub, marginTop: "4px" }}>{label}</div>
    </div>
  );
}

// ── UPCOMING EX-DIVIDEND DATES — horizontal-scroll strip ───────────────────
function UpcomingExDatesStrip({ holdings }) {
  const now = new Date();
  const events = useMemo(() => upcomingExDates(holdings, now, 8), [holdings]);
  if (events.length === 0) return null;
  return (
    <div style={{ ...CS.card, marginBottom: "18px" }}>
      <div style={CS.sec}>Upcoming Ex-Dividend Dates</div>
      <div style={{ display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "4px" }}>
        {events.map((e, i) => (
          <div key={i} style={{ minWidth: "210px", flexShrink: 0, borderRadius: "10px", padding: "12px 14px", background: i % 2 === 0 ? T.gold : T.s3, color: i % 2 === 0 ? "#241a00" : T.text, display: "flex", gap: "12px", alignItems: "center" }}>
            <div style={{ textAlign: "center", minWidth: "36px" }}>
              <div style={{ fontSize: "16px", fontWeight: "800" }}>{e.date.getDate()}</div>
              <div style={{ fontSize: "9px", fontWeight: "700", opacity: 0.8 }}>{MO[e.date.getMonth()].toUpperCase()}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "10px", fontWeight: "700", opacity: 0.85, textTransform: "uppercase" }}>Ex-Date · {e.ticker}</div>
              <div style={{ fontSize: "9px", opacity: 0.75 }}>Payout ~{fmtMD(e.payout)}</div>
            </div>
            <div style={{ fontWeight: "800", fontSize: "13px" }}>{fmtD(e.amount)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PORTFOLIO INCOME DASHBOARD — outer/aggregate view, wraps the cards above ─
// Fetches confirmed dividends once here and passes the same lookup maps down
// to every card, so Monthly, Yearly, and Received Income all reflect the
// same merged (estimate + confirmed) picture instead of each computing its
// own version.
function IncomeDashboard({ holdings, totalAnnual }) {
  const confirmed = useConfirmedDividends();
  return (
    <div>
      <MonthlyIncomeCard holdings={holdings} confirmed={confirmed} />
      <div style={CS.g2}>
        <YearlyIncomeCard holdings={holdings} confirmed={confirmed} />
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <PassiveIncomeGoalCard totalAnnual={totalAnnual} />
          <ReceivedIncomeCard holdings={holdings} confirmed={confirmed} />
        </div>
      </div>
      <UpcomingExDatesStrip holdings={holdings} />
    </div>
  );
}


// ── SMALL COMPONENTS ──────────────────────────────────────────────────────────
function Tag({ cat }) {
  const c = gc(cat);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", padding: "2px 8px", borderRadius: "20px", fontSize: "10px", fontWeight: "700", background: c.c + "28", color: c.c, whiteSpace: "nowrap" }}>
      {c.i} {c.l}
    </span>
  );
}
function CTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: T.s3, border: `1px solid ${T.border}`, borderRadius: "10px", padding: "9px 13px" }}>
      <div style={{ color: T.sub, fontSize: "10px", marginBottom: "2px" }}>{payload[0].name}</div>
      <div style={{ color: T.text, fontWeight: "800", fontSize: "14px" }}>{fmt(payload[0].value)}</div>
    </div>
  );
}
function PctLbl({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.06) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * Math.PI / 180);
  const y = cy + r * Math.sin(-midAngle * Math.PI / 180);
  return <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" style={{ fontSize: "10px", fontWeight: "800" }}>{(percent * 100).toFixed(0)}%</text>;
}
function Ring({ pct, size, stroke, color }) {
  const sz = size || 76, st = stroke || 6, co = color || T.green;
  const r = (sz - st) / 2, circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  return (
    <div style={{ position: "relative", width: sz, height: sz, flexShrink: 0 }}>
      <svg width={sz} height={sz} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke={T.border} strokeWidth={st} />
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke={co} strokeWidth={st} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: "12px", fontWeight: "900", color: co }}>{Math.min(Math.round(pct), 999)}%</span>
      </div>
    </div>
  );
}
function PBar({ value, max, color, h }) {
  const height = h || 5;
  const pct = Math.min((value / Math.max(max, 1)) * 100, 100);
  return (
    <div style={{ width: "100%", height: height, borderRadius: 3, background: T.border, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
    </div>
  );
}
function Empty({ icon, text, action }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 16px", color: T.sub }}>
      <div style={{ fontSize: "26px", marginBottom: "8px", opacity: 0.7 }}>{icon}</div>
      <div style={{ fontSize: "12px", lineHeight: "1.6", maxWidth: "260px", margin: "0 auto" }}>{text}</div>
      {action && <div style={{ fontSize: "11px", color: T.blue, marginTop: "8px", fontWeight: "700" }}>{action}</div>}
    </div>
  );
}
function AiBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: "7px", padding: "8px 16px", borderRadius: "10px", border: `1px solid ${T.blue}44`, background: `${T.blue}18`, color: T.blue, fontFamily: "inherit", fontWeight: "700", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap" }}>
      ✦ AI Insights
    </button>
  );
}

// ── DATA COMPLETENESS SCORING ──────────────────────────────────────────────────
// A brand-new profile should not score well just because there's nothing to
// penalize. This function measures how much of the picture the user has
// actually filled in, and the health score gets scaled down when it's low.
// As real data comes in (accounts, liabilities, insurance, goals), the
// multiplier rises toward 1.0 — the score becomes "unlocked" gradually.
function computeCompleteness({ profile, accounts, recurring, liabilities, goals, insurance }) {
  const ins = {
    termLife:   insurance?.termLife   || {},
    wholeLife:  insurance?.wholeLife  || {},
    disability: insurance?.disability || {},
  };
  const allThreeAnswered = !!(ins.termLife.answered && ins.wholeLife.answered && ins.disability.answered);
  // An AI-analyzed document upload is itself meaningful evidence the user
  // engaged with the insurance question, even if the other two categories
  // haven't been manually answered yet — so it counts toward completeness
  // on its own, rather than requiring all three to be answered first.
  const hasDocAnalysis = !!(insurance && insurance.docAnalysis);
  const checks = [
    { key: "profile",     done: !!(profile.firstName && profile.payFrequency && profile.takeHomePerPeriod), weight: 15 },
    { key: "income",      done: recurring.some(r => r.type === "income" && r.active),                        weight: 20 },
    { key: "expenses",    done: recurring.filter(r => r.type === "expense" && r.active).length >= 2,          weight: 15 },
    { key: "accounts",    done: accounts.length >= 1,                                                          weight: 15 },
    { key: "liabilities", done: true, weight: 5 }, // absence of debt is valid data, not missing data
    { key: "goals",       done: goals.monthlyInvest > 0 || goals.monthlySavings > 0,                          weight: 10 },
    { key: "retirement",  done: accounts.some(a => a.type === "retirement" || a.type === "investment"),       weight: 10 },
    { key: "insurance",   done: allThreeAnswered || hasDocAnalysis,  weight: 10 },
  ];
  const earned = checks.reduce((s, c) => s + (c.done ? c.weight : 0), 0);
  const total  = checks.reduce((s, c) => s + c.weight, 0);
  const pct    = earned / total; // 0..1
  return {
    pct,
    checks,
    // Floor of 0.35 so the score is never *zero* (discouraging), but a
    // fully-empty profile is capped well below a real, complete one.
    multiplier: 0.35 + pct * 0.65,
    missing: checks.filter(c => !c.done).map(c => c.key),
  };
}

// ── MONTHLY SUMMARY ────────────────────────────────────────────────────────────
// Compares last calendar month's REAL activity (transactions + the recurring
// bills that were active) against the user's goals and category budgets, and
// buckets the findings into three tiers: excelled (comfortably beat target),
// on pace (met target, little room to spare), and could improve (missed
// target). Also produces a short list of forward-looking action items for
// the current month based on what was found. Pure function — no state, no
// hooks — so it's cheap to call from render and easy to unit test.
function buildMonthlySummary({ txns, recurring, goals, retBal, liabilities }) {
  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const key = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const label = `${MO[lastMonthDate.getMonth()]} ${lastMonthDate.getFullYear()}`;

  const monthTxns = txns.filter(t => t.date.slice(0, 7) === key);
  const hasData = monthTxns.length > 0;

  const fixedInc = recurring.filter(r => r.active && r.type === "income").reduce((s, r) => s + r.amt, 0);
  const fixedExp = recurring.filter(r => r.active && r.type === "expense").reduce((s, r) => s + r.amt, 0);
  const extraInc = monthTxns.filter(t => t.amt > 0 && !t.rec).reduce((s, t) => s + t.amt, 0);
  const extraExp = monthTxns.filter(t => t.amt < 0 && !t.rec).reduce((s, t) => s + Math.abs(t.amt), 0);
  const monthInc = fixedInc + extraInc;
  const monthExp = fixedExp + extraExp;
  const monthCash = monthInc - monthExp;
  const monthSavRate = monthInc > 0 ? (monthCash / monthInc) * 100 : 0;

  const catSpend = {};
  monthTxns.filter(t => t.amt < 0).forEach(t => { catSpend[t.cat] = (catSpend[t.cat] || 0) + Math.abs(t.amt); });

  const totalMonthlyDebt = liabilities.reduce((s, l) => s + l.monthlyPayment, 0);
  const dti = monthInc > 0 ? (totalMonthlyDebt / monthInc) * 100 : 0;

  const excelled = [], onPace = [], improve = [];

  // Savings rate vs goal
  if (monthInc > 0) {
    const gap = monthSavRate - goals.savingsRatePct;
    if (gap >= 5) excelled.push({ icon: "🎯", text: `Savings rate hit ${monthSavRate.toFixed(1)}% — ${gap.toFixed(1)} points above your ${goals.savingsRatePct}% goal.` });
    else if (gap >= 0) onPace.push({ icon: "✓", text: `Savings rate was ${monthSavRate.toFixed(1)}%, right at your ${goals.savingsRatePct}% goal.` });
    else improve.push({ icon: "📉", text: `Savings rate was ${monthSavRate.toFixed(1)}%, ${Math.abs(gap).toFixed(1)} points short of your ${goals.savingsRatePct}% goal.` });
  }

  // Monthly savings dollar target
  if (goals.monthlySavings > 0) {
    const gap = monthCash - goals.monthlySavings;
    if (gap >= goals.monthlySavings * 0.25) excelled.push({ icon: "💰", text: `Saved ${fmt(monthCash)}, beating your ${fmt(goals.monthlySavings)} target by ${fmt(gap)}.` });
    else if (gap >= 0) onPace.push({ icon: "✓", text: `Saved ${fmt(monthCash)}, meeting your ${fmt(goals.monthlySavings)} monthly target.` });
    else improve.push({ icon: "💸", text: `Saved ${fmt(Math.max(0, monthCash))}, short of your ${fmt(goals.monthlySavings)} target by ${fmt(Math.abs(gap))}.` });
  }

  // Category budgets
  Object.entries(goals.categoryBudgets || {}).forEach(([catId, budget]) => {
    if (!budget || budget <= 0) return;
    const spent = catSpend[catId] || 0;
    const cat = gc(catId);
    const pct = (spent / budget) * 100;
    if (spent === 0) return; // no activity in this category — not a finding either way
    if (pct <= 80) excelled.push({ icon: cat.i, text: `${cat.l} spending was ${fmt(spent)}, well under your ${fmt(budget)} budget.` });
    else if (pct <= 100) onPace.push({ icon: cat.i, text: `${cat.l} spending was ${fmt(spent)}, within your ${fmt(budget)} budget.` });
    else improve.push({ icon: cat.i, text: `${cat.l} spending was ${fmt(spent)}, ${fmt(spent - budget)} over your ${fmt(budget)} budget.` });
  });

  // DTI
  if (monthInc > 0 && totalMonthlyDebt > 0) {
    if (dti < 20) excelled.push({ icon: "🏦", text: `Debt payments were only ${dti.toFixed(0)}% of income — well under the 36% healthy threshold.` });
    else if (dti < 36) onPace.push({ icon: "✓", text: `Debt-to-income was ${dti.toFixed(0)}%, within the healthy range.` });
    else improve.push({ icon: "⚠️", text: `Debt-to-income was ${dti.toFixed(0)}%, above the 36% healthy threshold.` });
  }

  // This month's action items — derived from what was actually found, most
  // urgent first: address a real shortfall, then reinforce what's working.
  const actions = [];
  if (improve.length > 0) {
    const worst = improve[0];
    actions.push(`Focus first on ${worst.text.charAt(0).toLowerCase()}${worst.text.slice(1).replace(/\.$/, "")} — this was the biggest gap last month.`);
  }
  if (goals.monthlyInvest > 0 && retBal >= 0) {
    actions.push(`Keep contributing ${fmt(goals.monthlyInvest)}/month toward retirement — consistency compounds.`);
  }
  if (excelled.length > 0) {
    actions.push(`Keep doing what worked: ${excelled[0].text.charAt(0).toLowerCase()}${excelled[0].text.slice(1).replace(/\.$/, "")}.`);
  }
  if (actions.length === 0) {
    actions.push("Log a few transactions this month to get a personalized read on how things are going.");
  }

  return { key, label, hasData, monthInc, monthExp, monthCash, monthSavRate, excelled, onPace, improve, actions };
}


// ── GAUGE ARC (module-scope so React doesn't remount on every render) ─────────
function GaugeArc({ score: sc, max = 900, size = 280 }) {
  // Full 360° ring. The fill is capped so a perfect score (sc === max) only
  // reaches ~95% of the way around — a sliver always stays open, so the ring
  // never visually reads as "done" even at the highest possible score.
  const FILL_CAP = 0.95;
  const rawPct = Math.max(0, Math.min(1, sc / max));
  const pct = rawPct * FILL_CAP;

  const cx = size / 2, cy = size / 2, r = size * 0.42;
  const sw = size * 0.09;
  // Start at the top (12 o'clock) and sweep clockwise.
  const startAngle = -Math.PI / 2;
  const totalArc = Math.PI * 2;
  const fillAngle = startAngle + pct * totalArc;
  const point = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = point(startAngle);
  const [x2, y2] = point(fillAngle);
  const largeArc = pct > 0.5 ? 1 : 0;

  const stops = [
    { offset: "0%", color: "#ff3d5c" }, { offset: "25%", color: "#ffa726" },
    { offset: "50%", color: "#f5a623" }, { offset: "70%", color: "#00d4c8" },
    { offset: "100%", color: "#00e8a0" },
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible", maxWidth: "100%" }}>
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          {stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
        </linearGradient>
      </defs>
      {/* Background track — full circle */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={sw} />
      {/* Filled arc — sweeps clockwise from the top, capped below 360° */}
      {pct > 0.003 && (
        pct >= 0.999
          ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#gaugeGrad)" strokeWidth={sw} strokeLinecap="round" />
          : <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`} fill="none" stroke="url(#gaugeGrad)" strokeWidth={sw} strokeLinecap="round" />
      )}
    </svg>
  );
}

// ── CATEGORY DATA BUILDER (module-scope — separates insight text from render) ─
function buildCategoryData({ needsPct, housingPct, needsScore, housingScore, needsCatScore, wantsCatScore, wealthCatScore, dtiVal, carPct, dtiScore, carScore, savRate, efMonths, retRatio, retScore, retTarget, retBal, savScore, efScore, mInc, mExp, mCash, annInc, goals, liabilities, insurance, onTrack, yrsLeft, catColor, catGrade, completeness }) {
  const hasIncome = mInc > 0;
  return {
    needs: {
      label: "Needs", icon: "🏠",
      score: needsCatScore, color: catColor(needsCatScore), grade: catGrade(needsCatScore),
      summary: hasIncome
        ? `Your essential spending is ${needsPct.toFixed(0)}% of income (target: ≤50%). Housing is ${housingPct.toFixed(0)}% of take-home (target: ≤33%).`
        : `Add your income and recurring bills to measure this category.`,
      metrics: [
        { label: "Essential Spending %", value: hasIncome ? `${needsPct.toFixed(1)}%` : "—", target: "≤50%", score: needsScore, max: 20, good: needsPct <= 50 },
        { label: "Housing-to-Income %",  value: hasIncome ? `${housingPct.toFixed(1)}%` : "—", target: "≤33%", score: housingScore, max: 15, good: housingPct <= 33.3 },
      ],
      freeInsight: !hasIncome
        ? "Once you add recurring income and expenses, this category will show exactly how your essential spending compares to the 50% guideline."
        : needsPct > 50
        ? `Your essential costs are eating ${needsPct.toFixed(0)}% of income — above the 50% benchmark. Housing at ${housingPct.toFixed(0)}% is the likely driver.`
        : `Your essential costs are well-controlled at ${needsPct.toFixed(0)}% of income. Good headroom for savings and lifestyle spending.`,
      proDetails: [
        { title: "50/30/20 Rule Analysis", icon: "📊", body: hasIncome ? `You are allocating ${needsPct.toFixed(1)}% to needs versus the 50% guideline. ${needsPct > 50 ? `Reducing this by ${(needsPct - 50).toFixed(1)} points would free up ${fmt((needsPct - 50) / 100 * mInc)}/month.` : "You are within guideline — each point below 50% compounds toward wealth."}` : "Add income and expenses to unlock this analysis." },
        { title: "Housing Cost Pressure", icon: "🏡", body: hasIncome ? `At ${housingPct.toFixed(1)}% of take-home, housing ${housingPct > 33 ? `exceeds the 1/3 rule by ${fmt((housingPct - 33.3) / 100 * mInc)}/month.` : "sits within the healthy 1/3 guideline."}` : "Add a mortgage or rent line to unlock this analysis." },
        { title: "Action Steps", icon: "✅", body: needsPct > 50 ? "1. Audit recurring bills for renegotiation. 2. Consider whether housing can be reduced below 33%. 3. Track variable spending for 30 days." : "1. Maintain discipline as income grows. 2. Redirect raises to investments. 3. Review fixed costs annually." },
      ],
    },
    wants: {
      label: "Wants", icon: "🎯",
      score: wantsCatScore, color: catColor(wantsCatScore), grade: catGrade(wantsCatScore),
      summary: liabilities.length > 0
        ? `Debt-to-income is ${dtiVal.toFixed(0)}% (target: <36%). Vehicle costs are ${carPct.toFixed(0)}% of income (target: <10%).`
        : `No liabilities on file. Add any loans or credit cards to measure this accurately.`,
      metrics: [
        { label: "Debt-to-Income Ratio",  value: `${dtiVal.toFixed(1)}%`, target: "<36%", score: dtiScore, max: 10, good: dtiVal < 36 },
        { label: "Vehicle Cost % Income", value: `${carPct.toFixed(1)}%`, target: "<10%", score: carScore, max: 10, good: carPct < 10 },
      ],
      freeInsight: liabilities.length === 0
        ? "You haven't added any liabilities yet. If you have loans, a mortgage, or credit cards, add them for an accurate debt picture."
        : dtiVal > 36
        ? `Your debt-to-income of ${dtiVal.toFixed(0)}% is above the 36% threshold. Pay down highest-rate debt first.`
        : `Your debt load is manageable at ${dtiVal.toFixed(0)}% DTI.`,
      proDetails: [
        { title: "Debt-to-Income Deep Dive", icon: "📉", body: dtiVal >= 43 ? "DTI in the danger zone above 43% — lenders typically won't approve mortgages at this level." : dtiVal >= 36 ? "DTI in the caution zone. This limits productive borrowing capacity." : "DTI is healthy. Maintain below 36%." },
        { title: "The 20-4-10 Car Rule", icon: "🚗", body: carPct > 10 ? `Vehicle costs exceed the 10% guideline by ${fmt((carPct - 10) / 100 * mInc)}/month.` : "Vehicle costs are within the healthy 10% guideline." },
        { title: "Action Steps", icon: "✅", body: dtiVal > 36 ? `1. Attack highest interest debt first. 2. Avoid new debt until DTI is below 36%.` : "1. Continue minimum-plus payments. 2. Apply 20-4-10 to your next vehicle." },
      ],
    },
    wealth: {
      label: "Wealth Building", icon: "📈",
      score: wealthCatScore, color: catColor(wealthCatScore), grade: catGrade(wealthCatScore),
      summary: `Savings rate is ${parseFloat(savRate).toFixed(0)}% (target: ≥20%). Emergency fund covers ~${efMonths.toFixed(1)} months. Retirement ratio: ${(retRatio * 100).toFixed(0)}% of benchmark, with ${yrsLeft} year${yrsLeft !== 1 ? "s" : ""} until your target retirement age of ${goals.retireAge}.`,
      metrics: [
        { label: "Savings Rate",         value: `${parseFloat(savRate).toFixed(1)}%`,      target: "≥20%",          score: savScore, max: 15, good: parseFloat(savRate) >= 20 },
        { label: "Emergency Fund",       value: `${efMonths.toFixed(1)} months`,            target: "3–6 months",    score: efScore,  max: 15, good: efMonths >= 3 },
        { label: "Retirement Benchmark", value: `${(retRatio * 100).toFixed(0)}% of goal`,  target: "100% on track", score: retScore, max: 15, good: retRatio >= 0.8 },
      ],
      freeInsight: (parseFloat(savRate) < 20
        ? `Your savings rate of ${parseFloat(savRate).toFixed(1)}% is below the 20% target.`
        : `Strong savings rate of ${parseFloat(savRate).toFixed(1)}%. Consistency here is your most powerful lever.`)
        + (goals.retireAge !== AVG_RETIREMENT_AGE
            ? ` Your target retirement age of ${goals.retireAge} is ${goals.retireAge < AVG_RETIREMENT_AGE ? `${AVG_RETIREMENT_AGE - goals.retireAge} years earlier` : `${goals.retireAge - AVG_RETIREMENT_AGE} years later`} than the average of ${AVG_RETIREMENT_AGE} — that changes how much you need saved by then.`
            : ` You're targeting ${AVG_RETIREMENT_AGE}, the typical U.S. retirement age.`),
      proDetails: [
        { title: "Emergency Fund Analysis", icon: "🛡️", body: efMonths < 3 ? `Below the 3-month minimum. Priority: build to ${fmt(mExp * 3)} before aggressive investing.` : efMonths < 6 ? "Within 3–6 months. Consider the full 6 if income is volatile." : "Excellent — fully protects your investment strategy." },
        { title: "Retirement Benchmark (By Age)", icon: "🏖️", body: `Target at age ${goals.currentAge}: ${fmt(retTarget)} saved, based on standard age-based savings multiples. You're at ${(retRatio * 100).toFixed(0)}% of this, with ${yrsLeft} year${yrsLeft !== 1 ? "s" : ""} until your target retirement age of ${goals.retireAge}. ${yrsLeft <= 5 && retRatio < 1 ? "With retirement this close, closing this gap is a priority — even modest increases in contributions matter disproportionately now." : yrsLeft <= 15 && retRatio < 1 ? "You still have meaningful runway to close this gap, but the window is narrowing." : retRatio < 1 ? "You have significant time for compounding to help close this gap." : "You're ahead of the standard benchmark for your age."}` },
        { title: "The 4% Rule — Your Number", icon: "💰", body: `To replace 80% of income in retirement you need ${fmt(mInc * 12 * 0.8 * 25)} invested. You are ${onTrack ? "on pace" : "projected to fall short"}.` },
        { title: "Insurance Protection Check", icon: "🛡️", body: insurance.termLife.has || insurance.wholeLife.has
            ? `You have ${insurance.termLife.has ? `term life (${fmt(insurance.termLife.coverage)} coverage)` : ""}${insurance.termLife.has && insurance.wholeLife.has ? " and " : ""}${insurance.wholeLife.has ? `whole life (${fmt(insurance.wholeLife.coverage)} coverage)` : ""} on file. ${insurance.disability.has ? "Disability coverage is also in place — this protects your income, which is the asset funding everything else in this score." : "Consider disability insurance — it protects the paycheck that funds your entire plan."}`
            : "No life insurance on file. If anyone depends on your income, term life insurance is typically the highest-value, lowest-cost way to protect your family's plan against the unexpected." },
        { title: "Action Steps", icon: "✅", body: `1. ${efMonths < 3 ? "Build emergency fund to 3 months first." : "Emergency fund solid — direct extra cashflow to investments."} 2. ${parseFloat(savRate) < 15 ? "Automate a savings transfer on payday." : "Max tax-advantaged accounts first."} 3. Increase contribution rate 1% with every raise.` },
      ],
    },
  };
}

// ── FINANCIAL HEALTH SCORE ────────────────────────────────────────────────────
function FinancialHealthScore({ mInc, mExp, mCash, savRate, avgSavRate6mo, goals, totalNet, totalAssets, retBal, liabilities, insurance, dti, isPro, onUpgradePro, completeness }) {
  const [showDetail, setShowDetail] = useState(false);
  const [activeCategory, setActiveCategory] = useState(null); // "needs"|"wants"|"wealth"

  // ── Score calculation ──────────────────────────────────────────────────────
  const annInc = mInc * 12;
  const savingsPct = mInc > 0 ? Math.max(0, (mCash / mInc)) * 100 : 0;
  // Blend live (this-month) savings rate with the 6-month rolling average so
  // one unusually large or small month doesn't swing the score too hard,
  // while the score still responds to real, current behavior.
  const blendedSavingsPct = avgSavRate6mo != null
    ? Math.max(0, savingsPct * 0.6 + avgSavRate6mo * 0.4)
    : savingsPct;
  const needsPct   = mInc > 0 ? (mExp / mInc) * 100 : 100;

  // Rule 1: 50/30/20 (max 20 pts)
  const needsScore  = Math.max(0, 20 - Math.max(0, needsPct - 50) * 0.8);
  // Rule 2: Emergency fund 3–6 months (max 15 pts)
  const efMonths     = mExp > 0 ? (totalAssets * 0.15) / mExp : 0;
  const efScore      = Math.min(15, efMonths >= 6 ? 15 : efMonths >= 3 ? 10 : efMonths >= 1 ? 5 : 0);
  // Rule 3: Housing ≤ 1/3 income (max 15 pts)
  const mortgagePmt  = liabilities.filter(l => l.type === "mortgage").reduce((s, l) => s + l.monthlyPayment, 0);
  const housingPct   = mInc > 0 ? (mortgagePmt / mInc) * 100 : 50;
  const housingScore = Math.max(0, 15 - Math.max(0, housingPct - 33.3) * 0.7);
  // Rule 4: Retirement benchmarks (max 15 pts) — retBal is a real prop, not a
  // guess. ageMultiple() is module-scope — see its definition near AVG_RETIREMENT_AGE.
  const yrsLeft = Math.max(goals.retireAge - goals.currentAge, 1);
  const retTarget    = annInc * ageMultiple(goals.currentAge);
  const retRatio     = retTarget > 0 ? retBal / retTarget : 0;
  // Being behind the benchmark matters more the closer someone is to
  // retirement — the same shortfall ratio is more urgent with 3 years left
  // than with 30. This urgency multiplier scales the score's sensitivity to
  // being under 100% of benchmark without changing the score when on/above
  // target (multiplier only bites when retRatio < 1).
  const urgency       = yrsLeft <= 5 ? 1.4 : yrsLeft <= 15 ? 1.15 : 1.0;
  const retRatioScored = retRatio >= 1 ? 1 : retRatio * urgency;
  const retScore     = Math.min(15, retRatioScored * 15);
  // Rule 5: Car rule 20-4-10 (max 10 pts)
  const carPmt       = liabilities.filter(l => l.type === "auto").reduce((s, l) => s + l.monthlyPayment, 0);
  const carPct       = mInc > 0 ? (carPmt / mInc) * 100 : 0;
  const carScore     = Math.max(0, 10 - Math.max(0, carPct - 10) * 0.6);
  // Rule 6: Savings rate ≥ 20% (max 15 pts) — blended with 6-month average
  const savScore     = Math.min(15, (blendedSavingsPct / 20) * 15);
  // Rule 7: DTI < 36% (max 10 pts)
  const dtiVal       = parseFloat(dti) || 0;
  const dtiScore     = Math.max(0, 10 - Math.max(0, dtiVal - 36) * 0.25);

  const rawScore = needsScore + efScore + housingScore + retScore + carScore + savScore + dtiScore;
  const maxScore = 100;
  // The completeness multiplier scales the raw score down when the user
  // hasn't provided enough data for the score to be meaningful. A brand-new
  // profile with zero everything would otherwise score deceptively high
  // (no debt = full DTI marks, no car = full car-rule marks). As real data
  // comes in, the multiplier rises toward 1.0 and the score "catches up" to
  // reflect the fuller picture.
  const score = Math.round(Math.min(900, (rawScore / maxScore) * 900 * completeness.multiplier));

  const scoreLabel = score >= 750 ? "Excellent" : score >= 600 ? "Good" : score >= 450 ? "Above Average" : score >= 300 ? "Needs Work" : "Getting Started";
  const scoreColor = score >= 750 ? T.green : score >= 600 ? T.teal : score >= 450 ? T.gold : score >= 300 ? "#ffa726" : T.red;

  // Category sub-scores (0–100 each), also scaled by completeness
  const needsCatScore  = Math.round(((needsScore + housingScore) / 35) * 100 * completeness.multiplier);
  const wantsCatScore  = Math.round(((carScore + dtiScore) / 20) * 100 * completeness.multiplier);
  const wealthCatScore = Math.round(((efScore + retScore + savScore) / 45) * 100 * completeness.multiplier);

  const catColor = s => s >= 70 ? T.green : s >= 50 ? T.gold : T.red;
  const catGrade = s => s >= 85 ? "A" : s >= 70 ? "B" : s >= 55 ? "C" : s >= 40 ? "D" : "F";

  const onTrack = retBal >= retTarget * 0.8;
  const categoryData = buildCategoryData({ needsPct, housingPct, needsScore, housingScore, needsCatScore, wantsCatScore, wealthCatScore, dtiVal, carPct, dtiScore, carScore, savRate, efMonths, retRatio, retScore, retTarget, retBal, savScore, efScore, mInc, mExp, mCash, annInc, goals, liabilities, insurance, onTrack, yrsLeft, catColor, catGrade, completeness });

  return (
    <>
      {/* ── Gauge Card ── */}
      <div style={{ ...CS.card, marginBottom: "18px", background: "linear-gradient(160deg,#081525,#060e1c)", cursor: "pointer", position: "relative", overflow: "hidden" }}
        onClick={() => setShowDetail(true)}>
        <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "180px", height: "180px", borderRadius: "50%", background: `radial-gradient(circle, ${scoreColor}12, transparent 70%)`, pointerEvents: "none" }} />

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "8px", paddingBottom: "4px" }}>
          <div style={{ position: "relative", width: "220px", maxWidth: "100%" }}>
            <GaugeArc score={score} size={220} />
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: T.sub, letterSpacing: "2px", textTransform: "uppercase", marginBottom: "4px" }}>Health Score</div>
              <div style={{ fontSize: "44px", fontWeight: "900", color: T.text, letterSpacing: "-2px", lineHeight: 1 }}>{score}</div>
            </div>
          </div>
          <div style={{ marginTop: "12px", textAlign: "center" }}>
            <div style={{ display: "inline-flex", padding: "5px 18px", borderRadius: "20px", background: T.s3, border: `1px solid ${scoreColor}44` }}>
              <span style={{ fontSize: "13px", fontWeight: "700", color: scoreColor }}>{scoreLabel}</span>
            </div>
          </div>
        </div>

        {/* Completeness nudge */}
        {completeness.pct < 1 && (
          <div style={{ marginTop: "16px", padding: "10px 14px", background: `${T.gold}12`, borderRadius: "10px", border: `1px solid ${T.gold}33` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "11px", color: T.gold, fontWeight: "700" }}>Profile {Math.round(completeness.pct * 100)}% complete</span>
              <span style={{ fontSize: "10px", color: T.sub }}>Fuller data → more accurate score</span>
            </div>
            <PBar value={completeness.pct * 100} max={100} color={T.gold} h={5} />
          </div>
        )}

        {/* Category mini-scores */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: "12px", marginTop: "16px" }}>
          {[
            { key: "needs",  label: "Needs",          score: needsCatScore,  icon: "🏠" },
            { key: "wants",  label: "Wants",          score: wantsCatScore,  icon: "🎯" },
            { key: "wealth", label: "Wealth Building", score: wealthCatScore, icon: "📈" },
          ].map(cat => (
            <div key={cat.key} style={{ textAlign: "center", padding: "10px 8px", background: T.s1, borderRadius: "10px", border: `1px solid ${catColor(cat.score)}33` }}>
              <div style={{ fontSize: "18px", marginBottom: "4px" }}>{cat.icon}</div>
              <div style={{ fontSize: "10px", color: T.sub, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "4px" }}>{cat.label}</div>
              <div style={{ fontSize: "20px", fontWeight: "900", color: catColor(cat.score) }}>{catGrade(cat.score)}</div>
              <div style={{ fontSize: "10px", color: T.sub, marginTop: "2px" }}>{cat.score}/100</div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", marginTop: "14px" }}>
          <span style={{ fontSize: "11px", color: T.sub }}>Tap to see detailed breakdown →</span>
        </div>
      </div>

      {/* ── Detail Drawer ── */}
      {showDetail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 250, backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end" }}
          onClick={() => { setShowDetail(false); setActiveCategory(null); }}>
          <div style={{ width: "100%", maxWidth: "680px", margin: "0 auto", background: T.s1, borderRadius: "20px 20px 0 0", maxHeight: "90vh", overflowY: "auto", border: `1px solid ${T.border}` }}
            onClick={e => e.stopPropagation()}>

            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 0" }}>
              <div style={{ width: "40px", height: "4px", borderRadius: "2px", background: T.border }} />
            </div>

            <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "13px", color: T.sub, letterSpacing: "1px", textTransform: "uppercase" }}>💰 Financial Health Score</span>
                  <span style={{ fontSize: "16px", fontWeight: "900", color: T.text }}>{score}</span>
                </div>
                <p style={{ fontSize: "13px", color: "#8ab4cc", lineHeight: "1.6", margin: "8px 0 0", maxWidth: "520px" }}>
                  {completeness.pct < 0.5
                    ? `Your score is currently capped because your profile is only ${Math.round(completeness.pct * 100)}% complete. Add your income, accounts, and goals to unlock your full, accurate score.`
                    : score >= 700 ? "Strong financial discipline across all major categories."
                    : score >= 500 ? "A solid baseline with meaningful room for improvement."
                    : "Foundational gaps that, once addressed, will accelerate your progress."}
                  {" "}The score is calculated across seven evidence-based financial rules, scaled by how complete your profile is.
                </p>
              </div>
              <button onClick={() => { setShowDetail(false); setActiveCategory(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: T.sub, fontSize: "22px", padding: 0, flexShrink: 0 }}>×</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "10px", padding: "16px 20px" }}>
              {["needs","wants","wealth"].map(key => {
                const cat = categoryData[key];
                const sel = activeCategory === key;
                return (
                  <button key={key} onClick={() => setActiveCategory(sel ? null : key)}
                    style={{ padding: "14px 8px", borderRadius: "12px", border: `2px solid ${sel ? cat.color : T.border}`, background: sel ? cat.color + "18" : T.s2, cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
                    <div style={{ fontSize: "20px", marginBottom: "4px" }}>{cat.icon}</div>
                    <div style={{ fontSize: "10px", fontWeight: "700", color: sel ? cat.color : T.sub, letterSpacing: "0.5px", textTransform: "uppercase" }}>{cat.label}</div>
                    <div style={{ fontSize: "20px", fontWeight: "900", color: cat.color, margin: "4px 0" }}>{cat.grade}</div>
                    <div style={{ fontSize: "10px", color: T.sub }}>{cat.score}/100</div>
                  </button>
                );
              })}
            </div>

            {activeCategory && (() => {
              const cat = categoryData[activeCategory];
              return (
                <div style={{ padding: "0 20px 32px" }}>
                  <div style={{ background: T.s2, borderRadius: "12px", padding: "16px", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "18px" }}>{cat.icon}</span>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: cat.color }}>{cat.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: "24px", fontWeight: "900", color: cat.color }}>{cat.grade}</span>
                    </div>
                    <p style={{ fontSize: "13px", color: "#8ab4cc", lineHeight: "1.6", margin: 0 }}>{cat.freeInsight}</p>
                  </div>

                  {cat.metrics.map((m, i) => (
                    <div key={i} style={{ background: T.s2, borderRadius: "10px", padding: "12px 14px", marginBottom: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "4px" }}>
                        <span style={{ fontSize: "12px", color: T.text, fontWeight: "600" }}>{m.label}</span>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: "13px", fontWeight: "800", color: m.good ? T.green : T.gold }}>{m.value}</span>
                          <span style={{ fontSize: "10px", color: T.sub, marginLeft: "6px" }}>target {m.target}</span>
                        </div>
                      </div>
                      <PBar value={m.score} max={m.max} color={m.good ? T.green : T.gold} h={6} />
                    </div>
                  ))}

                  {!isPro ? (
                    <div style={{ background: "linear-gradient(135deg,#0d1a35,#091428)", borderRadius: "12px", padding: "20px", border: `1px solid ${T.gold}44`, textAlign: "center", marginTop: "8px" }}>
                      <div style={{ fontSize: "28px", marginBottom: "8px" }}>🔒</div>
                      <div style={{ fontSize: "14px", fontWeight: "800", color: T.gold, marginBottom: "6px" }}>Detailed Analysis — Pro</div>
                      <div style={{ fontSize: "12px", color: T.sub, lineHeight: "1.6", marginBottom: "14px" }}>
                        Get a full breakdown of every metric, the logic behind each rule, and step-by-step action plans.
                      </div>
                      <button onClick={() => { setShowDetail(false); setActiveCategory(null); onUpgradePro(); }}
                        style={{ padding: "10px 24px", borderRadius: "8px", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: "800", fontSize: "13px", background: T.gradGold, color: "#fff" }}>
                        Upgrade to Pro — $9.99/mo
                      </button>
                    </div>
                  ) : (
                    <div style={{ marginTop: "8px" }}>
                      <div style={{ fontSize: "10px", color: T.gold, fontWeight: "700", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "10px" }}>💎 Detailed Analysis</div>
                      {cat.proDetails.map((d, i) => <ProDetailCard key={i} icon={d.icon} title={d.title} body={d.body} />)}
                    </div>
                  )}
                </div>
              );
            })()}

            {!activeCategory && (
              <div style={{ padding: "0 20px 32px" }}>
                <div style={{ fontSize: "10px", color: T.sub, letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>Score Breakdown</div>
                {[
                  { label: "Essential Spending (50/30/20)", score: needsScore,  max: 20, color: catColor(needsCatScore)  },
                  { label: "Housing Cost Rule",             score: housingScore, max: 15, color: catColor(needsCatScore)  },
                  { label: "Emergency Fund (3–6 months)",  score: efScore,      max: 15, color: catColor(wealthCatScore) },
                  { label: "Retirement Benchmarks",        score: retScore,     max: 15, color: catColor(wealthCatScore) },
                  { label: "Savings Rate (≥20%)",          score: savScore,     max: 15, color: catColor(wealthCatScore) },
                  { label: "Debt-to-Income (<36%)",        score: dtiScore,     max: 10, color: catColor(wantsCatScore)  },
                  { label: "Vehicle Cost Rule (20-4-10)",  score: carScore,     max: 10, color: catColor(wantsCatScore)  },
                ].map((row, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "11px", color: "#8ab4cc", flex: 1, minWidth: "140px" }}>{row.label}</span>
                    <div style={{ width: "100px", flexShrink: 0 }}><PBar value={row.score} max={row.max} color={row.color} h={5} /></div>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: row.color, minWidth: "40px", textAlign: "right" }}>{Math.round(row.score)}/{row.max}</span>
                  </div>
                ))}
                <div style={{ marginTop: "10px", padding: "10px 14px", background: `${T.gold}12`, borderRadius: "8px", fontSize: "11px", color: T.sub }}>
                  Raw rule score × {Math.round(completeness.multiplier * 100)}% completeness multiplier = final score. Complete your profile to remove this discount.
                </div>
                <div style={{ marginTop: "14px", padding: "12px 16px", background: T.s2, borderRadius: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: T.text }}>Total Financial Health Score</span>
                  <span style={{ fontSize: "18px", fontWeight: "900", color: scoreColor }}>{score} / 900</span>
                </div>
                <div style={{ marginTop: "10px", fontSize: "11px", color: T.sub, textAlign: "center" }}>Tap a category above for detailed insights →</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ProDetailCard({ icon, title, body }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: T.s2, borderRadius: "12px", padding: "14px 16px", marginBottom: "10px", border: `1px solid ${T.border}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", cursor: "pointer", gap: "10px" }} onClick={() => setOpen(o => !o)}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>{icon}</span>
          <span style={{ fontSize: "13px", fontWeight: "700", color: T.text }}>{title}</span>
        </div>
        <button style={{ background: "none", border: "none", cursor: "pointer", color: T.green, fontSize: "14px", padding: 0, flexShrink: 0 }}>
          {open ? "▲" : "▼"}
        </button>
      </div>
      {open && (
        <>
          <div style={{ width: "100%", height: "1px", background: T.border, margin: "10px 0" }} />
          <p style={{ fontSize: "12px", color: "#8ab4cc", lineHeight: "1.7", margin: 0 }}>{body}</p>
        </>
      )}
    </div>
  );
}

// ── MONTHLY SUMMARY CARD ────────────────────────────────────────────────────────
// Displays the output of buildMonthlySummary(): a high-level reflection on
// last calendar month — what went well, what merely met target, what fell
// short — plus a short list of things to keep in mind this month. Starts
// collapsed to a one-line teaser so it doesn't dominate the dashboard.
function MonthlySummaryCard({ summary }) {
  const [expanded, setExpanded] = useState(false);
  if (!summary.hasData) {
    return (
      <div style={{ ...CS.card, marginBottom: "18px" }}>
        <div style={CS.sec}>📆 {summary.label} Summary</div>
        <Empty icon="📆" text={`No transactions were logged in ${summary.label}, so there's nothing to reflect on yet. This card fills in automatically once a month has real activity.`} />
      </div>
    );
  }

  const tally = summary.excelled.length + summary.onPace.length + summary.improve.length;
  const headline = summary.improve.length === 0 && summary.excelled.length > 0
    ? "A strong month — most goals beaten or met."
    : summary.improve.length > summary.excelled.length + summary.onPace.length
    ? "A tougher month — a few areas need attention."
    : "A mixed month — some wins, some room to grow.";

  return (
    <div
      style={{ ...CS.card, marginBottom: "18px", cursor: "pointer" }}
      onClick={() => setExpanded(e => !e)}
      role="button" tabIndex={0} aria-expanded={expanded}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(x => !x); } }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: expanded ? "14px" : 0, flexWrap: "wrap", gap: "8px" }}>
        <div>
          <div style={CS.sec}>📆 {summary.label} Summary</div>
          {!expanded && <div style={{ fontSize: "12px", color: "#8ab4cc" }}>{headline}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {tally > 0 && (
            <div style={{ display: "flex", gap: "6px" }}>
              {summary.excelled.length > 0 && <span style={{ fontSize: "10px", fontWeight: "700", padding: "3px 8px", borderRadius: "20px", background: `${T.green}22`, color: T.green }}>{summary.excelled.length} excelled</span>}
              {summary.onPace.length > 0 && <span style={{ fontSize: "10px", fontWeight: "700", padding: "3px 8px", borderRadius: "20px", background: `${T.blue}22`, color: T.blue }}>{summary.onPace.length} on pace</span>}
              {summary.improve.length > 0 && <span style={{ fontSize: "10px", fontWeight: "700", padding: "3px 8px", borderRadius: "20px", background: `${T.gold}22`, color: T.gold }}>{summary.improve.length} to improve</span>}
            </div>
          )}
          <span style={{ color: T.sub, fontSize: "13px" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div onClick={e => e.stopPropagation()}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px", marginBottom: "16px" }}>
            <div style={{ padding: "10px 12px", background: T.s1, borderRadius: "8px" }}>
              <div style={CS.lbl}>Income</div>
              <div style={{ fontSize: "15px", fontWeight: "800", color: T.green }}>{fmt(summary.monthInc)}</div>
            </div>
            <div style={{ padding: "10px 12px", background: T.s1, borderRadius: "8px" }}>
              <div style={CS.lbl}>Expenses</div>
              <div style={{ fontSize: "15px", fontWeight: "800", color: T.red }}>{fmt(summary.monthExp)}</div>
            </div>
            <div style={{ padding: "10px 12px", background: T.s1, borderRadius: "8px" }}>
              <div style={CS.lbl}>Saved</div>
              <div style={{ fontSize: "15px", fontWeight: "800", color: summary.monthCash >= 0 ? T.green : T.red }}>{fmt(summary.monthCash)}</div>
            </div>
            <div style={{ padding: "10px 12px", background: T.s1, borderRadius: "8px" }}>
              <div style={CS.lbl}>Savings Rate</div>
              <div style={{ fontSize: "15px", fontWeight: "800", color: T.cyan }}>{summary.monthSavRate.toFixed(1)}%</div>
            </div>
          </div>

          {summary.excelled.length > 0 && (
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "10px", fontWeight: "700", color: T.green, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>🌟 Where You Excelled</div>
              {summary.excelled.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", padding: "7px 0", borderBottom: i < summary.excelled.length - 1 ? `1px solid ${T.border}` : "none" }}>
                  <span style={{ fontSize: "14px", flexShrink: 0 }}>{f.icon}</span>
                  <span style={{ fontSize: "12px", color: "#8ab4cc", lineHeight: "1.5" }}>{f.text}</span>
                </div>
              ))}
            </div>
          )}

          {summary.onPace.length > 0 && (
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "10px", fontWeight: "700", color: T.blue, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>✓ Stayed On Pace</div>
              {summary.onPace.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", padding: "7px 0", borderBottom: i < summary.onPace.length - 1 ? `1px solid ${T.border}` : "none" }}>
                  <span style={{ fontSize: "14px", flexShrink: 0 }}>{f.icon}</span>
                  <span style={{ fontSize: "12px", color: "#8ab4cc", lineHeight: "1.5" }}>{f.text}</span>
                </div>
              ))}
            </div>
          )}

          {summary.improve.length > 0 && (
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "10px", fontWeight: "700", color: T.gold, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>📈 Room to Improve</div>
              {summary.improve.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", padding: "7px 0", borderBottom: i < summary.improve.length - 1 ? `1px solid ${T.border}` : "none" }}>
                  <span style={{ fontSize: "14px", flexShrink: 0 }}>{f.icon}</span>
                  <span style={{ fontSize: "12px", color: "#8ab4cc", lineHeight: "1.5" }}>{f.text}</span>
                </div>
              ))}
            </div>
          )}

          {tally === 0 && (
            <div style={{ fontSize: "12px", color: T.sub, marginBottom: "14px" }}>
              Transactions were logged, but no goals or category budgets were set to compare against. Set a savings goal or category budgets to get a fuller picture next month.
            </div>
          )}

          <div style={{ background: `${T.blue}12`, border: `1px solid ${T.blue}33`, borderRadius: "10px", padding: "12px 14px" }}>
            <div style={{ fontSize: "10px", fontWeight: "700", color: T.blue, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>🧭 Keep In Mind This Month</div>
            {summary.actions.map((a, i) => (
              <div key={i} style={{ fontSize: "12px", color: T.text, lineHeight: "1.6", marginBottom: i < summary.actions.length - 1 ? "6px" : 0 }}>{i + 1}. {a}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI PANEL ──────────────────────────────────────────────────────────────────
function AiPanel({ context, onClose }) {
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef(null);

  const systemPrompt = `You are a warm, encouraging family financial advisor embedded in a budgeting app. Give practical, numbered insights. Use dollar amounts. Max 4 key points per response.\n\nFAMILY SNAPSHOT:\n${context}`;

  async function callAI(messages) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: systemPrompt, messages }),
    });
    if (!res.ok) throw new Error(await res.text());
    const d = await res.json();
    return d.content ? d.content.map(c => c.text || "").join("") : "No response.";
  }

  useEffect(() => {
    (async () => {
      try {
        const reply = await callAI([{ role: "user", content: "Give me a financial health check and top 3 insights for our family." }]);
        setMsgs([{ role: "assistant", content: reply }]);
      } catch (e) {
        setMsgs([{ role: "assistant", content: "Could not connect to AI advisor. Please try again." }]);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading, thinking]);

  async function send() {
    if (!input.trim() || thinking) return;
    const userMsg = { role: "user", content: input.trim() };
    const history = [{ role: "user", content: "Give me a financial health check and top 3 insights." }, ...msgs, userMsg];
    setMsgs(m => [...m, userMsg]);
    setInput("");
    setThinking(true);
    try {
      const reply = await callAI(history);
      setMsgs(m => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      setMsgs(m => [...m, { role: "assistant", content: "Error getting response. Please try again." }]);
    }
    setThinking(false);
  }

  const dotStyle = delay => ({
    width: "6px", height: "6px", borderRadius: "50%", background: T.blue,
    animation: "ffPulse 1s infinite", animationDelay: delay, opacity: 0.4,
    display: "inline-block", margin: "0 2px",
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "flex-end", zIndex: 300, backdropFilter: "blur(6px)", padding: "12px" }} onClick={onClose}>
      <style>{`@keyframes ffPulse { 0%,100%{opacity:.2} 50%{opacity:1} }`}</style>
      <div style={{ width: "400px", maxWidth: "94vw", height: "560px", maxHeight: "88vh", background: T.s2, borderRadius: "20px", border: `1px solid ${T.border}`, display: "flex", flexDirection: "column", boxShadow: "0 40px 80px rgba(0,0,0,.7)", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", background: T.s3, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "34px", height: "34px", borderRadius: "50%", background: T.gradBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>🤖</div>
            <div>
              <div style={{ fontWeight: "800", fontSize: "13px", color: T.text }}>AI Financial Advisor</div>
              <div style={{ fontSize: "10px", color: T.green }}>● Online</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.sub, fontSize: "22px", lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {loading && (
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
              <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: T.gradBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", flexShrink: 0 }}>🤖</div>
              <div style={{ background: T.s3, borderRadius: "12px", padding: "10px 14px" }}>
                <span style={dotStyle("0s")} /><span style={dotStyle("0.2s")} /><span style={dotStyle("0.4s")} />
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start", flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
              {m.role === "assistant" && (
                <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: T.gradBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", flexShrink: 0 }}>🤖</div>
              )}
              <div style={{ maxWidth: "82%", background: m.role === "user" ? T.blue : T.s3, borderRadius: "12px", padding: "10px 13px", fontSize: "12px", color: T.text, lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                {m.content}
              </div>
            </div>
          ))}
          {thinking && (
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
              <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: T.gradBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", flexShrink: 0 }}>🤖</div>
              <div style={{ background: T.s3, borderRadius: "12px", padding: "10px 14px" }}>
                <span style={dotStyle("0s")} /><span style={dotStyle("0.2s")} /><span style={dotStyle("0.4s")} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, display: "flex", gap: "8px" }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }}
            placeholder="Ask about your finances…"
            style={{ flex: 1, padding: "8px 11px", borderRadius: "8px", border: `1px solid ${T.border}`, background: T.s1, color: T.text, fontFamily: "inherit", fontSize: "12px", outline: "none", minWidth: 0 }} />
          <button onClick={send} disabled={thinking || !input.trim()}
            style={{ padding: "8px 14px", borderRadius: "8px", border: "none", cursor: "pointer", background: T.blue, color: "#fff", fontWeight: "700", fontSize: "12px", opacity: (thinking || !input.trim()) ? 0.45 : 1, flexShrink: 0 }}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ── INSURANCE DOCUMENT ANALYZER ────────────────────────────────────────────────
// Lets the user upload a photo or PDF of an insurance policy (declarations
// page, benefits summary, etc.) and has Claude read it directly, extract
// structured coverage details, identify gaps/constraints, and — critically —
// cross-reference the user's real monthly income to compute what the
// policy's stated benefit actually means in practice (e.g. a disability
// policy capped at "60% of income" is meaningless without knowing income).
// The raw file is converted to base64 in-browser, sent once for analysis,
// and then discarded — only the extracted structured result is kept and
// persisted, never the document itself.
function InsuranceDocAnalyzer({ mInc, annInc, onApplyFindings, onClose }) {
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null); // { mediaType, base64 }
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

  function handleFileSelect(f) {
    setError("");
    setResult(null);
    if (!f) return;
    if (!ACCEPTED.includes(f.type)) {
      setError("Please upload a PNG, JPEG, WEBP image, or a PDF of your policy document.");
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setError("File is too large — please upload a file under 15MB.");
      return;
    }
    setFile(f);
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      setPreview({ mediaType: f.type, base64 });
    };
    reader.onerror = () => setError("Could not read that file — please try again.");
    reader.readAsDataURL(f);
  }

  async function analyze() {
    if (!preview) return;
    setAnalyzing(true);
    setError("");
    setResult(null);

    const incomeContext = mInc > 0
      ? `The household's current monthly income is ${fmt(mInc)} (${fmt(annInc)}/year). Use this to compute what any percentage-of-income or income-replacement benefit actually pays out in real dollars, and to flag if a stated maximum benefit would leave a meaningful income gap.`
      : `The household has not yet entered income information, so express any income-replacement percentages as percentages only — do not compute dollar amounts.`;

    const systemPrompt = `You are an insurance policy analyst helping a family understand a coverage document they've uploaded. Read the attached document carefully and extract real details — do not invent information that is not present in the document.

${incomeContext}

Respond with ONLY a single JSON object, no other text, no markdown code fences, matching exactly this shape:
{
  "policyType": "term_life | whole_life | disability | health | other",
  "summary": "one or two plain-English sentences describing what this policy covers",
  "findings": ["specific fact extracted from the document, e.g. 'Death benefit: $500,000'", "..."],
  "gaps": ["a real coverage gap or exclusion found in the document, or an absence of a coverage type a family typically needs", "..."],
  "constraints": ["a real limitation, waiting period, exclusion, or condition found in the document", "..."],
  "maxMonthlyDistribution": "a plain-English statement of the maximum this policy would pay out per month if a claim were approved, cross-referenced against the household income figure if provided — or null if the document does not support computing this",
  "confidence": "high | medium | low — how clearly the document supported these findings"
}

If the document is unreadable, is not an insurance document, or does not contain enough information for a field, use an empty array or null rather than guessing. Never fabricate policy numbers, dollar amounts, or dates that are not visible in the document.`;

    try {
      const contentBlock = preview.mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: preview.mediaType, data: preview.base64 } }
        : { type: "image", source: { type: "base64", media_type: preview.mediaType, data: preview.base64 } };

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          system: systemPrompt,
          messages: [{
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: "Analyze this insurance document and return the JSON object described in your instructions." },
            ],
          }],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json();
      const raw = d.content ? d.content.map(c => c.text || "").join("") : "";
      const cleaned = raw.replace(/```json\s*|```\s*/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error("Could not read a structured result from the document. Try a clearer photo or a text-based PDF.");
      }
      setResult(parsed);
    } catch (e) {
      setError(e.message && e.message.length < 200 ? e.message : "Could not analyze this document. Please try again with a clearer file.");
    }
    setAnalyzing(false);
  }

  function applyAndClose() {
    if (!result) return;
    onApplyFindings(result);
  }

  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "520px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "6px" }}>📄 Upload Insurance Document</div>
        <div style={{ fontSize: "11px", color: T.sub, marginBottom: "16px", lineHeight: "1.6" }}>
          Upload a photo or PDF of a declarations page, benefits summary, or policy document. Claude will read it, extract coverage details, and cross-reference your income to estimate real payout limits. The file itself is never stored — only the extracted findings.
        </div>

        {!preview && (
          <div
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            style={{ border: `2px dashed ${T.border}`, borderRadius: "12px", padding: "36px 20px", textAlign: "center", cursor: "pointer", background: T.s1 }}>
            <div style={{ fontSize: "30px", marginBottom: "8px" }}>📎</div>
            <div style={{ fontSize: "13px", fontWeight: "700", color: T.text, marginBottom: "4px" }}>Tap to choose a file</div>
            <div style={{ fontSize: "10px", color: T.sub }}>PNG, JPEG, WEBP, or PDF — up to 15MB</div>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf"
              style={{ display: "none" }}
              onChange={e => handleFileSelect(e.target.files && e.target.files[0])} />
          </div>
        )}

        {preview && !result && (
          <div style={{ background: T.s1, borderRadius: "10px", padding: "14px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "22px" }}>{preview.mediaType === "application/pdf" ? "📕" : "🖼️"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
              <div style={{ fontSize: "10px", color: T.sub }}>Ready to analyze</div>
            </div>
            <button onClick={() => { setFile(null); setFileName(""); setPreview(null); setResult(null); setError(""); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: "14px", padding: "4px" }}>✕</button>
          </div>
        )}

        {error && (
          <div style={{ padding: "10px 14px", background: `${T.red}15`, border: `1px solid ${T.red}44`, borderRadius: "8px", fontSize: "11px", color: T.red, marginBottom: "14px" }}>{error}</div>
        )}

        {!result && (
          <div style={{ display: "flex", gap: "10px" }}>
            <button style={{ ...btn(T.s3), flex: 1 }} onClick={onClose}>Cancel</button>
            <button style={{ ...btn(T.blue, "#fff"), flex: 1, opacity: (!preview || analyzing) ? 0.5 : 1 }} disabled={!preview || analyzing} onClick={analyze}>
              {analyzing ? "Analyzing…" : "Analyze Document"}
            </button>
          </div>
        )}

        {result && (
          <div>
            <div style={{ background: T.s1, borderRadius: "10px", padding: "14px", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ fontSize: "16px" }}>✅</span>
                <span style={{ fontSize: "12px", fontWeight: "700", color: T.green }}>Analysis complete</span>
                {result.confidence && (
                  <span style={{ marginLeft: "auto", fontSize: "9px", padding: "2px 8px", borderRadius: "20px", background: result.confidence === "high" ? `${T.green}22` : result.confidence === "medium" ? `${T.gold}22` : `${T.red}22`, color: result.confidence === "high" ? T.green : result.confidence === "medium" ? T.gold : T.red, fontWeight: "700" }}>
                    {result.confidence} confidence
                  </span>
                )}
              </div>
              {result.summary && <p style={{ fontSize: "12px", color: "#8ab4cc", lineHeight: "1.6", margin: 0 }}>{result.summary}</p>}
            </div>

            {result.maxMonthlyDistribution && (
              <div style={{ background: `${T.blue}12`, border: `1px solid ${T.blue}33`, borderRadius: "10px", padding: "12px 14px", marginBottom: "12px" }}>
                <div style={{ fontSize: "10px", color: T.blue, fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" }}>💰 Max Monthly Distribution</div>
                <div style={{ fontSize: "12px", color: T.text, lineHeight: "1.6" }}>{result.maxMonthlyDistribution}</div>
              </div>
            )}

            {Array.isArray(result.findings) && result.findings.length > 0 && (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "10px", color: T.green, fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" }}>✓ Coverage Found</div>
                {result.findings.map((f, i) => (
                  <div key={i} style={{ fontSize: "12px", color: T.text, padding: "6px 0", borderBottom: i < result.findings.length - 1 ? `1px solid ${T.border}` : "none" }}>• {f}</div>
                ))}
              </div>
            )}

            {Array.isArray(result.gaps) && result.gaps.length > 0 && (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "10px", color: T.red, fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" }}>⚠️ Gaps Identified</div>
                {result.gaps.map((g, i) => (
                  <div key={i} style={{ fontSize: "12px", color: T.text, padding: "6px 0", borderBottom: i < result.gaps.length - 1 ? `1px solid ${T.border}` : "none" }}>• {g}</div>
                ))}
              </div>
            )}

            {Array.isArray(result.constraints) && result.constraints.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "10px", color: T.gold, fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" }}>🔒 Constraints & Limitations</div>
                {result.constraints.map((c, i) => (
                  <div key={i} style={{ fontSize: "12px", color: T.text, padding: "6px 0", borderBottom: i < result.constraints.length - 1 ? `1px solid ${T.border}` : "none" }}>• {c}</div>
                ))}
              </div>
            )}

            <div style={{ fontSize: "10px", color: T.sub, marginBottom: "14px" }}>
              AI-extracted from your uploaded document — always confirm details against your actual policy paperwork or with your insurance provider before making decisions.
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => { setFile(null); setFileName(""); setPreview(null); setResult(null); }}>Analyze Another</button>
              <button style={{ ...btn(T.green, "#000"), flex: 1, fontWeight: "800" }} onClick={applyAndClose}>Save to My Insurance</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── RECEIPT SCANNER — camera/upload → Claude reads the receipt → user confirms ─
// Follows the same direct-to-Anthropic-API pattern as InsuranceDocAnalyzer
// above. Claude only ever proposes values; nothing is written to the ledger
// until the person reviews and taps Confirm on the form below — this never
// auto-creates a transaction from a photo alone.
function ReceiptScannerModal({ accounts, liabilities, onConfirm, onClose }) {
  const [preview, setPreview] = useState(null); // { mediaType, base64, dataUrl }
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [extracted, setExtracted] = useState(null);
  const [form, setForm] = useState(null); // editable fields once extraction succeeds
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const EXPENSE_CATS = EXP.map(c => c.id);

  function handleFileSelect(f) {
    setError(""); setExtracted(null); setForm(null);
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Please upload a photo of the receipt (PNG, JPEG, etc)."); return; }
    if (f.size > 15 * 1024 * 1024) { setError("Image is too large — please use a photo under 15MB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.split(",")[1] || "";
      setPreview({ mediaType: f.type, base64, dataUrl });
    };
    reader.onerror = () => setError("Could not read that photo — please try again.");
    reader.readAsDataURL(f);
  }

  async function analyze() {
    if (!preview) return;
    setAnalyzing(true); setError(""); setExtracted(null); setForm(null);

    const systemPrompt = `You read receipt photos for a personal finance app and extract structured purchase data. Read only what is actually printed on the receipt — never invent a merchant name, amount, or date that isn't visible.

Valid expense category ids (pick the single best match, or "other_exp" if nothing fits): ${EXPENSE_CATS.join(", ")}

Respond with ONLY a single JSON object, no other text, no markdown fences, matching exactly this shape:
{
  "merchant": "the store/business name as printed, or null if unreadable",
  "date": "YYYY-MM-DD if a date is visible, else null",
  "total": 00.00 (the final total charged, as a number, or null if unreadable),
  "category": "one of the valid category ids above",
  "confidence": "high | medium | low",
  "notes": "one short phrase noting anything uncertain (e.g. 'total partially obscured'), or null"
}`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          system: systemPrompt,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: preview.mediaType, data: preview.base64 } },
              { type: "text", text: "Read this receipt and return the JSON object described in your instructions." },
            ],
          }],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json();
      const raw = d.content ? d.content.map(c => c.text || "").join("") : "";
      const cleaned = raw.replace(/```json\s*|```\s*/g, "").trim();
      let parsed;
      try { parsed = JSON.parse(cleaned); }
      catch { throw new Error("Couldn't read a clear result from that photo. Try better lighting or a straighter angle."); }

      setExtracted(parsed);
      setForm({
        aId: accounts[0] ? accounts[0].id : (liabilities[0] ? liabIdOf(liabilities[0].id) : ""),
        desc: parsed.merchant || "Receipt",
        amt: parsed.total != null ? String(parsed.total) : "",
        cat: EXPENSE_CATS.includes(parsed.category) ? parsed.category : "other_exp",
        catNote: "",
        date: parsed.date || new Date().toISOString().split("T")[0],
      });
    } catch (e) {
      setError(e.message && e.message.length < 200 ? e.message : "Could not read this receipt. Please try again with a clearer photo.");
    }
    setAnalyzing(false);
  }

  function confirm() {
    if (!form || !form.aId || !form.desc || !form.amt) return;
    onConfirm({ ...form, amt: -Math.abs(parseFloat(form.amt) || 0) }); // receipts are always an expense
    onClose();
  }

  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "460px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "4px" }}>📷 Scan Receipt</div>
        <div style={{ fontSize: "11px", color: T.sub, marginBottom: "16px" }}>Claude reads the merchant, total, and category — you confirm before anything is added.</div>

        {!preview && (
          <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => handleFileSelect(e.target.files[0])} />
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFileSelect(e.target.files[0])} />
            <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={() => cameraInputRef.current?.click()}>📸 Take Photo</button>
            <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => fileInputRef.current?.click()}>🖼️ Upload</button>
          </div>
        )}

        {preview && (
          <div style={{ marginBottom: "14px" }}>
            <img src={preview.dataUrl} alt="Receipt preview" style={{ width: "100%", maxHeight: "220px", objectFit: "contain", borderRadius: "10px", border: `1px solid ${T.border}`, background: T.s1 }} />
            {!extracted && !analyzing && (
              <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => { setPreview(null); setExtracted(null); setForm(null); setError(""); }}>Retake</button>
                <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={analyze}>Read Receipt</button>
              </div>
            )}
          </div>
        )}

        {analyzing && <div style={{ fontSize: "12px", color: T.sub, textAlign: "center", padding: "10px 0" }}>Reading receipt…</div>}
        {error && <div style={{ fontSize: "12px", color: T.red, marginBottom: "10px" }}>{error}</div>}

        {form && (
          <div>
            {extracted?.confidence === "low" && <div style={{ fontSize: "10px", color: T.gold, marginBottom: "10px" }}>⚠ Low confidence read — double-check these fields before confirming.</div>}
            {extracted?.notes && <div style={{ fontSize: "10px", color: T.sub, marginBottom: "10px" }}>Note: {extracted.notes}</div>}

            <div style={{ marginBottom: "10px" }}><div style={CS.lbl}>Merchant</div><input style={CS.inp} value={form.desc} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
              <div><div style={CS.lbl}>Total ($)</div><input style={CS.inp} type="number" value={form.amt} onChange={e => setForm(f => ({ ...f, amt: e.target.value }))} /></div>
              <div><div style={CS.lbl}>Date</div><input style={CS.inp} type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            </div>
            <div style={{ marginBottom: "10px" }}>
              <div style={CS.lbl}>Category</div>
              <select style={CS.inp} value={form.cat} onChange={e => setForm(f => ({ ...f, cat: e.target.value }))}>
                {EXP.map(c => <option key={c.id} value={c.id}>{c.i} {c.l}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: "14px" }}>
              <div style={CS.lbl}>Account / Card</div>
              <select style={CS.inp} value={form.aId} onChange={e => setForm(f => ({ ...f, aId: e.target.value }))}>
                <option value="">Select…</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                {liabilities.map(l => <option key={l.id} value={liabIdOf(l.id)}>{getLT(l.type).i} {l.name}</option>)}
              </select>
            </div>
            <button style={{ ...btn(T.green, "#000"), width: "100%" }} onClick={confirm}>✓ Confirm & Add Transaction</button>
          </div>
        )}

        <button style={{ ...btn(T.s3), width: "100%", marginTop: "10px" }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── PAYWALL ───────────────────────────────────────────────────────────────────
function Paywall({ onClose, onUpgrade }) {
  const features = ["📊 6 investment strategy options", "🏖️ Retirement projections & gap analysis", "💰 Dividend tracker with calendar & forecasts", "📈 5yr / 10yr / 20yr dividend income forecasts", "🤖 AI portfolio optimization tips"];
  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, textAlign: "center", width: "400px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>💎</div>
        <div style={{ fontSize: "20px", fontWeight: "900", marginBottom: "8px", background: T.gradGold, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>FamilyFinance Pro</div>
        <div style={{ color: T.sub, fontSize: "12px", lineHeight: "1.7", marginBottom: "20px" }}>Unlock investment strategies, dividend tracking, and retirement insights.</div>
        {features.map(f => <div key={f} style={{ textAlign: "left", padding: "7px 12px", background: T.s1, borderRadius: "8px", fontSize: "12px", color: T.text, marginBottom: "7px" }}>{f}</div>)}
        <button onClick={onUpgrade} style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: "800", fontSize: "14px", background: T.gradGold, color: "#fff", marginTop: "8px" }}>
          Upgrade to Pro — $9.99/mo
        </button>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.sub, fontSize: "12px", marginTop: "10px", fontFamily: "inherit", display: "block", width: "100%" }}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ── TRANSACTION MODAL (module-scope, explicit props — fixes focus-loss bug) ───
// Previously this was a function defined inside App(), which meant React saw
// a brand-new component type on every App render and remounted the modal's
// DOM — including the <input> elements — on every keystroke elsewhere in the
// app. Lifting it here with explicit props (rather than closures over App's
// state) makes it a stable component that only re-renders for its own reasons.
function TxnModal({ form, setForm, accounts, liabilities, onCancel, onSubmit, isEdit }) {
  const cats = form.type === "income" ? INC : EXP;
  return (
    <div style={CS.modalWrap} onClick={onCancel}>
      <div style={CS.mbox} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "18px" }}>{isEdit ? "Edit Transaction" : "Add Transaction"}</div>
        <div style={{ marginBottom: "13px" }}>
          <div style={CS.lbl}>Account</div>
          <select style={CS.inp} value={form.aId} onChange={e => setForm({ ...form, aId: e.target.value })}>
            <option value="">Select…</option>
            {accounts.length > 0 && (
              <optgroup label="Accounts">
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </optgroup>
            )}
            {liabilities.length > 0 && (
              <optgroup label="Credit Cards & Liabilities">
                {liabilities.map(l => <option key={l.id} value={liabIdOf(l.id)}>{getLT(l.type).i} {l.name}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <div style={{ marginBottom: "13px" }}>
          <div style={CS.lbl}>Type</div>
          <div style={{ display: "flex", gap: "8px" }}>
            {["income","expense"].map(t => (
              <button key={t} onClick={() => setForm({ ...form, type: t, cat: t === "income" ? "salary" : "groceries" })}
                style={{ flex: 1, padding: "8px", borderRadius: "8px", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: "700", fontSize: "12px", background: form.type === t ? (t === "income" ? T.green : T.red) : T.s3, color: form.type === t && t === "income" ? "#000" : "#fff", opacity: form.type === t ? 1 : 0.5 }}>
                {t === "income" ? "↑ Income" : "↓ Expense"}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: "13px" }}>
          <div style={CS.lbl}>Category</div>
          <select style={CS.inp} value={form.cat} onChange={e => setForm({ ...form, cat: e.target.value })}>
            {cats.map(c => <option key={c.id} value={c.id}>{c.i} {c.l}</option>)}
          </select>
        </div>
        {gc(form.cat).needsNote && (
          <div style={{ marginBottom: "13px" }}>
            <div style={CS.lbl}>What kind of expense is this?</div>
            <input style={CS.inp} placeholder="e.g. Home repair, pet vet bill, hobby supplies…" value={form.catNote || ""} onChange={e => setForm({ ...form, catNote: e.target.value })} />
            <div style={{ fontSize: "10px", color: T.sub, marginTop: "4px" }}>This helps you spot patterns in "Other" spending over time.</div>
          </div>
        )}
        <div style={{ marginBottom: "13px" }}><div style={CS.lbl}>Description</div><input style={CS.inp} placeholder="e.g. Whole Foods" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} /></div>
        <div style={{ marginBottom: "13px" }}><div style={CS.lbl}>Amount ($)</div><input style={CS.inp} type="number" placeholder="0.00" value={form.amt} onChange={e => setForm({ ...form, amt: e.target.value })} /></div>
        <div style={{ marginBottom: "18px" }}><div style={CS.lbl}>Date</div><input style={CS.inp} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button style={{ ...btn(T.s3), flex: 1 }} onClick={onCancel}>Cancel</button>
          <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={onSubmit}>{isEdit ? "Save Changes" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}

// ── LIABILITY MODAL (module-scope, explicit props) ─────────────────────────────
function LiabModal({ form, setForm, onCancel, onSubmit, isEdit }) {
  const isMort = form.type === "mortgage" || form.type === "heloc";
  const isCC   = form.type === "credit_card";
  return (
    <div style={CS.modalWrap} onClick={onCancel}>
      <div style={{ ...CS.mbox, width: "460px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "18px" }}>{isEdit ? "Edit Liability" : "Add Liability"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px", marginBottom: "14px" }}>
          {LIAB_TYPES.map(t => (
            <button key={t.id} onClick={() => setForm({ ...form, type: t.id })}
              style={{ padding: "8px 10px", borderRadius: "8px", border: `2px solid ${form.type === t.id ? t.c : T.border}`, background: form.type === t.id ? t.c + "22" : T.s1, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: "700", color: form.type === t.id ? t.c : T.sub, textAlign: "left" }}>
              {t.i} {t.l}
            </button>
          ))}
        </div>
        <div style={{ marginBottom: "12px" }}><div style={CS.lbl}>Name / Lender</div><input style={CS.inp} placeholder="e.g. Chase Mortgage" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        {!isCC && <div style={{ marginBottom: "12px" }}><div style={CS.lbl}>Original Loan Amount ($)</div><input style={CS.inp} type="number" placeholder="300000" value={form.originalAmt || ""} onChange={e => setForm({ ...form, originalAmt: parseFloat(e.target.value) || 0 })} /></div>}
        <div style={{ marginBottom: "12px" }}><div style={CS.lbl}>Current Balance ($)</div><input style={CS.inp} type="number" placeholder="280000" value={form.currentBal || ""} onChange={e => setForm({ ...form, currentBal: parseFloat(e.target.value) || 0 })} /></div>
        <div style={{ marginBottom: "12px" }}><div style={CS.lbl}>Interest Rate (%)</div><input style={CS.inp} type="number" step="0.01" placeholder="6.75" value={form.rate || ""} onChange={e => setForm({ ...form, rate: parseFloat(e.target.value) || 0 })} /></div>
        {!isCC && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
            <div><div style={CS.lbl}>Term (months)</div><input style={CS.inp} type="number" placeholder="360" value={form.termMonths || ""} onChange={e => setForm({ ...form, termMonths: parseInt(e.target.value) || 0 })} /></div>
            <div><div style={CS.lbl}>Months Paid</div><input style={CS.inp} type="number" placeholder="12" value={form.monthsPaid || ""} onChange={e => setForm({ ...form, monthsPaid: parseInt(e.target.value) || 0 })} /></div>
          </div>
        )}
        <div style={{ marginBottom: "12px" }}><div style={CS.lbl}>Monthly Payment ($)</div><input style={CS.inp} type="number" placeholder="0" value={form.monthlyPayment || ""} onChange={e => setForm({ ...form, monthlyPayment: parseFloat(e.target.value) || 0 })} /></div>
        {isMort && (
          <>
            <div style={{ marginBottom: "12px" }}><div style={CS.lbl}>Current Home Value ($)</div><input style={CS.inp} type="number" placeholder="425000" value={form.homeValue || ""} onChange={e => setForm({ ...form, homeValue: parseFloat(e.target.value) || 0 })} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div><div style={CS.lbl}>Appreciation (%/yr)</div><input style={CS.inp} type="number" step="0.1" placeholder="3.5" value={form.homeAppreciation || ""} onChange={e => setForm({ ...form, homeAppreciation: parseFloat(e.target.value) || 0 })} /></div>
              <div><div style={CS.lbl}>Zip Code</div><input style={CS.inp} placeholder="78701" value={form.zipCode || ""} onChange={e => setForm({ ...form, zipCode: e.target.value })} /></div>
            </div>
          </>
        )}
        <div style={{ marginBottom: "18px" }}><div style={CS.lbl}>Notes</div><input style={CS.inp} placeholder="e.g. 30yr fixed, Chase" value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button style={{ ...btn(T.s3), flex: 1 }} onClick={onCancel}>Cancel</button>
          <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={onSubmit}>{isEdit ? "Save Changes" : "Add Liability"}</button>
        </div>
      </div>
    </div>
  );
}

// ── DIVIDEND TRACKER ──────────────────────────────────────────────────────────
function DividendTracker({ holdings, setHoldings }) {
  const [showAdd, setShowAdd] = useState(false);
  const [analyticsHolding, setAnalyticsHolding] = useState(null); // holding object or null
  const blankForm = { ticker: "", name: "", shares: "", costBasis: "", annualDiv: "", yieldPct: "", divGrowthRate: "", sector: "ETF", payDays: [15], payMonths: [0,3,6,9] };
  const [form, setForm] = useState(blankForm);
  const [autofilled, setAutofilled] = useState(false);

  const totalAnnual = holdings.reduce((s, h) => s + h.shares * h.annualDiv, 0);

  function forecast(years) {
    return holdings.reduce((s, h) => {
      const grown = h.annualDiv * Math.pow(1 + h.divGrowthRate / 100, years);
      return s + h.shares * grown;
    }, 0);
  }
  const f5 = forecast(5), f10 = forecast(10), f20 = forecast(20);

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const todayDay = now.getDate();

  const calDays = useMemo(() => {
    const days = {};
    for (let d = 1; d <= daysInMonth; d++) days[d] = [];
    holdings.forEach(h => {
      if (h.payMonths.includes(now.getMonth())) {
        h.payDays.forEach(pd => { if (days[pd]) days[pd].push(h); });
      }
    });
    return days;
  }, [holdings, daysInMonth, now]);

  const sectorData = useMemo(() => {
    const m = {};
    holdings.forEach(h => { m[h.sector] = (m[h.sector] || 0) + h.shares * h.annualDiv; });
    return Object.entries(m).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
  }, [holdings]);

  const DIV_COLORS = ["#00e8a0","#1a8fff","#f5a623","#9b59ff","#ff3d5c","#00d4c8","#f472b6"];
  const firstDayOfWeek = new Date(now.getFullYear(), now.getMonth(), 1).getDay();

  // Auto-populate company name, annual dividend, yield, growth rate, pay day,
  // and pay months from the static reference table when a known ticker is
  // typed. Every field stays editable after autofill — this is a starting
  // point, not a locked value.
  function handleTickerChange(raw) {
    const ticker = raw.toUpperCase();
    const match = DIV_TICKER_DATA[ticker];
    if (match) {
      setForm(f => ({
        ...f, ticker,
        name: match.name, annualDiv: String(match.annualDiv), yieldPct: String(match.yieldPct),
        divGrowthRate: String(match.divGrowthRate), sector: match.sector,
        payDays: match.payDays, payMonths: match.payMonths,
      }));
      setAutofilled(true);
    } else {
      setForm(f => ({ ...f, ticker }));
      setAutofilled(false);
    }
  }

  function addHolding() {
    if (!form.ticker || !form.shares || !form.annualDiv) return;
    setHoldings(h => [...h, {
      ...form, id: uid(),
      shares: parseFloat(form.shares), costBasis: parseFloat(form.costBasis) || 0,
      annualDiv: parseFloat(form.annualDiv), yieldPct: parseFloat(form.yieldPct) || 0,
      divGrowthRate: parseFloat(form.divGrowthRate) || 5,
    }]);
    setShowAdd(false);
    setForm(blankForm);
    setAutofilled(false);
  }
  function removeHolding(id) {
    setHoldings(h => h.filter(x => x.id !== id));
  }

  const barForecast = [
    { year: "Now",  income: Math.round(totalAnnual) },
    { year: "5yr",  income: Math.round(f5)  },
    { year: "10yr", income: Math.round(f10) },
    { year: "20yr", income: Math.round(f20) },
  ];

  if (holdings.length === 0 && !showAdd) {
    return (
      <div style={CS.card}>
        <Empty icon="📊" text="No dividend holdings yet. Add your first position to see income forecasts and a payout calendar." />
        <div style={{ textAlign: "center" }}>
          <button style={btn(T.blue, "#fff")} onClick={() => setShowAdd(true)}>+ Add Holding</button>
        </div>
        {showAdd && null}
      </div>
    );
  }

  return (
    <div>
      <IncomeDashboard holdings={holdings} totalAnnual={totalAnnual} />

      <div style={CS.g4}>
        <div style={CS.card}><div style={CS.lbl}>Annual Dividends</div><div style={{ ...CS.big, color: T.green }}>{fmt(totalAnnual)}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "3px" }}>{fmt(totalAnnual / 12)}/mo avg</div></div>
        <div style={CS.card}><div style={CS.lbl}>5-Year Forecast</div><div style={{ ...CS.big, color: T.cyan }}>{fmt(f5)}/yr</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "3px" }}>+{totalAnnual > 0 ? ((f5/totalAnnual-1)*100).toFixed(0) : 0}% growth</div></div>
        <div style={CS.card}><div style={CS.lbl}>10-Year Forecast</div><div style={{ ...CS.big, color: T.blue }}>{fmt(f10)}/yr</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "3px" }}>+{totalAnnual > 0 ? ((f10/totalAnnual-1)*100).toFixed(0) : 0}% growth</div></div>
        <div style={CS.card}><div style={CS.lbl}>20-Year Forecast</div><div style={{ ...CS.big, color: T.gold }}>{fmt(f20)}/yr</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "3px" }}>+{totalAnnual > 0 ? ((f20/totalAnnual-1)*100).toFixed(0) : 0}% growth</div></div>
      </div>

      <div style={{ ...CS.card, marginBottom: "18px" }}>
        <div style={CS.sec}>Dividend Income Forecast</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={barForecast}>
            <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 12 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 10 }} tickFormatter={v => fmt(v)} />
            <Tooltip content={<CTip />} />
            <Bar dataKey="income" name="Annual Dividends" radius={[6,6,0,0]}>
              {barForecast.map((_, i) => <Cell key={i} fill={[T.green, T.cyan, T.blue, T.gold][i]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={CS.g2}>
        <div style={CS.card}>
          <div style={CS.sec}>📅 Dividend Calendar — {MO[now.getMonth()]} {now.getFullYear()}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "3px", marginBottom: "6px" }}>
            {["S","M","T","W","T","F","S"].map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: "9px", color: T.sub, fontWeight: "700" }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "3px" }}>
            {Array(firstDayOfWeek).fill(null).map((_, i) => <div key={`bl${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const payers = calDays[day] || [];
              const isToday = day === todayDay;
              const hasPay = payers.length > 0;
              return (
                <div key={day} style={{ aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: "5px", background: isToday ? `${T.blue}44` : hasPay ? `${T.green}22` : T.s1, border: `1px solid ${isToday ? T.blue : hasPay ? `${T.green}55` : T.border}` }}>
                  <span style={{ fontSize: "10px", fontWeight: (isToday || hasPay) ? "800" : "400", color: isToday ? T.blue : hasPay ? T.green : T.sub }}>{day}</span>
                  {hasPay && <span style={{ fontSize: "7px" }}>💰</span>}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {Object.entries(calDays).filter(([, v]) => v.length > 0).map(([d, ps]) => (
              <div key={d} style={{ padding: "3px 8px", background: `${T.green}18`, borderRadius: "6px", fontSize: "10px", color: T.green, fontWeight: "700" }}>
                Day {d}: {ps.map(p => p.ticker).join(", ")}
              </div>
            ))}
          </div>
        </div>
        <div style={CS.card}>
          <div style={CS.sec}>Dividends by Sector</div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={sectorData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} labelLine={false} label={<PctLbl />}>
                {sectorData.map((_, i) => <Cell key={i} fill={DIV_COLORS[i % DIV_COLORS.length]} />)}
              </Pie>
              <Tooltip content={<CTip />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "8px" }}>
            {sectorData.map((s, i) => (
              <span key={s.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "10px", color: T.sub }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: DIV_COLORS[i % DIV_COLORS.length], display: "inline-block" }} />
                {s.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ ...CS.card, marginBottom: "18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
          <div style={CS.sec}>Holdings</div>
          <button style={btn(T.blue, "#fff")} onClick={() => setShowAdd(true)}>+ Add Holding</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: "660px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 55px 75px 60px 60px 75px 75px 80px 30px", gap: "8px", padding: "6px 0", borderBottom: `1px solid ${T.border}`, marginBottom: "6px" }}>
              {["Ticker","Name","Shares","Avg Cost","Live","Yield","$/Share","Annual","Div Growth",""].map(h => <div key={h} style={{ fontSize: "9px", color: T.sub, fontWeight: "700", textTransform: "uppercase" }}>{h}</div>)}
            </div>
            {holdings.map((h, i) => (
              <div key={h.id} style={{ display: "grid", gridTemplateColumns: "70px 1fr 55px 75px 60px 60px 75px 75px 80px 30px", gap: "8px", padding: "8px 0", borderBottom: `1px solid ${T.s1}`, alignItems: "center" }}>
                <div style={{ fontWeight: "800", fontSize: "12px", color: DIV_COLORS[i % DIV_COLORS.length], cursor: "pointer", textDecoration: "underline dotted" }} title="View dividend & appreciation analytics" onClick={() => setAnalyticsHolding(h)}>{h.ticker}</div>
                <div style={{ fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.name}
                  <button onClick={() => setAnalyticsHolding(h)} style={{ display: "block", background: "none", border: "none", padding: 0, marginTop: "2px", cursor: "pointer", fontFamily: "inherit", fontSize: "9px", fontWeight: "700", color: T.blue }}>Details →</button>
                </div>
                <div style={{ fontSize: "11px" }}>{h.shares}</div>
                <div style={{ fontSize: "11px", color: T.sub }}>{h.costBasis ? fmtD(h.costBasis) : "—"}</div>
                <div><LivePriceBadge symbol={h.ticker} /></div>
                <div style={{ fontSize: "11px", color: T.green }}>{h.yieldPct.toFixed(1)}%</div>
                <div style={{ fontSize: "11px" }}>{fmtD(h.annualDiv)}</div>
                <div style={{ fontSize: "11px", fontWeight: "700", color: T.green }}>{fmt(h.shares * h.annualDiv)}</div>
                <div style={{ fontSize: "11px", color: T.cyan }}>+{h.divGrowthRate.toFixed(1)}%/yr</div>
                <button onClick={() => removeHolding(h.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: "14px", padding: 0 }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showAdd && (
        <div style={CS.modalWrap} onClick={() => setShowAdd(false)}>
          <div style={CS.mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "6px" }}>Add Dividend Holding</div>
            <div style={{ fontSize: "11px", color: T.sub, marginBottom: "16px" }}>Type a ticker for known dividend payers — company, dividend, yield, and pay dates will autofill. Every field stays editable.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "8px" }}>
              <div><div style={CS.lbl}>Ticker</div><input style={CS.inp} placeholder="VYM" value={form.ticker} onChange={e => handleTickerChange(e.target.value)} /></div>
              <div><div style={CS.lbl}>Sector</div>
                <select style={CS.inp} value={form.sector} onChange={e => setForm({ ...form, sector: e.target.value })}>
                  {["ETF","REIT","Healthcare","Consumer","Financial","Energy","Technology","Utility","Other"].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {autofilled && (
              <div style={{ marginBottom: "12px", padding: "7px 11px", background: `${T.green}18`, border: `1px solid ${T.green}44`, borderRadius: "7px", fontSize: "10px", color: T.green, fontWeight: "700" }}>
                ✓ Auto-filled from reference data — adjust any field if your numbers differ.
              </div>
            )}
            <div style={{ marginBottom: "12px" }}><div style={CS.lbl}>Company Name</div><input style={CS.inp} placeholder="Vanguard High Dividend Yield" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div><div style={CS.lbl}>Shares</div><input style={CS.inp} type="number" placeholder="100" value={form.shares} onChange={e => setForm({ ...form, shares: e.target.value })} /></div>
              <div><div style={CS.lbl}>Avg Cost Basis ($/share)</div><input style={CS.inp} type="number" step="0.01" placeholder="72.50" value={form.costBasis} onChange={e => setForm({ ...form, costBasis: e.target.value })} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div><div style={CS.lbl}>Annual Div/Share ($)</div><input style={CS.inp} type="number" step="0.01" placeholder="3.84" value={form.annualDiv} onChange={e => setForm({ ...form, annualDiv: e.target.value })} /></div>
              <div><div style={CS.lbl}>Yield (%)</div><input style={CS.inp} type="number" step="0.1" placeholder="2.9" value={form.yieldPct} onChange={e => setForm({ ...form, yieldPct: e.target.value })} /></div>
            </div>
            <div style={{ marginBottom: "12px" }}><div style={CS.lbl}>Dividend Growth Rate (%/yr)</div><input style={CS.inp} type="number" step="0.1" placeholder="6.0" value={form.divGrowthRate} onChange={e => setForm({ ...form, divGrowthRate: e.target.value })} /></div>
            <div style={{ marginBottom: "12px" }}><div style={CS.lbl}>Pay Day(s) — comma separated</div><input style={CS.inp} placeholder="15" value={form.payDays.join(",")} onChange={e => setForm({ ...form, payDays: e.target.value.split(",").map(v => parseInt(v.trim())).filter(Boolean) })} /></div>
            <div style={{ marginBottom: "18px" }}>
              <div style={CS.lbl}>Pay Months</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "5px" }}>
                {MO.map((m, i) => (
                  <button key={i} onClick={() => setForm(f => ({ ...f, payMonths: f.payMonths.includes(i) ? f.payMonths.filter(x => x !== i) : [...f.payMonths, i].sort((a,b)=>a-b) }))}
                    style={{ padding: "4px 8px", borderRadius: "6px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", fontWeight: "700", background: form.payMonths.includes(i) ? T.green : T.s3, color: form.payMonths.includes(i) ? "#000" : T.sub }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setShowAdd(false)}>Cancel</button>
              <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={addHolding}>Add Holding</button>
            </div>
          </div>
        </div>
      )}

      {analyticsHolding && (
        <DividendAnalyticsModal holding={analyticsHolding} onClose={() => setAnalyticsHolding(null)} />
      )}
    </div>
  );
}

// ── CFP CONSULTATION SECTION ─────────────────────────────────────────────────
function CfpSection({ goals, retBal, projected, strat, yrsLeft }) {
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", preferredTime: "morning",
    meetingType: "video", topics: [], notes: "",
  });

  const topicOptions = [
    "Retirement income planning", "Investment strategy review",
    "Tax-efficient investing", "Social Security optimization",
    "Estate planning basics", "College funding strategy",
    "Insurance & risk management", "Debt payoff vs. investing",
  ];

  function toggleTopic(t) {
    setForm(f => ({ ...f, topics: f.topics.includes(t) ? f.topics.filter(x => x !== t) : [...f.topics, t] }));
  }
  function handleSubmit() {
    if (!form.name || !form.email) return;
    setSubmitted(true);
  }

  const gapAmt = Math.abs(projected - goals.nestEgg);
  const onTrack = projected >= goals.nestEgg;

  return (
    <>
      <div style={{ ...CS.card, marginTop: "18px", background: "linear-gradient(135deg,#0d1a35,#091428)", border: `1px solid ${T.blue}55`, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, right: 0, width: "200px", height: "200px", background: `radial-gradient(circle, ${T.blue}15, transparent 70%)`, pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "18px", flexWrap: "wrap" }}>
            <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: T.gradBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", flexShrink: 0 }}>👨‍💼</div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                <div style={{ fontWeight: "900", fontSize: "16px", color: T.text }}>Speak with a Certified Financial Planner</div>
                <span style={{ padding: "2px 8px", borderRadius: "20px", fontSize: "10px", fontWeight: "700", background: `${T.gold}22`, color: T.gold }}>CFP®</span>
              </div>
              <div style={{ fontSize: "12px", color: T.sub, lineHeight: "1.5", maxWidth: "480px" }}>
                Get personalized guidance from a fiduciary CFP® professional. They can review your {strat.l} strategy, {onTrack ? "help you optimize your surplus" : `close your ${fmt(gapAmt)} gap`}, and build a tailored retirement roadmap.
              </div>
              <div style={{ display: "flex", gap: "16px", marginTop: "8px", flexWrap: "wrap" }}>
                {["Fiduciary — your interests first", "Fee-only, no commissions", "First session free"].map(b => (
                  <span key={b} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: T.green }}><span>✓</span> {b}</span>
                ))}
              </div>
            </div>
          </div>
          <button onClick={() => { setShowModal(true); setStep(1); setSubmitted(false); }}
            style={{ padding: "12px 24px", borderRadius: "10px", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: "800", fontSize: "13px", background: T.gradBlue, color: "#fff", whiteSpace: "nowrap", flexShrink: 0 }}>
            Schedule a Consultation →
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginTop: "20px" }}>
          {[
            { name: "Sarah Mitchell, CFP®", specialty: "Retirement & Income", exp: "18 yrs", rating: "4.9", img: "SM", avail: "Next: Mon 9am" },
            { name: "David Chen, CFP®",     specialty: "Tax-Efficient Investing", exp: "14 yrs", rating: "4.8", img: "DC", avail: "Next: Tue 2pm" },
            { name: "Priya Patel, CFP®",    specialty: "Family Wealth Planning", exp: "11 yrs", rating: "5.0", img: "PP", avail: "Next: Wed 10am" },
          ].map(p => (
            <div key={p.name} style={{ background: T.s1, borderRadius: "12px", padding: "14px 16px", border: `1px solid ${T.border}`, display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: T.gradBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "800", color: "#fff", flexShrink: 0 }}>{p.img}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: "700", fontSize: "12px", color: T.text, marginBottom: "2px" }}>{p.name}</div>
                <div style={{ fontSize: "10px", color: T.sub, marginBottom: "4px" }}>{p.specialty}</div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
                  <span style={{ fontSize: "10px", color: T.sub }}>{p.exp} exp</span>
                  <span style={{ fontSize: "10px", color: T.gold }}>★ {p.rating}</span>
                </div>
                <div style={{ fontSize: "10px", color: T.green, fontWeight: "700" }}>{p.avail}</div>
                <button onClick={() => { setShowModal(true); setStep(1); setSubmitted(false); }}
                  style={{ marginTop: "8px", padding: "5px 12px", borderRadius: "6px", border: `1px solid ${T.blue}55`, background: `${T.blue}18`, color: T.blue, fontFamily: "inherit", fontSize: "10px", fontWeight: "700", cursor: "pointer", width: "100%" }}>
                  Book with {p.name.split(" ")[0]}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showModal && (
        <div style={CS.modalWrap} onClick={() => setShowModal(false)}>
          <div style={{ ...CS.mbox, width: "500px", maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            {submitted ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: "56px", marginBottom: "16px" }}>🎉</div>
                <div style={{ fontWeight: "900", fontSize: "20px", color: T.green, marginBottom: "8px" }}>You're booked!</div>
                <div style={{ fontSize: "13px", color: T.sub, lineHeight: "1.7", marginBottom: "20px" }}>
                  A confirmation has been sent to <strong style={{ color: T.text }}>{form.email}</strong>.<br />
                  Your CFP® advisor will reach out within 24 hours.
                </div>
                <div style={{ background: T.s1, borderRadius: "12px", padding: "16px", marginBottom: "20px", textAlign: "left" }}>
                  <div style={{ fontSize: "10px", color: T.sub, fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px" }}>Consultation Summary</div>
                  {[["Name", form.name], ["Email", form.email], ["Meeting Type", form.meetingType === "video" ? "Video Call" : form.meetingType === "phone" ? "Phone Call" : "In-Person"], ["Preferred Time", form.preferredTime.charAt(0).toUpperCase() + form.preferredTime.slice(1)]].map(([l, v]) => (
                    <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontSize: "12px", color: T.sub }}>{l}</span>
                      <span style={{ fontSize: "12px", color: T.text, fontWeight: "600" }}>{v}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowModal(false)} style={{ ...btn(T.blue, "#fff"), width: "100%", padding: "11px" }}>Done</button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "22px", flexWrap: "wrap" }}>
                  {[1, 2, 3].map(n => (
                    <div key={n} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: step >= n ? T.blue : T.s3, color: step >= n ? "#fff" : T.sub, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "800", flexShrink: 0 }}>{n}</div>
                      <span style={{ fontSize: "11px", color: step === n ? T.text : T.sub, fontWeight: step === n ? "700" : "400" }}>{["Your Info", "Meeting Prefs", "Topics"][n-1]}</span>
                      {n < 3 && <div style={{ width: "20px", height: "1px", background: T.border }} />}
                    </div>
                  ))}
                </div>

                {step === 1 && (
                  <div>
                    <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "18px" }}>Schedule a CFP® Consultation</div>
                    <div style={{ marginBottom: "13px" }}><div style={CS.lbl}>Full Name</div><input style={CS.inp} placeholder="Jane Smith" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                    <div style={{ marginBottom: "13px" }}><div style={CS.lbl}>Email Address</div><input style={CS.inp} type="email" placeholder="jane@email.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                    <div style={{ marginBottom: "18px" }}><div style={CS.lbl}>Phone (optional)</div><input style={CS.inp} type="tel" placeholder="(555) 000-0000" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setShowModal(false)}>Cancel</button>
                      <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={() => { if (form.name && form.email) setStep(2); }}>Next →</button>
                    </div>
                  </div>
                )}
                {step === 2 && (
                  <div>
                    <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "18px" }}>Meeting Preferences</div>
                    <div style={{ marginBottom: "16px" }}>
                      <div style={CS.lbl}>Meeting Type</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px,1fr))", gap: "8px", marginTop: "6px" }}>
                        {[["video","📹 Video Call"],["phone","📞 Phone Call"],["inperson","🏢 In-Person"]].map(([val, label]) => (
                          <button key={val} onClick={() => setForm({ ...form, meetingType: val })}
                            style={{ padding: "10px 8px", borderRadius: "8px", border: `2px solid ${form.meetingType === val ? T.blue : T.border}`, background: form.meetingType === val ? `${T.blue}22` : T.s1, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: "700", color: form.meetingType === val ? T.blue : T.sub, textAlign: "center" }}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginBottom: "18px" }}>
                      <div style={CS.lbl}>Additional Notes</div>
                      <textarea style={{ ...CS.inp, height: "80px", resize: "vertical", marginTop: "4px" }} placeholder="Anything specific to discuss…" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}></textarea>
                    </div>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setStep(1)}>← Back</button>
                      <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={() => setStep(3)}>Next →</button>
                    </div>
                  </div>
                )}
                {step === 3 && (
                  <div>
                    <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "6px" }}>What would you like to discuss?</div>
                    <div style={{ fontSize: "12px", color: T.sub, marginBottom: "16px" }}>Select all that apply.</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: "8px", marginBottom: "18px" }}>
                      {topicOptions.map(t => {
                        const sel = form.topics.includes(t);
                        return (
                          <button key={t} onClick={() => toggleTopic(t)}
                            style={{ padding: "10px 12px", borderRadius: "8px", border: `2px solid ${sel ? T.green : T.border}`, background: sel ? `${T.green}18` : T.s1, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: "600", color: sel ? T.green : T.sub, textAlign: "left", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ width: "14px", height: "14px", borderRadius: "3px", border: `2px solid ${sel ? T.green : T.border}`, background: sel ? T.green : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "9px", color: "#000" }}>{sel ? "✓" : ""}</span>
                            {t}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setStep(2)}>← Back</button>
                      <button style={{ ...btn(T.green, "#000"), flex: 1, fontWeight: "800" }} onClick={handleSubmit}>Book Free Consultation ✓</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── GENERIC PERSISTED-JSON HOOK — backs Rules, Members, and Preferences below ─
function usePersistedJSON(key, defaultValue) {
  const [value, setValue] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!window.storage) { setLoaded(true); return; }
    window.storage.get(key, false)
      .then(r => { if (!cancelled && r && r.value) setValue(JSON.parse(r.value)); })
      .catch(() => {}) // no saved value yet — default stands
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [key]);
  async function update(next) {
    setValue(next);
    if (window.storage) { try { await window.storage.set(key, JSON.stringify(next), false); } catch {} }
  }
  return [value, update, loaded];
}

// ── NOTIFICATIONS — bell icon destination inside the slide-out menu ─────────
// Derived entirely from data already in the app (bills due soon, upcoming
// ex-dividend dates, high credit utilization) rather than a separate
// notifications backend — there's nothing to sync, so this is always current.
function NotificationsModal({ recurring, divHoldings, liabilities, onClose }) {
  const now = new Date();
  const items = useMemo(() => {
    const out = [];
    const todayDay = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    recurring.filter(r => r.active && r.type === "expense").forEach(r => {
      let daysUntil = r.day - todayDay;
      if (daysUntil < 0) daysUntil += daysInMonth;
      if (daysUntil <= 7) {
        out.push({ icon: "📅", title: `${r.desc} due ${daysUntil === 0 ? "today" : `in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`}`, sub: fmtD(-Math.abs(r.amt)), sort: daysUntil });
      }
    });

    if (divHoldings && divHoldings.length > 0) {
      upcomingExDates(divHoldings, now, 5).forEach(e => {
        const daysUntil = Math.round((e.date - now) / 86400000);
        if (daysUntil <= 7) {
          out.push({ icon: "💰", title: `${e.ticker} goes ex-dividend ${daysUntil <= 0 ? "today" : `in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`}`, sub: `Est. ${fmtD(e.amount)}`, sort: daysUntil });
        }
      });
    }

    liabilities.filter(l => l.type === "credit_card" && l.originalAmt > 0).forEach(l => {
      const util = (l.currentBal / l.originalAmt) * 100;
      if (util >= 70) out.push({ icon: "⚠️", title: `${l.name} is ${Math.round(util)}% utilized`, sub: "High utilization can affect your credit score", sort: -1 });
    });

    return out.sort((a, b) => a.sort - b.sort);
  }, [recurring, divHoldings, liabilities]);

  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "420px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "16px" }}>🔔 Notifications</div>
        {items.length === 0 && <Empty icon="🔔" text="You're all caught up — no bills, dividends, or credit alerts in the next week." />}
        {items.map((n, i) => (
          <div key={i} style={{ display: "flex", gap: "12px", padding: "10px 0", borderBottom: `1px solid ${T.s1}` }}>
            <span style={{ fontSize: "18px" }}>{n.icon}</span>
            <div><div style={{ fontSize: "12px", fontWeight: "700" }}>{n.title}</div><div style={{ fontSize: "10px", color: T.sub }}>{n.sub}</div></div>
          </div>
        ))}
        <button style={{ ...btn(T.s3), width: "100%", marginTop: "16px" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── CATEGORIES — browse the app's income/expense category taxonomy ─────────
function CategoriesModal({ onClose }) {
  const [tab, setTab] = useState("expense");
  const [q, setQ] = useState("");
  const list = (tab === "income" ? INC : EXP).filter(c => c.l.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "420px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "12px" }}>Categories</div>
        <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
          <button style={{ ...stab(tab === "income"), flex: 1 }} onClick={() => setTab("income")}>Income</button>
          <button style={{ ...stab(tab === "expense"), flex: 1 }} onClick={() => setTab("expense")}>Expense</button>
        </div>
        <input style={{ ...CS.inp, marginBottom: "10px" }} placeholder="Search categories…" value={q} onChange={e => setQ(e.target.value)} />
        {list.map(c => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 0", borderBottom: `1px solid ${T.s1}` }}>
            <span style={{ width: "30px", height: "30px", borderRadius: "8px", background: `${c.c}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px" }}>{c.i}</span>
            <span style={{ fontSize: "12px", fontWeight: "600" }}>{c.l}</span>
          </div>
        ))}
        <button style={{ ...btn(T.s3), width: "100%", marginTop: "16px" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── PREFERENCES ──────────────────────────────────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: "40px", height: "22px", borderRadius: "11px", border: "none", cursor: "pointer", background: on ? T.green : T.s3, position: "relative", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: "2px", left: on ? "20px" : "2px", width: "18px", height: "18px", borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
    </button>
  );
}

function PreferencesModal({ prefs, setPrefs, onClose }) {
  const [chatCleared, setChatCleared] = useState(false);
  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "440px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "16px" }}>Preferences</div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.s1}` }}>
          <div style={{ paddingRight: "12px" }}>
            <div style={{ fontSize: "12px", fontWeight: "700" }}>Mark uncategorized transactions as Needs Review</div>
            <div style={{ fontSize: "10px", color: T.sub, marginTop: "2px" }}>Flags any transaction still in "Other" so it's easy to find and fix.</div>
          </div>
          <Toggle on={!!prefs.markUncategorizedReview} onChange={v => setPrefs({ ...prefs, markUncategorizedReview: v })} />
        </div>

        <div style={{ fontSize: "10px", color: T.sub, letterSpacing: "1px", textTransform: "uppercase", fontWeight: "700", margin: "16px 0 6px" }}>AI Assistant</div>
        <div style={{ fontSize: "11px", color: T.text, lineHeight: "1.6", marginBottom: "10px" }}>
          The AI Assistant helps you explore and understand your finances through interactive chat, powered by Claude. Your data stays private and is used only to answer your questions.
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.s1}` }}>
          <div style={{ fontSize: "12px", fontWeight: "700" }}>Enable AI Assistant</div>
          <Toggle on={prefs.enableAiAssistant !== false} onChange={v => setPrefs({ ...prefs, enableAiAssistant: v })} />
        </div>
        <button
          style={{ ...btn(T.s3), width: "100%", marginTop: "10px", color: chatCleared ? T.green : T.text }}
          onClick={() => setChatCleared(true)}
        >
          {chatCleared ? "✓ Chat history cleared" : "Delete my chat history"}
        </button>
        <div style={{ fontSize: "9px", color: T.sub, marginTop: "6px" }}>Note: chat history isn't saved between sessions in this app, so there's nothing stored to delete beyond the current conversation.</div>

        <button style={{ ...btn(T.blue, "#fff"), width: "100%", marginTop: "18px" }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

// ── RULES — custom merchant → category mappings, applied to future Plaid syncs ─
function RulesModal({ rules, setRules, onClose }) {
  const [matchText, setMatchText] = useState("");
  const [cat, setCat] = useState("other_exp");

  function addRule() {
    if (!matchText.trim()) return;
    setRules([...rules, { id: uid(), matchText: matchText.trim(), cat }]);
    setMatchText("");
  }
  function removeRule(id) { setRules(rules.filter(r => r.id !== id)); }

  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "440px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "4px" }}>Rules</div>
        <div style={{ fontSize: "10px", color: T.sub, marginBottom: "16px" }}>When a synced transaction's merchant contains this text, it's auto-categorized. Applied on every future "Sync Transactions".</div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <input style={{ ...CS.inp, flex: 1 }} placeholder="Merchant contains…" value={matchText} onChange={e => setMatchText(e.target.value)} />
          <select style={{ ...CS.inp, width: "130px" }} value={cat} onChange={e => setCat(e.target.value)}>
            {ALL_CATS.map(c => <option key={c.id} value={c.id}>{c.i} {c.l}</option>)}
          </select>
          <button style={btn(T.blue, "#fff")} onClick={addRule}>Add</button>
        </div>

        {rules.length === 0 && <Empty icon="≫" text="No rules yet — add one above, or create one from the Merchants screen." />}
        {rules.map(r => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.s1}` }}>
            <div style={{ fontSize: "12px" }}>"{r.matchText}" → {gc(r.cat).i} {gc(r.cat).l}</div>
            <button onClick={() => removeRule(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: "13px" }}>✕</button>
          </div>
        ))}
        <button style={{ ...btn(T.s3), width: "100%", marginTop: "16px" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── MERCHANTS — spend aggregated by merchant, with a quick path to a Rule ───
function MerchantsModal({ txns, rules, setRules, onClose }) {
  const merchants = useMemo(() => {
    const m = {};
    txns.filter(t => t.amt < 0).forEach(t => {
      const name = t.desc || "Unknown";
      if (!m[name]) m[name] = { name, count: 0, total: 0 };
      m[name].count += 1;
      m[name].total += Math.abs(t.amt);
    });
    return Object.values(m).sort((a, b) => b.total - a.total).slice(0, 30);
  }, [txns]);

  function setDefaultCategory(name, cat) {
    const existing = rules.find(r => r.matchText.toLowerCase() === name.toLowerCase());
    if (existing) setRules(rules.map(r => r.id === existing.id ? { ...r, cat } : r));
    else setRules([...rules, { id: uid(), matchText: name, cat }]);
  }

  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "460px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "4px" }}>Merchants</div>
        <div style={{ fontSize: "10px", color: T.sub, marginBottom: "16px" }}>Top merchants by spend. Setting a default category here creates or updates a Rule.</div>
        {merchants.length === 0 && <Empty icon="🏢" text="No expense transactions yet." />}
        {merchants.map(m => {
          const rule = rules.find(r => r.matchText.toLowerCase() === m.name.toLowerCase());
          return (
            <div key={m.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${T.s1}`, gap: "10px" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "12px", fontWeight: "700", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                <div style={{ fontSize: "10px", color: T.sub }}>{m.count} transaction{m.count === 1 ? "" : "s"} · {fmt(m.total)}</div>
              </div>
              <select style={{ ...CS.inp, width: "130px" }} value={rule ? rule.cat : ""} onChange={e => setDefaultCategory(m.name, e.target.value)}>
                <option value="" disabled>Set category…</option>
                {EXP.map(c => <option key={c.id} value={c.id}>{c.i} {c.l}</option>)}
              </select>
            </div>
          );
        })}
        <button style={{ ...btn(T.s3), width: "100%", marginTop: "16px" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── MEMBERS — lightweight household member list (no auth/permissions) ──────
// A starting point, not a full multi-user system: this app has a single
// profile and a single local session, so "members" here is a shared list
// of names for your own reference (e.g. who a bill belongs to), not
// separate logins or access control.
function MembersModal({ members, setMembers, onClose }) {
  const [name, setName] = useState("");
  function add() {
    if (!name.trim()) return;
    setMembers([...members, { id: uid(), name: name.trim() }]);
    setName("");
  }
  return (
    <div style={CS.modalWrap} onClick={onClose}>
      <div style={{ ...CS.mbox, width: "380px" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "4px" }}>Household Members</div>
        <div style={{ fontSize: "10px", color: T.sub, marginBottom: "16px" }}>A shared reference list — not separate logins or permissions.</div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <input style={{ ...CS.inp, flex: 1 }} placeholder="Name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
          <button style={btn(T.blue, "#fff")} onClick={add}>Add</button>
        </div>
        {members.length === 0 && <Empty icon="👥" text="No members added yet." />}
        {members.map(m => (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.s1}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ width: "28px", height: "28px", borderRadius: "50%", background: T.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "800", color: "#fff" }}>{m.name[0].toUpperCase()}</span>
              <span style={{ fontSize: "12px", fontWeight: "600" }}>{m.name}</span>
            </div>
            <button onClick={() => setMembers(members.filter(x => x.id !== m.id))} style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: "13px" }}>✕</button>
          </div>
        ))}
        <button style={{ ...btn(T.s3), width: "100%", marginTop: "16px" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── SLIDE-OUT SIDE MENU ──────────────────────────────────────────────────────
function SideMenuRow({ icon, label, badge, onClick }) {
  return (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: "14px", width: "100%", padding: "12px 20px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
      <span style={{ fontSize: "17px", width: "22px", textAlign: "center" }}>{icon}</span>
      <span style={{ fontSize: "14px", fontWeight: "600", color: T.text, flex: 1 }}>{label}</span>
      {badge && <span style={{ fontSize: "9px", fontWeight: "800", padding: "2px 8px", borderRadius: "10px", background: T.gradGold, color: "#1a1200" }}>{badge}</span>}
    </button>
  );
}

function SideMenu({ open, onClose, profileFirstName, notifCount, aiEnabled, onNav }) {
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 199, opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity .25s" }}
        onClick={onClose}
      />
      <div style={{
        position: "fixed", top: 0, left: 0, bottom: 0, width: "280px", maxWidth: "84vw", background: T.s1, zIndex: 200,
        transform: open ? "translateX(0)" : "translateX(-100%)", transition: "transform .25s ease", overflowY: "auto",
        borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <MMMLogo size={26} />
            <span style={{ fontSize: "13px", fontWeight: "900", letterSpacing: "1px" }}>MMM</span>
          </div>
          <button onClick={() => onNav("preferences")} style={{ background: "none", border: "none", cursor: "pointer", color: T.sub, fontSize: "18px" }}>⚙️</button>
        </div>

        <div style={{ fontSize: "10px", color: T.sub, letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: "700", padding: "10px 20px 4px" }}>More Features</div>
        <SideMenuRow icon="📅" label="Recurring" onClick={() => onNav("recurring")} />
        <SideMenuRow icon="🎯" label="Goals" onClick={() => onNav("goals")} />
        <SideMenuRow icon="📈" label="Investments" onClick={() => onNav("investments")} />

        <div style={{ fontSize: "10px", color: T.sub, letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: "700", padding: "16px 20px 4px" }}>Your Household</div>
        <SideMenuRow icon="👥" label="Members" onClick={() => onNav("members")} />
        <SideMenuRow icon="🧾" label="Receipts" badge="New" onClick={() => onNav("receipts")} />
        <SideMenuRow icon="🔗" label="Synced Accounts" onClick={() => onNav("synced")} />
        <SideMenuRow icon="▦" label="Categories" onClick={() => onNav("categories")} />
        <SideMenuRow icon="☰" label="Preferences" onClick={() => onNav("preferences")} />
        <SideMenuRow icon="≫" label="Rules" onClick={() => onNav("rules")} />
        <SideMenuRow icon="🏢" label="Merchants" onClick={() => onNav("merchants")} />

        <div style={{ borderTop: `1px solid ${T.border}`, margin: "12px 0" }} />
        <SideMenuRow icon="🔔" label="Notifications" badge={notifCount > 0 ? String(notifCount) : null} onClick={() => onNav("notifications")} />
        {aiEnabled && <SideMenuRow icon="✨" label="AI Assistant" onClick={() => onNav("ai")} />}
        <SideMenuRow icon="🤍" label="Invite a friend" onClick={() => onNav("invite")} />

        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "16px 20px", borderTop: `1px solid ${T.border}` }}>
          <span style={{ width: "32px", height: "32px", borderRadius: "50%", background: T.gradBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "800", color: "#fff" }}>
            {(profileFirstName || "U")[0].toUpperCase()}
          </span>
          <span style={{ fontSize: "13px", fontWeight: "700" }}>{profileFirstName || "You"}</span>
        </div>
      </div>
    </>
  );
}

// ── BOTTOM TAB BAR ────────────────────────────────────────────────────────────
const NAV_ICONS = { dashboard: "🏠", goals: "🎯", retirement: "📈", liabilities: "💳", accounts: "🗂️", transactions: "📋" };

function BottomTabBar({ NAV, view, setView, isPro, setActiveModal }) {
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, background: T.s1, borderTop: `1px solid ${T.border}`,
      display: "flex", zIndex: 50, paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      {NAV.map(([v, l]) => {
        const active = view === v;
        const locked = v === "retirement" && !isPro;
        return (
          <button
            key={v}
            onClick={() => { if (locked) { setActiveModal("paywall"); return; } setView(v); }}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", padding: "8px 2px 6px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
          >
            <span style={{ fontSize: "18px", opacity: active ? 1 : 0.55 }}>{NAV_ICONS[v] || "•"}{locked ? "🔒" : ""}</span>
            <span style={{ fontSize: "9px", fontWeight: active ? "800" : "600", color: active ? T.blue : T.sub }}>{l}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── ONBOARDING FLOW ────────────────────────────────────────────────────────────
// A guided, ~90-second setup: identity → pay → a few recurring bills.
// Every answer here feeds directly into the completeness score, so the
// health gauge on the dashboard becomes meaningful almost immediately
// instead of showing a flattering score built on zero real data.
function OnboardingFlow({ onComplete }) {
  const [step, setStep] = useState(1);
  const totalSteps = 4;

  const [profile, setProfile] = useState({ ...BLANK_PROFILE });
  const [recSeed, setRecSeed] = useState([
    { id: uid(), type: "expense", cat: "housing",   desc: "Rent / Mortgage", amt: "", day: "1",  active: true, include: true  },
    { id: uid(), type: "expense", cat: "utilities", desc: "Utilities",      amt: "", day: "5",  active: true, include: false },
    { id: uid(), type: "expense", cat: "groceries", desc: "Groceries",      amt: "", day: "1",  active: true, include: false },
    { id: uid(), type: "expense", cat: "transport", desc: "Car Payment",    amt: "", day: "1",  active: true, include: false },
    { id: uid(), type: "expense", cat: "insurance", desc: "Insurance",      amt: "", day: "1",  active: true, include: false },
  ]);

  const canAdvance = {
    1: profile.firstName.trim().length > 0 && profile.email.trim().length > 3,
    2: profile.payFrequency && parseFloat(profile.takeHomePerPeriod) > 0,
    3: true, // bills are optional — partial info still advances, just scores lower
    4: true,
  }[step];

  function finish() {
    const income = { id: uid(), type: "income", cat: "salary", desc: "Paycheck", amt: parseFloat(profile.takeHomePerPeriod) || 0, day: "1", active: true };
    const bills = recSeed.filter(r => r.include && parseFloat(r.amt) > 0).map(r => ({
      id: r.id, type: r.type, cat: r.cat, desc: r.desc, amt: parseFloat(r.amt), day: parseInt(r.day) || 1, active: true,
    }));
    onComplete({ profile, recurring: [income, ...bills] });
  }

  const stepBar = (
    <div style={{ display: "flex", gap: "6px", marginBottom: "24px" }}>
      {Array.from({ length: totalSteps }, (_, i) => (
        <div key={i} style={{ flex: 1, height: "4px", borderRadius: "2px", background: i < step ? T.blue : T.border }} />
      ))}
    </div>
  );

  return (
    <div style={{ fontFamily: "'Trebuchet MS',Tahoma,Geneva,Verdana,sans-serif", background: T.bg, minHeight: "100vh", color: T.text, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", boxSizing: "border-box" }}>
      <div style={{ width: "480px", maxWidth: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "10px" }}><MMMLogo size={44} /></div>
          <div style={{ fontSize: "22px", fontWeight: "900", letterSpacing: "1px" }}>Welcome to Mindful Money Management</div>
          <div style={{ fontSize: "12px", color: T.sub, marginTop: "6px" }}>About 90 seconds to set up — you can always add more later.</div>
        </div>

        <div style={{ ...CS.card, padding: "28px 24px" }}>
          {stepBar}

          {step === 1 && (
            <div>
              <div style={{ fontSize: "16px", fontWeight: "800", marginBottom: "4px" }}>Let's start with you</div>
              <div style={{ fontSize: "11px", color: T.sub, marginBottom: "18px" }}>This creates your private account — only you can see this data.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                <div><div style={CS.lbl}>First Name</div><input style={CS.inp} value={profile.firstName} onChange={e => setProfile({ ...profile, firstName: e.target.value })} placeholder="Jamie" /></div>
                <div><div style={CS.lbl}>Last Name</div><input style={CS.inp} value={profile.lastName} onChange={e => setProfile({ ...profile, lastName: e.target.value })} placeholder="Rivera" /></div>
              </div>
              <div style={{ marginBottom: "12px" }}><div style={CS.lbl}>Email</div><input style={CS.inp} type="email" value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} placeholder="jamie@email.com" /></div>
              <div style={{ marginBottom: "6px" }}>
                <div style={CS.lbl}>State</div>
                <select style={CS.inp} value={profile.state} onChange={e => setProfile({ ...profile, state: e.target.value })}>
                  <option value="">Select…</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ fontSize: "16px", fontWeight: "800", marginBottom: "4px" }}>How do you get paid?</div>
              <div style={{ fontSize: "11px", color: T.sub, marginBottom: "18px" }}>This becomes your recurring income — the base of your health score.</div>
              <div style={{ marginBottom: "14px" }}>
                <div style={CS.lbl}>Pay Frequency</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "8px", marginTop: "6px" }}>
                  {PAY_FREQ.map(f => (
                    <button key={f.id} onClick={() => setProfile({ ...profile, payFrequency: f.id })}
                      style={{ padding: "10px", borderRadius: "8px", border: `2px solid ${profile.payFrequency === f.id ? T.blue : T.border}`, background: profile.payFrequency === f.id ? `${T.blue}22` : T.s1, cursor: "pointer", fontFamily: "inherit", fontSize: "12px", fontWeight: "700", color: profile.payFrequency === f.id ? T.blue : T.sub }}>
                      {f.l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={CS.lbl}>Take-Home Pay (per paycheck, after taxes)</div>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: T.sub, fontSize: "13px" }}>$</span>
                  <input style={{ ...CS.inp, paddingLeft: "22px" }} type="number" value={profile.takeHomePerPeriod} onChange={e => setProfile({ ...profile, takeHomePerPeriod: e.target.value })} placeholder="1800" />
                </div>
                {profile.payFrequency && parseFloat(profile.takeHomePerPeriod) > 0 && (
                  <div style={{ marginTop: "8px", fontSize: "11px", color: T.green }}>
                    ≈ {fmt(parseFloat(profile.takeHomePerPeriod) * getFreq(profile.payFrequency).perYear / 12)}/month
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div style={{ fontSize: "16px", fontWeight: "800", marginBottom: "4px" }}>A few recurring bills</div>
              <div style={{ fontSize: "11px", color: T.sub, marginBottom: "18px" }}>Toggle on what applies and fill in the amount. Skip what you don't know yet.</div>
              {recSeed.map(r => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: `1px solid ${T.border}` }}>
                  <button onClick={() => setRecSeed(p => p.map(x => x.id === r.id ? { ...x, include: !x.include } : x))}
                    style={{ width: "20px", height: "20px", borderRadius: "5px", border: `2px solid ${r.include ? T.green : T.border}`, background: r.include ? T.green : "transparent", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "#000" }}>
                    {r.include ? "✓" : ""}
                  </button>
                  <span style={{ fontSize: "13px", flex: 1, color: r.include ? T.text : T.sub }}>{gc(r.cat).i} {r.desc}</span>
                  <div style={{ position: "relative", width: "110px" }}>
                    <span style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: T.sub, fontSize: "11px" }}>$</span>
                    <input style={{ ...CS.inp, paddingLeft: "18px", opacity: r.include ? 1 : 0.4 }} type="number" placeholder="0" value={r.amt} disabled={!r.include}
                      onChange={e => setRecSeed(p => p.map(x => x.id === r.id ? { ...x, amt: e.target.value } : x))} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 4 && (
            <div>
              <div style={{ fontSize: "16px", fontWeight: "800", marginBottom: "4px" }}>You're set up 🎉</div>
              <div style={{ fontSize: "11px", color: T.sub, marginBottom: "18px" }}>Here's what we've got so far. Add more anytime — accounts, liabilities, insurance, and goals all improve your health score.</div>
              <div style={{ background: T.s1, borderRadius: "10px", padding: "14px 16px" }}>
                {[
                  ["Name", `${profile.firstName} ${profile.lastName}`.trim() || "—"],
                  ["Email", profile.email || "—"],
                  ["State", profile.state || "—"],
                  ["Pay Frequency", getFreq(profile.payFrequency).l],
                  ["Take-Home / Paycheck", fmtD(parseFloat(profile.takeHomePerPeriod) || 0)],
                  ["Bills Added", `${recSeed.filter(r => r.include && parseFloat(r.amt) > 0).length}`],
                ].map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ fontSize: "12px", color: T.sub }}>{l}</span>
                    <span style={{ fontSize: "12px", color: T.text, fontWeight: "700" }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "14px", padding: "10px 14px", background: `${T.gold}12`, borderRadius: "8px", fontSize: "11px", color: T.sub, lineHeight: "1.6" }}>
                💡 Your health score starts modest with partial data and rises automatically as you add accounts, liabilities, and insurance — it rewards a complete picture, not just good numbers.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "10px", marginTop: "22px" }}>
            {step > 1 && <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setStep(s => s - 1)}>← Back</button>}
            {step < totalSteps && <button style={{ ...btn(T.blue, "#fff"), flex: 2 }} disabled={!canAdvance} onClick={() => setStep(s => s + 1)}>{step === 3 ? "Continue" : "Next →"}</button>}
            {step === totalSteps && <button style={{ ...btn(T.green, "#000"), flex: 2, fontWeight: "800" }} onClick={finish}>Go to Dashboard →</button>}
          </div>
          {step === 1 && <div style={{ textAlign: "center", marginTop: "10px" }}><button onClick={finish} style={{ background: "none", border: "none", color: T.sub, fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>Skip setup for now</button></div>}
        </div>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  // ── Load gate: read all persisted state once on mount ──────────────────────
  const [loaded, setLoaded] = useState(false);
  const [onboarded, setOnboarded] = useState(false);

  const [profile,     setProfile]     = useState({ ...BLANK_PROFILE });
  const [accounts,    setAccounts]    = useState([]);
  const [txns,        setTxns]        = useState([]);
  const [recurring,   setRecurring]   = useState([]);
  const [liabilities, setLiabilities] = useState([]);
  const [divHoldings, setDivHoldings] = useState([]);
  const [goals,       setGoals]       = useState({ ...BLANK_GOALS });
  const [insurance,   setInsurance]   = useState({ ...BLANK_INSURANCE });
  const [isPro,       setIsPro]       = useState(false);

  const [view,         setView]         = useState("dashboard");
  const [activeModal,  setActiveModal]  = useState(null);
  const [selAcct,      setSelAcct]      = useState(null);
  const [editGoals,    setEditGoals]    = useState(false);
  const [goalDraft,    setGoalDraft]    = useState(BLANK_GOALS);
  const [budgetDraft,  setBudgetDraft]  = useState({});
  const [showBudgets,  setShowBudgets]  = useState(false);
  const [txnTab,       setTxnTab]       = useState("all");
  const [showAI,       setShowAI]       = useState(false);
  const [showRecModal, setShowRecModal] = useState(false);
  const [retTab,        setRetTab]       = useState("overview");
  const [showInsurance, setShowInsurance] = useState(false);
  const [insuranceDraft, setInsuranceDraft] = useState({ ...BLANK_INSURANCE });
  const [showDocAnalyzer, setShowDocAnalyzer] = useState(false);
  const { pref: themePref, setPref: setThemePref } = useThemePreference();
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerAcked, setDisclaimerAcked] = useState(true); // assume acked until load says otherwise, to avoid a flash on every visit

  useEffect(() => {
    if (!window.storage) return;
    window.storage.get("disclaimerAcknowledged", false)
      .then(r => { if (!r || r.value !== "true") { setDisclaimerAcked(false); setShowDisclaimer(true); } })
      .catch(() => { setDisclaimerAcked(false); setShowDisclaimer(true); }); // no record yet — treat as unacknowledged
  }, []);

  async function acknowledgeDisclaimer() {
    setShowDisclaimer(false);
    setDisclaimerAcked(true);
    if (window.storage) { try { await window.storage.set("disclaimerAcknowledged", "true", false); } catch {} }
  }

  // ── Slide-out menu + its destination screens ────────────────────────────
  const [showMenu, setShowMenu] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showMerchants, setShowMerchants] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [customRules, setCustomRules] = usePersistedJSON("customCategoryRules", []);
  const [householdMembers, setHouseholdMembers] = usePersistedJSON("householdMembers", []);
  const [appPrefs, setAppPrefs] = usePersistedJSON("appPreferences", { markUncategorizedReview: false, enableAiAssistant: true });

  function openAI() {
    if (appPrefs.enableAiAssistant === false) { setShowPreferences(true); return; }
    setShowAI(true);
  }

  function handleMenuNav(dest) {
    setShowMenu(false);
    if (dest === "recurring") setShowRecModal(true);
    else if (dest === "goals") setView("goals");
    else if (dest === "investments") setView("retirement");
    else if (dest === "members") setShowMembers(true);
    else if (dest === "receipts") setShowReceipts(true);
    else if (dest === "synced") setView("accounts");
    else if (dest === "categories") setShowCategories(true);
    else if (dest === "preferences") setShowPreferences(true);
    else if (dest === "rules") setShowRules(true);
    else if (dest === "merchants") setShowMerchants(true);
    else if (dest === "notifications") setShowNotifications(true);
    else if (dest === "ai") openAI();
    else if (dest === "invite") { if (navigator.share) navigator.share({ title: "Mindful Money Management", text: "Join me on Mindful Money Management!" }).catch(() => {}); }
  }

  // A receipt is always an expense against a real account/liability — reuses
  // the same balance-effect logic as a manually entered transaction.
  function addReceiptTransaction(fields) {
    const t = { id: uid(), aId: fields.aId, cat: fields.cat, catNote: fields.catNote || "", desc: fields.desc, amt: fields.amt, date: fields.date, rec: false, fromReceipt: true };
    setTxns(p => [t, ...p]);
    applyTxnEffect(fields.aId, fields.amt, setAccounts, setLiabilities);
  }

  // Quick count for the header bell badge — same signals as NotificationsModal,
  // kept intentionally lightweight here (no ex-dividend lookup) since it only
  // needs to answer "is there anything new", not enumerate every item.
  // IMPORTANT: this must stay above the loading/onboarding early returns
  // below — a hook placed after a conditional return gets skipped on some
  // renders and not others, which is exactly what triggers React error #310
  // ("rendered more hooks than during the previous render").
  const notifCount = useMemo(() => {
    const now = new Date();
    const todayDay = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    let n = 0;
    recurring.filter(r => r.active && r.type === "expense").forEach(r => {
      let d = r.day - todayDay; if (d < 0) d += daysInMonth;
      if (d <= 7) n++;
    });
    liabilities.filter(l => l.type === "credit_card" && l.originalAmt > 0 && (l.currentBal / l.originalAmt) >= 0.7).forEach(() => n++);
    return n;
  }, [recurring, liabilities]);

  const blankTxn  = { aId: "", desc: "", amt: "", type: "expense", cat: "groceries", catNote: "", date: new Date().toISOString().split("T")[0] };
  const blankLiab = { name: "", type: "mortgage", originalAmt: 0, currentBal: 0, rate: 0, termMonths: 360, monthsPaid: 0, monthlyPayment: 0, notes: "", homeValue: 0, homeAppreciation: 3.5, zipCode: "" };
  const [txnForm,   setTxnForm]   = useState(blankTxn);
  const [editingTxnId, setEditingTxnId] = useState(null);
  const [recForm,   setRecForm]   = useState({ type: "income", cat: "salary", desc: "", amt: "", day: "1", active: true });
  const [acctForm,  setAcctForm]  = useState({ name: "", type: "checking", balance: "", owner: "" });
  const [liabForm,  setLiabForm]  = useState(blankLiab);
  const [editingLiabId, setEditingLiabId] = useState(null);

  // ── Load persisted data on mount ────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const keys = Object.values(SK);
        const results = await Promise.all(keys.map(async k => {
          try { return [k, await window.storage.get(k, false)]; }
          catch { return [k, null]; }
        }));
        const map = Object.fromEntries(results.map(([k, r]) => [k, r ? JSON.parse(r.value) : null]));

        if (map[SK.ONBOARDED]) setOnboarded(true);
        // Merge (not replace) over the blank defaults. If storage holds an
        // older or partial shape — e.g. missing the `insurance` object
        // entirely, or missing a nested key like `termLife` because this
        // field was added after the user's data was first saved — a raw
        // replace would leave state without keys the rest of the app reads
        // via dotted paths (insurance.termLife.has, goals.categoryBudgets,
        // profile.payFrequency), causing a crash on first render. Merging
        // guarantees every expected key is always present.
        if (map[SK.PROFILE])   setProfile(p => ({ ...p, ...map[SK.PROFILE] }));
        if (map[SK.ACCOUNTS])  setAccounts(map[SK.ACCOUNTS]);
        if (map[SK.TXN])       setTxns(map[SK.TXN]);
        if (map[SK.REC])       setRecurring(map[SK.REC]);
        if (map[SK.LIAB])      setLiabilities(map[SK.LIAB]);
        if (map[SK.DIV])       setDivHoldings(map[SK.DIV]);
        if (map[SK.GOALS])     setGoals(g => ({ ...g, ...map[SK.GOALS], categoryBudgets: { ...g.categoryBudgets, ...(map[SK.GOALS].categoryBudgets || {}) } }));
        if (map[SK.INSURANCE]) setInsurance(ins => ({
          termLife:    { ...ins.termLife,   ...(map[SK.INSURANCE].termLife   || {}) },
          wholeLife:   { ...ins.wholeLife,  ...(map[SK.INSURANCE].wholeLife  || {}) },
          disability:  { ...ins.disability, ...(map[SK.INSURANCE].disability || {}) },
          docAnalysis: map[SK.INSURANCE].docAnalysis || null,
        }));
        if (map[SK.IS_PRO])    setIsPro(map[SK.IS_PRO]);
      } catch (e) {
        // Storage unavailable — app still works, just won't persist this session.
        console.error("Failed to load saved data", e);
      }
      setLoaded(true);
    })();
  }, []);

  // ── Persist helpers — personal (non-shared) scope keeps data private to the
  //    signed-in user; nothing here is written to a shared key. ───────────────
  const save = useCallback(async (key, value) => {
    try { await window.storage.set(key, JSON.stringify(value), false); }
    catch (e) { console.error("Save failed for", key, e); }
  }, []);

  useEffect(() => { if (loaded) save(SK.PROFILE, profile); }, [profile, loaded, save]);
  useEffect(() => { if (loaded) save(SK.ACCOUNTS, accounts); }, [accounts, loaded, save]);
  useEffect(() => { if (loaded) save(SK.TXN, txns); }, [txns, loaded, save]);
  useEffect(() => { if (loaded) save(SK.REC, recurring); }, [recurring, loaded, save]);
  useEffect(() => { if (loaded) save(SK.LIAB, liabilities); }, [liabilities, loaded, save]);
  useEffect(() => { if (loaded) save(SK.DIV, divHoldings); }, [divHoldings, loaded, save]);
  useEffect(() => { if (loaded) save(SK.GOALS, goals); }, [goals, loaded, save]);
  useEffect(() => { if (loaded) save(SK.INSURANCE, insurance); }, [insurance, loaded, save]);
  useEffect(() => { if (loaded) save(SK.IS_PRO, isPro); }, [isPro, loaded, save]);

  function completeOnboarding({ profile: p, recurring: r }) {
    setProfile(p);
    setRecurring(r);
    setOnboarded(true);
    save(SK.ONBOARDED, true);
  }

  // ── Derived values ──
  const totalAssets = accounts.reduce((s, a) => s + a.balance, 0);
  const nonMortgageLiab = liabilities.filter(l => !getLT(l.type).isMortgage).reduce((s, l) => s + l.currentBal, 0);
  const totalNet = totalAssets - nonMortgageLiab;
  const mortgages = liabilities.filter(l => getLT(l.type).isMortgage);
  const totalEquity = mortgages.reduce((s, l) => s + ((l.homeValue || 0) - l.currentBal), 0);
  const totalHomeValue = mortgages.reduce((s, l) => s + (l.homeValue || 0), 0);

  const mIncFixed = useMemo(() => recurring.filter(r => r.active && r.type === "income").reduce((s, r) => s + r.amt, 0), [recurring]);
  const mExpFixed = useMemo(() => recurring.filter(r => r.active && r.type === "expense").reduce((s, r) => s + r.amt, 0), [recurring]);

  // Real, in-the-moment activity for the current calendar month, pulled
  // directly from transactions rather than the static recurring list. This
  // is what makes the health score (and Needs/Wants/Wealth categories) move
  // as transactions come in throughout the month, instead of only changing
  // when someone edits a fixed bill.
  const nowDate = new Date();
  const curMonthKey = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthTxns = useMemo(() => txns.filter(t => t.date.slice(0, 7) === curMonthKey), [txns, curMonthKey]);
  const mIncLiveExtra = useMemo(() => thisMonthTxns.filter(t => t.amt > 0 && !t.rec).reduce((s, t) => s + t.amt, 0), [thisMonthTxns]);
  const mExpLiveExtra = useMemo(() => thisMonthTxns.filter(t => t.amt < 0 && !t.rec).reduce((s, t) => s + Math.abs(t.amt), 0), [thisMonthTxns]);

  // Blended monthly figures: fixed recurring amounts plus whatever real,
  // non-recurring activity has actually happened this month so far. These
  // are the numbers the health score and dashboard use.
  const mInc = mIncFixed + mIncLiveExtra;
  const mExp = mExpFixed + mExpLiveExtra;
  const mCash = mInc - mExp;
  const savRate = mInc > 0 ? ((mCash / mInc) * 100).toFixed(1) : "0.0";
  const annInc = mInc * 12;
  const taxInfo = useMemo(() => calcTax(annInc, goals.filing), [annInc, goals.filing]);

  // 6-month rolling average savings rate. For each of the past 6 calendar
  // months (including the current, partial one), take that month's actual
  // non-recurring transaction activity plus the current fixed recurring
  // bills (recurring amounts are assumed to apply retroactively, since we
  // don't track historical bill amounts), compute that month's savings
  // rate, and average across however many of those months actually have
  // transaction data. This reflects real behavior over time rather than a
  // single snapshot.
  const savRateHistory = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${MO[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
      const monthTxns = txns.filter(t => t.date.slice(0, 7) === key);
      const hasData = monthTxns.length > 0;
      const incExtra = monthTxns.filter(t => t.amt > 0 && !t.rec).reduce((s, t) => s + t.amt, 0);
      const expExtra = monthTxns.filter(t => t.amt < 0 && !t.rec).reduce((s, t) => s + Math.abs(t.amt), 0);
      const monthInc = mIncFixed + incExtra;
      const monthExp = mExpFixed + expExtra;
      const rate = monthInc > 0 ? ((monthInc - monthExp) / monthInc) * 100 : 0;
      months.push({ key, label, rate, hasData });
    }
    return months;
  }, [txns, nowDate.getFullYear(), nowDate.getMonth(), mIncFixed, mExpFixed]);

  const monthsWithData = savRateHistory.filter(m => m.hasData);
  const avgSavRate6mo = monthsWithData.length > 0
    ? monthsWithData.reduce((s, m) => s + m.rate, 0) / monthsWithData.length
    : parseFloat(savRate);

  const txnInc = txns.filter(t => t.amt > 0).reduce((s, t) => s + t.amt, 0);
  const txnExp = txns.filter(t => t.amt < 0).reduce((s, t) => s + Math.abs(t.amt), 0);
  const flexExp = txns.filter(t => t.amt < 0 && !t.rec).reduce((s, t) => s + Math.abs(t.amt), 0);

  const catSpend = useMemo(() => {
    const m = {};
    txns.filter(t => t.amt < 0).forEach(t => { m[t.cat] = (m[t.cat] || 0) + Math.abs(t.amt); });
    return m;
  }, [txns]);

  const expPie = useMemo(() =>
    Object.entries(catSpend).map(([id, v]) => ({ id, name: gc(id).l, value: v, color: gc(id).c })).sort((a, b) => b.value - a.value),
  [catSpend]);

  const incPie = useMemo(() => {
    const m = {};
    txns.filter(t => t.amt > 0).forEach(t => { m[t.cat] = (m[t.cat] || 0) + t.amt; });
    return Object.entries(m).map(([id, v]) => ({ id, name: gc(id).l, value: v, color: gc(id).c })).sort((a, b) => b.value - a.value);
  }, [txns]);

  const barData = useMemo(() => {
    const m = {};
    txns.forEach(t => {
      const mo = t.date.slice(0, 7);
      if (!m[mo]) m[mo] = { month: mo, income: 0, expense: 0 };
      if (t.amt > 0) m[mo].income += t.amt; else m[mo].expense += Math.abs(t.amt);
    });
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month)).map(d => ({ ...d, month: MO[parseInt(d.month.slice(5)) - 1] }));
  }, [txns]);

  const strat = STRATS.find(s => s.id === goals.investStrategy) || STRATS[3];
  const yrsLeft = Math.max(goals.retireAge - goals.currentAge, 1);
  // retBal is the single real source of truth — computed once here from actual
  // account balances, then passed as a prop everywhere it's needed (including
  // into FinancialHealthScore, which previously guessed with totalAssets * 0.5).
  const retBal = accounts.filter(a => a.type === "retirement" || a.type === "investment").reduce((s, a) => s + a.balance, 0);
  const retHist = useMemo(() => buildRetHist(retBal, goals.monthlyInvest, strat.ret), [retBal, goals.monthlyInvest, strat.ret]);
  const projected = projRet(retBal, goals.monthlyInvest, yrsLeft, strat.ret);
  const retPct = Math.min((projected / goals.nestEgg) * 100, 100);
  const onTrack = projected >= goals.nestEgg;
  const projData = useMemo(() => buildProj(retBal, goals.monthlyInvest, yrsLeft, strat.ret, goals.nestEgg), [goals, retBal]);

  const totalMonthlyDebt = liabilities.reduce((s, l) => s + l.monthlyPayment, 0);
  const dti = mInc > 0 ? ((totalMonthlyDebt / mInc) * 100).toFixed(1) : "0.0";

  const completeness = useMemo(() => computeCompleteness({ profile, accounts, recurring, liabilities, goals, insurance }), [profile, accounts, recurring, liabilities, goals, insurance]);
  const monthlySummary = useMemo(() => buildMonthlySummary({ txns, recurring, goals, retBal, liabilities }), [txns, recurring, goals, retBal, liabilities]);

  const aiCtx = `Monthly Income: ${fmt(mInc)} | Expenses: ${fmt(mExp)} | Cashflow: ${fmt(mCash)}\nSavings Rate: ${savRate}% (Goal: ${goals.savingsRatePct}%)\nAnnual Income: ${fmt(annInc)} | Tax Bracket: ${taxInfo.label} | Effective: ${taxInfo.effective}%\nTotal Assets: ${fmt(totalAssets)} | Liabilities: ${fmt(nonMortgageLiab)} | Net Worth: ${fmt(totalNet)}\nHome Equity: ${fmt(totalEquity)} | Debt-to-Income: ${dti}%\nRetirement: ${fmt(retBal)} | Projected: ${fmt(projected)} | Goal: ${fmt(goals.nestEgg)}`;

  const ATYPES = { checking: { l: "Checking", i: "🏦", c: T.blue }, savings: { l: "Savings", i: "🐖", c: T.green }, retirement: { l: "Retirement", i: "🏖️", c: T.purple }, investment: { l: "Investment", i: "📈", c: T.gold } };

  // ── Handlers ──
  function openAddTxn() {
    setEditingTxnId(null);
    setTxnForm(blankTxn);
    setActiveModal("txn");
  }
  function openEditTxn(t) {
    setEditingTxnId(t.id);
    setTxnForm({ aId: t.aId, desc: t.desc, amt: String(Math.abs(t.amt)), type: t.amt >= 0 ? "income" : "expense", cat: t.cat, catNote: t.catNote || "", date: t.date });
    setActiveModal("txn");
  }
  // Applies a signed transaction amount to whichever collection it targets.
  // For a real account, income (+) raises the balance and expense (-) lowers
  // it, same as cash in a checking account. For a liability like a credit
  // card, the meaning flips: an "expense" is a charge that INCREASES what's
  // owed, and "income" is a payment that DECREASES what's owed — so the
  // liability's balance moves opposite to the transaction's raw sign.
  function applyTxnEffect(aId, signedAmt, setAccountsFn, setLiabilitiesFn) {
    if (isLiabId(aId)) {
      const rawId = rawLiabId(aId);
      setLiabilitiesFn(p => p.map(l => l.id === rawId ? { ...l, currentBal: Math.max(0, l.currentBal - signedAmt) } : l));
    } else {
      setAccountsFn(p => p.map(a => a.id === aId ? { ...a, balance: a.balance + signedAmt } : a));
    }
  }
  function submitTxn() {
    if (!txnForm.aId || !txnForm.desc || !txnForm.amt) return;
    const signedAmt = parseFloat(txnForm.amt) * (txnForm.type === "expense" ? -1 : 1);
    const aId = txnForm.aId; // string ID (uid() or "liab:<uid>") — never parseInt this
    const catNote = gc(txnForm.cat).needsNote ? (txnForm.catNote || "").trim() : "";

    if (editingTxnId) {
      // Reverse the old amount from its old target, then apply the new
      // amount to the (possibly different) target — keeps balances correct
      // even if the account/liability or the amount changed. Skipped
      // entirely for a Plaid-synced txn: that account's balance comes
      // directly from Plaid on each sync, not from summing transactions, so
      // nudging it here would just be overwritten (or drift) on next sync.
      const old = txns.find(t => t.id === editingTxnId);
      setTxns(p => p.map(t => t.id === editingTxnId ? { ...t, aId, desc: txnForm.desc, amt: signedAmt, cat: txnForm.cat, catNote, date: txnForm.date } : t));
      if (!old?.synced) {
        if (old) applyTxnEffect(old.aId, -old.amt, setAccounts, setLiabilities);
        applyTxnEffect(aId, signedAmt, setAccounts, setLiabilities);
      }
    } else {
      const t = { id: uid(), aId, cat: txnForm.cat, catNote, desc: txnForm.desc, amt: signedAmt, date: txnForm.date, rec: false };
      setTxns(p => [t, ...p]);
      applyTxnEffect(aId, signedAmt, setAccounts, setLiabilities);
    }
    setActiveModal(null);
    setEditingTxnId(null);
    setTxnForm(blankTxn);
  }
  function deleteTxn(t) {
    setTxns(p => p.filter(x => x.id !== t.id));
    // Same reasoning as above — a synced txn's account balance isn't derived
    // from these rows, so removing the row shouldn't move the balance.
    if (!t.synced) applyTxnEffect(t.aId, -t.amt, setAccounts, setLiabilities);
  }

  // Merges AI-extracted document findings into insurance state. If the
  // document's policyType maps to one of our tracked categories, that
  // category is marked answered/has=true — a successfully analyzed document
  // is direct evidence the policy exists, stronger than a manual toggle.
  function applyDocFindings(analysis) {
    const typeMap = { term_life: "termLife", whole_life: "wholeLife", disability: "disability" };
    const matchedKey = typeMap[analysis.policyType];
    setInsurance(ins => ({
      ...ins,
      ...(matchedKey ? { [matchedKey]: { ...ins[matchedKey], answered: true, has: true } } : {}),
      docAnalysis: { ...analysis, analyzedAt: new Date().toISOString() },
    }));
    setShowDocAnalyzer(false);
  }

  function addAcct() {
    if (!acctForm.name || !acctForm.balance || !acctForm.owner) return;
    setAccounts(p => [...p, { id: uid(), ...acctForm, balance: parseFloat(acctForm.balance) }]);
    setActiveModal(null);
    setAcctForm({ name: "", type: "checking", balance: "", owner: "" });
  }
  function addRec() {
    if (!recForm.desc || !recForm.amt) return;
    setRecurring(p => [...p, { id: uid(), ...recForm, amt: parseFloat(recForm.amt), day: parseInt(recForm.day) }]);
    setShowRecModal(false);
    setRecForm({ type: "income", cat: "salary", desc: "", amt: "", day: "1", active: true });
  }

  function openAddLiab() {
    setEditingLiabId(null);
    setLiabForm(blankLiab);
    setActiveModal("liab");
  }
  function openEditLiab(l) {
    setEditingLiabId(l.id);
    setLiabForm({ ...l });
    setActiveModal("liab");
  }
  function submitLiab() {
    if (!liabForm.name || !liabForm.currentBal) return;
    if (editingLiabId) {
      setLiabilities(p => p.map(l => l.id === editingLiabId ? { ...liabForm, id: editingLiabId } : l));
    } else {
      setLiabilities(p => [...p, { ...liabForm, id: uid() }]);
    }
    setActiveModal(null);
    setEditingLiabId(null);
    setLiabForm(blankLiab);
  }

  const toggleRec = id => setRecurring(p => p.map(r => r.id === id ? { ...r, active: !r.active } : r));
  const delRec    = id => setRecurring(p => p.filter(r => r.id !== id));
  const delLiab   = id => setLiabilities(p => p.filter(l => l.id !== id));

  const shownTxns = useMemo(() => {
    const s = [...txns].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (txnTab === "recurring") return s.filter(t => t.rec);
    if (txnTab === "flexible")  return s.filter(t => !t.rec);
    return s;
  }, [txns, txnTab]);

  // ── Loading gate ─────────────────────────────────────────────────────────
  if (!loaded) {
    return (
      <div style={{ fontFamily: "'Trebuchet MS',Tahoma,Geneva,Verdana,sans-serif", background: T.bg, minHeight: "100vh", color: T.sub, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: "13px" }}>Loading your data…</div>
      </div>
    );
  }

  // ── Onboarding gate ──────────────────────────────────────────────────────
  if (!onboarded) {
    return <OnboardingFlow onComplete={completeOnboarding} />;
  }

  // ── Account detail view ──
  const NAV = [["dashboard","Dashboard"],["goals","Goals"],["retirement","Retirement"],["liabilities","Liabilities"],["accounts","Accounts"],["transactions","Transactions"]];

  // Shared between both the account-detail view and the main view below, so
  // the hamburger menu, its destination screens, and the bottom tab bar
  // behave identically no matter which screen the person is on.
  function renderAppChrome() {
    return (
      <>
        <BottomTabBar NAV={NAV} view={view} setView={setView} isPro={isPro} setActiveModal={setActiveModal} />
        <SideMenu
          open={showMenu} onClose={() => setShowMenu(false)}
          profileFirstName={profile.firstName} notifCount={notifCount}
          aiEnabled={appPrefs.enableAiAssistant !== false}
          onNav={handleMenuNav}
        />
        {showReceipts && (
          <ReceiptScannerModal
            accounts={accounts} liabilities={liabilities}
            onConfirm={addReceiptTransaction}
            onClose={() => setShowReceipts(false)}
          />
        )}
        {showNotifications && (
          <NotificationsModal
            recurring={recurring} divHoldings={divHoldings} liabilities={liabilities}
            onClose={() => setShowNotifications(false)}
          />
        )}
        {showCategories && <CategoriesModal onClose={() => setShowCategories(false)} />}
        {showPreferences && <PreferencesModal prefs={appPrefs} setPrefs={setAppPrefs} onClose={() => setShowPreferences(false)} />}
        {showRules && <RulesModal rules={customRules} setRules={setCustomRules} onClose={() => setShowRules(false)} />}
        {showMerchants && <MerchantsModal txns={txns} rules={customRules} setRules={setCustomRules} onClose={() => setShowMerchants(false)} />}
        {showMembers && <MembersModal members={householdMembers} setMembers={setHouseholdMembers} onClose={() => setShowMembers(false)} />}
      </>
    );
  }

  if (selAcct) {
    const ac = accounts.find(a => a.id === selAcct);
    const meta = ATYPES[ac.type];
    const at = [...txns].filter(t => t.aId === selAcct).sort((a, b) => new Date(b.date) - new Date(a.date));
    const aI = at.filter(t => t.amt > 0).reduce((s, t) => s + t.amt, 0);
    const aE = at.filter(t => t.amt < 0).reduce((s, t) => s + Math.abs(t.amt), 0);
    return (
      <div style={{ fontFamily: "'Trebuchet MS',Tahoma,Geneva,Verdana,sans-serif", background: T.bg, minHeight: "100vh", color: T.text, paddingBottom: "66px" }}>
        <div style={{ background: T.s1, borderBottom: `1px solid ${T.border}`, padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50, flexWrap: "wrap", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button onClick={() => setShowMenu(true)} aria-label="Menu" style={{ background: "none", border: "none", cursor: "pointer", color: T.text, fontSize: "20px", padding: "2px 4px", lineHeight: 1 }}>☰</button>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><MMMLogo size={22} /><div style={{ fontSize: "14px", fontWeight: "900", letterSpacing: "1.5px", textTransform: "uppercase" }} title="Mindful Money Management">MMM</div></div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <AiBtn onClick={openAI} />
            <button style={btn(T.s3)} onClick={() => exportCSV(txns, accounts, liabilities)}>⬇ CSV</button>
            <button style={btn(T.green, "#000")} onClick={() => { setEditingTxnId(null); setTxnForm({ ...blankTxn, aId: String(selAcct) }); setActiveModal("txn"); }}>+ Add</button>
            <button onClick={() => setShowNotifications(true)} aria-label="Notifications" style={{ position: "relative", background: "none", border: "none", cursor: "pointer", color: T.text, fontSize: "19px", padding: "2px 4px", lineHeight: 1 }}>
              🔔
              {notifCount > 0 && <span style={{ position: "absolute", top: "-2px", right: "-2px", width: "14px", height: "14px", borderRadius: "50%", background: T.red, color: "#fff", fontSize: "8px", fontWeight: "800", display: "flex", alignItems: "center", justifyContent: "center" }}>{notifCount}</span>}
            </button>
          </div>
        </div>
        <div style={{ padding: "20px 16px", maxWidth: "1280px", margin: "0 auto" }}>
          <button style={{ background: "none", border: "none", cursor: "pointer", color: T.sub, fontFamily: "inherit", fontSize: "13px", marginBottom: "16px", padding: 0 }} onClick={() => setSelAcct(null)}>← Back</button>
          <div style={{ ...CS.card, marginBottom: "18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "26px", marginBottom: "4px" }}>{meta.i}</div>
              <div style={CS.lbl}>{meta.l} · {ac.owner}</div>
              <div style={{ fontSize: "13px", color: T.sub, marginBottom: "6px" }}>{ac.name}</div>
              <div style={{ ...CS.big, color: meta.c }}>{fmtD(ac.balance)}</div>
            </div>
            <div style={{ display: "flex", gap: "30px" }}>
              <div><div style={CS.lbl}>Income</div><div style={{ fontSize: "18px", fontWeight: "800", color: T.green }}>{fmt(aI)}</div></div>
              <div><div style={CS.lbl}>Expenses</div><div style={{ fontSize: "18px", fontWeight: "800", color: T.red }}>{fmt(aE)}</div></div>
            </div>
          </div>
          <div style={CS.sec}>Transactions</div>
          {at.length === 0 && <Empty icon="🧾" text="No transactions in this account yet." />}
          {at.map(t => (
            <div key={t.id} style={CS.txnRow}>
              <span style={{ fontSize: "18px" }}>{gc(t.cat).i}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: "600", fontSize: "13px" }}>{t.desc}{t.catNote && <span style={{ color: T.sub, fontWeight: "400" }}> — {t.catNote}</span>}</div>
                <div style={{ fontSize: "10px", color: T.sub, marginTop: "1px" }}>{t.date}{t.rec && <span style={{ color: T.purple }}> ↻</span>}{t.synced && <span style={{ color: T.teal }}> · via Plaid</span>}</div>
              </div>
              <Tag cat={t.cat} />
              <div style={{ fontWeight: "800", fontSize: "13px", color: t.amt > 0 ? T.green : T.red, minWidth: "82px", textAlign: "right" }}>{t.amt > 0 ? "+" : ""}{fmtD(t.amt)}</div>
              <button onClick={() => openEditTxn(t)} title="Edit" style={{ background: "none", border: "none", cursor: "pointer", color: T.blue, fontSize: "13px", padding: "0 4px" }}>✎</button>
              <button onClick={() => deleteTxn(t)} title="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: "13px", padding: "0 4px" }}>✕</button>
            </div>
          ))}
        </div>
        {activeModal === "txn" && <TxnModal form={txnForm} setForm={setTxnForm} accounts={accounts} liabilities={liabilities} onCancel={() => { setActiveModal(null); setEditingTxnId(null); }} onSubmit={submitTxn} isEdit={!!editingTxnId} />}
        {showAI && <AiPanel context={aiCtx} onClose={() => setShowAI(false)} />}
        {renderAppChrome()}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Trebuchet MS',Tahoma,Geneva,Verdana,sans-serif", background: T.bg, minHeight: "100vh", color: T.text, paddingBottom: "66px" }}>

      {/* Header */}
      <div style={{ background: T.s1, borderBottom: `1px solid ${T.border}`, padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50, flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button onClick={() => setShowMenu(true)} aria-label="Menu" style={{ background: "none", border: "none", cursor: "pointer", color: T.text, fontSize: "20px", padding: "2px 4px", lineHeight: 1 }}>☰</button>
          <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
            <MMMLogo size={28} />
            <div>
              <div style={{ fontSize: "13px", fontWeight: "900", letterSpacing: "1.2px", textTransform: "uppercase", color: T.text }}>Mindful Money<br />Management</div>
              <div style={{ fontSize: "9px", color: T.sub, letterSpacing: "2px", textTransform: "uppercase", marginTop: "2px" }}>{profile.firstName ? `${profile.firstName}'s Plan` : "Wealth & Retirement Planner"}</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {!isPro && <button style={{ ...btn(null, "#fff"), background: T.gradGold, fontSize: "11px", padding: "6px 14px" }} onClick={() => setActiveModal("paywall")}>💎 Pro</button>}
          {isPro  && <span style={{ padding: "4px 10px", borderRadius: "20px", fontSize: "10px", fontWeight: "700", background: `${T.gold}22`, color: T.gold }}>💎 PRO</span>}
          <ThemeToggle pref={themePref} setPref={setThemePref} />
          <button style={btn(T.s3)} onClick={() => exportCSV(txns, accounts, liabilities)}>⬇ CSV</button>
          <button style={btn(T.s3)} onClick={() => setActiveModal("account")}>+ Account</button>
          <button style={btn(T.green, "#000")} onClick={openAddTxn}>+ Transaction</button>
          <button onClick={() => setShowNotifications(true)} aria-label="Notifications" style={{ position: "relative", background: "none", border: "none", cursor: "pointer", color: T.text, fontSize: "19px", padding: "2px 4px", lineHeight: 1 }}>
            🔔
            {notifCount > 0 && <span style={{ position: "absolute", top: "-2px", right: "-2px", width: "14px", height: "14px", borderRadius: "50%", background: T.red, color: "#fff", fontSize: "8px", fontWeight: "800", display: "flex", alignItems: "center", justifyContent: "center" }}>{notifCount}</span>}
          </button>
        </div>
      </div>

      <div style={{ padding: "20px 16px", maxWidth: "1280px", margin: "0 auto" }}>

        {/* ══ DASHBOARD ══ */}
        {view === "dashboard" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
              <div style={CS.sec}>Overview</div>
              <AiBtn onClick={openAI} />
            </div>

            <FinancialHealthScore
              mInc={mInc} mExp={mExp} mCash={mCash} savRate={savRate} avgSavRate6mo={avgSavRate6mo}
              goals={goals} totalNet={totalNet} totalAssets={totalAssets}
              retBal={retBal}
              liabilities={liabilities} insurance={insurance}
              dti={dti} isPro={isPro} completeness={completeness}
              onUpgradePro={() => setActiveModal("paywall")}
            />

            {completeness.pct < 1 && (
              <div style={{ ...CS.card, marginBottom: "18px", border: `1px solid ${T.blue}44`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: T.text, marginBottom: "3px" }}>Improve your score's accuracy</div>
                  <div style={{ fontSize: "11px", color: T.sub }}>
                    Missing: {completeness.missing.map(m => ({ profile: "profile info", income: "income", expenses: "expenses", accounts: "accounts", goals: "savings goals", retirement: "retirement accounts", insurance: "insurance" }[m])).join(", ")}
                  </div>
                </div>
                <button style={btn(T.blue, "#fff")} onClick={() => { setInsuranceDraft({ ...insurance }); setShowInsurance(true); }}>Add Insurance Info</button>
              </div>
            )}

            <MonthlySummaryCard summary={monthlySummary} />

            {/* Net Worth Banner */}
            <div style={{ ...CS.card, marginBottom: "18px", background: "linear-gradient(135deg,#0d1a2e,#0a1525)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "16px", alignItems: "center" }}>
                <div><div style={CS.lbl}>Total Assets</div><div style={{ fontSize: "20px", fontWeight: "900", color: T.green }}>{fmt(totalAssets)}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "2px" }}>{accounts.length} accounts</div></div>
                <div><div style={CS.lbl}>Liabilities</div><div style={{ fontSize: "20px", fontWeight: "900", color: T.red }}>−{fmt(nonMortgageLiab)}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "2px" }}>Excl. mortgage</div></div>
                <div><div style={CS.lbl}>Net Worth</div><div style={{ fontSize: "22px", fontWeight: "900", color: T.text }}>{fmt(totalNet)}</div></div>
                <div><div style={CS.lbl}>Home Equity</div><div style={{ fontSize: "20px", fontWeight: "900", color: T.teal }}>{fmt(totalEquity)}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "2px" }}>Tracked separately</div></div>
              </div>
            </div>

            <div style={CS.g4}>
              <div style={CS.card}><div style={CS.lbl}>Monthly Income</div><div style={{ ...CS.big, color: T.green }}>{fmt(mInc)}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "3px" }}>{recurring.filter(r => r.active && r.type === "income").length} recurring{mIncLiveExtra > 0 ? ` + ${fmt(mIncLiveExtra)} this month` : ""}</div></div>
              <div style={CS.card}><div style={CS.lbl}>Monthly Expenses</div><div style={{ ...CS.big, color: T.red }}>{fmt(mExp)}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "3px" }}>{recurring.filter(r => r.active && r.type === "expense").length} bills{mExpLiveExtra > 0 ? ` + ${fmt(mExpLiveExtra)} this month` : ""}</div></div>
              <div style={{ ...CS.card, border: `1px solid ${parseFloat(savRate) >= goals.savingsRatePct ? T.green : T.gold}` }}><div style={CS.lbl}>Savings Rate</div><div style={{ ...CS.big, color: parseFloat(savRate) >= goals.savingsRatePct ? T.green : T.gold }}>{savRate}%</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "3px" }}>Goal: {goals.savingsRatePct}%</div></div>
              <div style={{ ...CS.card, border: `1px solid ${parseFloat(dti) < 36 ? T.green : parseFloat(dti) < 43 ? T.gold : T.red}` }}><div style={CS.lbl}>Debt-to-Income</div><div style={{ ...CS.big, color: parseFloat(dti) < 36 ? T.green : parseFloat(dti) < 43 ? T.gold : T.red }}>{dti}%</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "3px" }}>{parseFloat(dti) < 36 ? "Healthy" : parseFloat(dti) < 43 ? "Caution" : "High"}</div></div>
            </div>

            <div style={{ ...CS.card, marginBottom: "18px", display: "flex", gap: "24px", alignItems: "center", flexWrap: "wrap" }}>
              <div><div style={CS.lbl}>Filing</div><div style={{ fontWeight: "700", fontSize: "13px" }}>{goals.filing === "mfj" ? "Married Filing Jointly" : "Single"}</div></div>
              <div><div style={CS.lbl}>Annual Income</div><div style={{ fontWeight: "700", fontSize: "13px" }}>{fmt(annInc)}</div></div>
              <div><div style={CS.lbl}>Marginal Bracket</div><div style={{ fontSize: "18px", fontWeight: "900", color: T.gold }}>{taxInfo.label}</div></div>
              <div><div style={CS.lbl}>Effective Rate</div><div style={{ fontSize: "18px", fontWeight: "900", color: T.cyan }}>{taxInfo.effective}%</div></div>
              <div><div style={CS.lbl}>Est. Annual Tax</div><div style={{ fontSize: "18px", fontWeight: "900", color: T.red }}>{fmt(taxInfo.est)}</div></div>
              <button style={{ ...btn(T.s3), marginLeft: "auto", fontSize: "11px" }} onClick={() => { setGoalDraft({ ...goals }); setEditGoals(true); }}>Change Filing</button>
            </div>

            <div style={CS.g2}>
              <div style={CS.card}>
                <div style={CS.sec}>Spending by Category</div>
                {expPie.length === 0 ? <Empty icon="🥧" text="No spending recorded yet. Add a transaction and this chart fills in automatically." action="+ Add Transaction" /> : (
                  <>
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart><Pie data={expPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} labelLine={false} label={<PctLbl />}>{expPie.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip content={<CTip />} /></PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "8px" }}>
                      {expPie.map(e => <span key={e.id} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "10px", color: T.sub }}><span style={{ width: "7px", height: "7px", borderRadius: "50%", background: e.color, display: "inline-block", flexShrink: 0 }} />{e.name}</span>)}
                    </div>
                  </>
                )}
              </div>
              <div style={CS.card}>
                <div style={CS.sec}>Income vs Expenses by Month</div>
                {barData.length === 0 ? <Empty icon="📊" text="Your month-over-month trend appears here once you have transactions." /> : (
                  <ResponsiveContainer width="100%" height={190}>
                    <BarChart data={barData} barGap={3}><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 10 }} tickFormatter={v => fmt(v)} /><Tooltip content={<CTip />} /><Legend wrapperStyle={{ fontSize: "11px", color: T.sub }} /><Bar dataKey="income" name="Income" fill={T.green} radius={[4,4,0,0]} /><Bar dataKey="expense" name="Expenses" fill={T.red} radius={[4,4,0,0]} /></BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div style={CS.g2}>
              <div style={CS.card}><div style={CS.sec}>Expense Breakdown</div>{expPie.length === 0 ? <Empty icon="💸" text="No expenses yet." /> : expPie.map(e => <div key={e.id} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "9px" }}><span style={{ fontSize: "14px", width: "18px" }}>{gc(e.id).i}</span><span style={{ fontSize: "11px", flex: 1, color: "#8ab4cc" }}>{e.name}</span><PBar value={e.value} max={txnExp} color={e.color} /><span style={{ fontSize: "11px", fontWeight: "800", color: e.color, minWidth: "54px", textAlign: "right" }}>{fmt(e.value)}</span></div>)}</div>
              <div style={CS.card}><div style={CS.sec}>Income Breakdown</div>{incPie.length === 0 ? <Empty icon="💰" text="No income recorded yet." /> : incPie.map(e => <div key={e.id} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "9px" }}><span style={{ fontSize: "14px", width: "18px" }}>{gc(e.id).i}</span><span style={{ fontSize: "11px", flex: 1, color: "#8ab4cc" }}>{e.name}</span><PBar value={e.value} max={txnInc} color={e.color} /><span style={{ fontSize: "11px", fontWeight: "800", color: e.color, minWidth: "54px", textAlign: "right" }}>{fmt(e.value)}</span></div>)}</div>
            </div>
          </div>
        )}

        {/* ══ GOALS ══ */}
        {view === "goals" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
              <div style={CS.sec}>Savings Goals</div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <AiBtn onClick={openAI} />
                <button style={btn(T.s3)} onClick={() => { setBudgetDraft({ ...goals.categoryBudgets }); setShowBudgets(true); }}>Set Budgets</button>
                <button style={btn(T.blue, "#fff")} onClick={() => { setGoalDraft({ ...goals }); setEditGoals(true); }}>Edit Goals</button>
              </div>
            </div>
            <div style={CS.g3}>
              {[
                { l: "Savings Rate",    ring: mInc > 0 ? Math.min((parseFloat(savRate) / goals.savingsRatePct) * 100, 100) : 0, cur: `${savRate}%`, goal: `${goals.savingsRatePct}%`,  c: parseFloat(savRate) >= goals.savingsRatePct ? T.green : T.gold, sub: null },
                { l: "Monthly Savings", ring: goals.monthlySavings > 0 ? Math.min((mCash / goals.monthlySavings) * 100, 100) : 0, cur: fmt(mCash), goal: fmt(goals.monthlySavings), c: mCash >= goals.monthlySavings ? T.green : T.gold, sub: null },
                { l: "Retirement Pace", ring: retPct, cur: fmt(projected), goal: fmt(goals.nestEgg), c: onTrack ? T.green : T.gold, sub: `Age ${goals.currentAge} · ${yrsLeft} yr${yrsLeft !== 1 ? "s" : ""} to go` },
              ].map(({ l, ring, cur, goal, c, sub }) => (
                <div key={l} style={{ ...CS.card, display: "flex", alignItems: "center", gap: "16px" }}>
                  <Ring pct={ring} size={72} color={c} />
                  <div><div style={CS.lbl}>{l}</div><div style={{ fontSize: "17px", fontWeight: "800" }}>{cur}</div><div style={{ fontSize: "11px", color: T.sub }}>Goal: {goal}</div>{sub && <div style={{ fontSize: "10px", color: T.sub, marginTop: "1px" }}>{sub}</div>}<div style={{ fontSize: "10px", color: ring >= 100 ? T.green : T.gold, marginTop: "3px" }}>{ring >= 100 ? "✓ On track" : ring >= 70 ? "Getting close…" : "Needs attention"}</div></div>
                </div>
              ))}
            </div>

            <div style={{ ...CS.card, marginBottom: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                <div style={CS.sec}>6-Month Average Savings Rate</div>
                <div style={{ fontSize: "20px", fontWeight: "900", color: avgSavRate6mo >= goals.savingsRatePct ? T.green : T.gold }}>{avgSavRate6mo.toFixed(1)}%</div>
              </div>
              {monthsWithData.length === 0 ? (
                <Empty icon="📈" text="Add transactions across a few months to see your savings rate trend over time." />
              ) : (
                <>
                  <div style={{ display: "flex", gap: "6px", alignItems: "flex-end", height: "60px", marginBottom: "8px" }}>
                    {savRateHistory.map(m => {
                      const barHeight = m.hasData ? Math.max(4, Math.min(100, Math.abs(m.rate)) * 0.55) : 4;
                      const barColor = !m.hasData ? T.border : m.rate >= goals.savingsRatePct ? T.green : m.rate >= 0 ? T.gold : T.red;
                      return (
                        <div key={m.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                          <div style={{ width: "100%", maxWidth: "28px", height: `${barHeight}px`, background: barColor, borderRadius: "3px", opacity: m.hasData ? 1 : 0.3 }} title={m.hasData ? `${m.rate.toFixed(1)}%` : "No data"} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {savRateHistory.map(m => (
                      <div key={m.key} style={{ flex: 1, textAlign: "center", fontSize: "9px", color: T.sub }}>{m.label}</div>
                    ))}
                  </div>
                  <div style={{ marginTop: "10px", fontSize: "11px", color: T.sub }}>
                    Averaged across {monthsWithData.length} month{monthsWithData.length !== 1 ? "s" : ""} with transaction data
                    {monthsWithData.length < 6 ? ` (of the last 6) — keep logging transactions for a fuller picture.` : "."}
                  </div>
                </>
              )}
            </div>

            <div style={{ ...CS.card, marginBottom: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}><div style={CS.sec}>Category Budgets vs Actual</div></div>
              {Object.keys(goals.categoryBudgets).length === 0 && Object.keys(catSpend).length === 0 ? (
                <Empty icon="🎯" text="Set budgets for your spending categories to track progress here." action="Set Budgets ↑" />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
                  {EXP.filter(c => goals.categoryBudgets[c.id] > 0 || catSpend[c.id]).map(c => {
                    const budget = goals.categoryBudgets[c.id] || 0;
                    const spent  = catSpend[c.id] || 0;
                    const over   = budget > 0 && spent > budget;
                    return (
                      <div key={c.id} style={{ padding: "10px 12px", background: T.s1, borderRadius: "10px", border: `1px solid ${over ? T.red + "50" : T.border}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                          <span style={{ fontSize: "11px", fontWeight: "700", color: c.c }}>{c.i} {c.l}</span>
                          {over && <span style={{ fontSize: "9px", color: T.red, fontWeight: "700" }}>OVER</span>}
                        </div>
                        <PBar value={spent} max={budget || spent} color={over ? T.red : c.c} h={5} />
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px" }}>
                          <span style={{ fontSize: "10px", color: over ? T.red : T.sub, fontWeight: "700" }}>{fmt(spent)}</span>
                          <span style={{ fontSize: "10px", color: T.sub }}>/{budget ? fmt(budget) : "∞"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ ...CS.card, marginBottom: "18px" }}>
              <div style={CS.sec}>50 / 30 / 20 Budget Rule</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
                {[
                  { l: "Needs (50%)",   t: mInc * 0.5, a: mExp * 0.6, c: T.blue,  tip: "Housing, utilities, groceries, insurance" },
                  { l: "Wants (30%)",   t: mInc * 0.3, a: mExp * 0.4, c: T.gold,  tip: "Dining, entertainment, subscriptions" },
                  { l: "Savings (20%)", t: mInc * 0.2, a: mCash,      c: T.green, tip: "Investments, emergency fund, retirement" },
                ].map(({ l, t, a, c, tip }) => (
                  <div key={l}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}><span style={{ fontSize: "11px", fontWeight: "700", color: c }}>{l}</span><span style={{ fontSize: "10px", color: T.sub }}>{fmt(a)} / {fmt(t)}</span></div>
                    <PBar value={a} max={t || 1} color={c} h={7} />
                    <div style={{ fontSize: "10px", color: T.sub, marginTop: "4px" }}>{tip}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Insurance card — feeds directly into completeness + wealth score */}
            <div style={{ ...CS.card, marginBottom: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <div style={CS.sec}>Insurance Coverage</div>
                <button style={btn(T.blue, "#fff")} onClick={() => { setInsuranceDraft({ ...insurance }); setShowInsurance(true); }}>Edit Insurance</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
                {[
                  { key: "termLife",   label: "Term Life",   icon: "🛡️", data: insurance.termLife,   detail: !insurance.termLife.answered ? "Not answered yet" : insurance.termLife.has ? `${fmt(insurance.termLife.coverage)} coverage · ${insurance.termLife.termYears}yr term` : "No coverage" },
                  { key: "wholeLife",  label: "Whole Life",  icon: "🏛️", data: insurance.wholeLife,  detail: !insurance.wholeLife.answered ? "Not answered yet" : insurance.wholeLife.has ? `${fmt(insurance.wholeLife.coverage)} coverage` : "No coverage" },
                  { key: "disability", label: "Disability",  icon: "♿", data: insurance.disability, detail: !insurance.disability.answered ? "Not answered yet" : insurance.disability.has ? `${fmt(insurance.disability.monthlyBenefit)}/mo benefit` : "No coverage" },
                ].map(item => {
                  const statusColor = !item.data.answered ? T.gold : item.data.has ? T.green : T.blue;
                  return (
                    <div key={item.key} style={{ padding: "12px 14px", background: T.s1, borderRadius: "10px", border: `1px solid ${statusColor}44` }}>
                      <div style={{ fontSize: "18px", marginBottom: "6px" }}>{item.icon}</div>
                      <div style={{ fontSize: "12px", fontWeight: "700", color: statusColor, marginBottom: "4px" }}>{item.label}</div>
                      <div style={{ fontSize: "11px", color: T.sub }}>{item.detail}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: "12px", fontSize: "11px", color: T.sub, lineHeight: "1.6" }}>
                💡 Insurance protects the income that funds everything else in your plan. It's part of your Wealth Building score.
              </div>

              {insurance.docAnalysis && (
                <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: `1px solid ${T.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                    <span style={{ fontSize: "14px" }}>📄</span>
                    <span style={{ fontSize: "10px", fontWeight: "700", color: T.blue, letterSpacing: "1px", textTransform: "uppercase" }}>AI Document Analysis</span>
                    <span style={{ marginLeft: "auto", fontSize: "9px", color: T.sub }}>{new Date(insurance.docAnalysis.analyzedAt).toLocaleDateString()}</span>
                  </div>
                  {insurance.docAnalysis.maxMonthlyDistribution && (
                    <div style={{ background: `${T.blue}12`, borderRadius: "8px", padding: "10px 12px", marginBottom: "8px", fontSize: "11px", color: T.text, lineHeight: "1.5" }}>
                      <strong style={{ color: T.blue }}>Max monthly distribution:</strong> {insurance.docAnalysis.maxMonthlyDistribution}
                    </div>
                  )}
                  {Array.isArray(insurance.docAnalysis.gaps) && insurance.docAnalysis.gaps.length > 0 && (
                    <div style={{ fontSize: "11px", color: T.sub }}>
                      <span style={{ color: T.red, fontWeight: "700" }}>{insurance.docAnalysis.gaps.length} gap{insurance.docAnalysis.gaps.length !== 1 ? "s" : ""} identified</span> — see Edit Insurance for details.
                    </div>
                  )}
                </div>
              )}
            </div>

            {showBudgets && (
              <div style={CS.modalWrap} onClick={() => setShowBudgets(false)}>
                <div style={{ ...CS.mbox, width: "500px" }} onClick={e => e.stopPropagation()}>
                  <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "18px" }}>Set Monthly Category Budgets</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    {EXP.map(c => <div key={c.id}><div style={CS.lbl}>{c.i} {c.l}</div><input style={CS.inp} type="number" placeholder="0 = no limit" value={budgetDraft[c.id] || ""} onChange={e => setBudgetDraft({ ...budgetDraft, [c.id]: parseFloat(e.target.value) || 0 })} /></div>)}
                  </div>
                  <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                    <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setShowBudgets(false)}>Cancel</button>
                    <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={() => { setGoals({ ...goals, categoryBudgets: budgetDraft }); setShowBudgets(false); }}>Save</button>
                  </div>
                </div>
              </div>
            )}
            {editGoals && (
              <div style={CS.modalWrap} onClick={() => setEditGoals(false)}>
                <div style={CS.mbox} onClick={e => e.stopPropagation()}>
                  <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "18px" }}>Edit Family Goals</div>
                  {[["Savings Rate Target (%)","savingsRatePct"],["Monthly Savings Target ($)","monthlySavings"]].map(([l, k]) => (
                    <div key={k} style={{ marginBottom: "13px" }}><div style={CS.lbl}>{l}</div><input style={CS.inp} type="number" value={goalDraft[k]} onChange={e => setGoalDraft({ ...goalDraft, [k]: parseFloat(e.target.value) || 0 })} /></div>
                  ))}
                  <div style={{ marginBottom: "13px" }}>
                    <div style={CS.lbl}>Filing Status</div>
                    <select style={CS.inp} value={goalDraft.filing} onChange={e => setGoalDraft({ ...goalDraft, filing: e.target.value })}>
                      <option value="mfj">Married Filing Jointly</option>
                      <option value="single">Single</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
                    <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setEditGoals(false)}>Cancel</button>
                    <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={() => { setGoals({ ...goals, ...goalDraft }); setEditGoals(false); }}>Save</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ LIABILITIES ══ */}
        {view === "liabilities" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
              <div style={CS.sec}>Liabilities & Debt Tracker</div>
              <button style={btn(T.blue, "#fff")} onClick={openAddLiab}>+ Add Liability</button>
            </div>

            <div style={{ ...CS.card, marginBottom: "18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "16px", alignItems: "center" }}>
              <div><div style={CS.lbl}>Total Debt (excl. mortgage)</div><div style={{ fontSize: "22px", fontWeight: "900", color: T.red }}>{fmt(nonMortgageLiab)}</div></div>
              <div><div style={CS.lbl}>Monthly Payments</div><div style={{ fontSize: "22px", fontWeight: "900", color: T.gold }}>{fmt(totalMonthlyDebt)}</div></div>
              <div><div style={CS.lbl}>Debt-to-Income</div><div style={{ fontSize: "22px", fontWeight: "900", color: parseFloat(dti) < 36 ? T.green : parseFloat(dti) < 43 ? T.gold : T.red }}>{dti}%</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "2px" }}>Ideal: under 36%</div></div>
              <div><div style={CS.lbl}>Home Equity</div><div style={{ fontSize: "22px", fontWeight: "900", color: T.teal }}>{fmt(totalEquity)}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "2px" }}>Tracked separately</div></div>
            </div>

            {mortgages.length > 0 && (
              <div>
                <div style={{ fontSize: "11px", color: T.teal, fontWeight: "800", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px" }}>🏡 Home Equity — Not Counted in Net Worth</div>
                {mortgages.map(l => {
                  const lt = getLT(l.type);
                  const equity = (l.homeValue || 0) - l.currentBal;
                  const equityPct = l.homeValue > 0 ? (equity / l.homeValue) * 100 : 0;
                  const hv5  = Math.round((l.homeValue || 0) * Math.pow(1 + (l.homeAppreciation || 3.5) / 100, 5));
                  const hv10 = Math.round((l.homeValue || 0) * Math.pow(1 + (l.homeAppreciation || 3.5) / 100, 10));
                  const hv20 = Math.round((l.homeValue || 0) * Math.pow(1 + (l.homeAppreciation || 3.5) / 100, 20));
                  const payoffMo = Math.max(0, (l.termMonths || 360) - (l.monthsPaid || 0));
                  return (
                    <div key={l.id} style={{ ...CS.card, marginBottom: "14px", border: `1px solid ${T.teal}44` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                        <div>
                          <div style={{ fontWeight: "800", fontSize: "15px" }}>{lt.i} {l.name}</div>
                          <div style={{ fontSize: "11px", color: T.sub, marginTop: "2px" }}>{l.rate}% · {l.zipCode ? `Zip ${l.zipCode} · ` : ""}{l.notes}</div>
                        </div>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                          <div style={{ textAlign: "right" }}><div style={CS.lbl}>Est. Home Value</div><div style={{ fontSize: "18px", fontWeight: "900", color: T.teal }}>{fmt(l.homeValue)}</div></div>
                          <button onClick={() => openEditLiab(l)} title="Edit" style={{ background: "none", border: "none", cursor: "pointer", color: T.blue, fontSize: "16px", padding: 0 }}>✎</button>
                          <button onClick={() => delLiab(l.id)} title="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: "18px", padding: 0 }}>🗑</button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "14px", marginBottom: "14px" }}>
                        <div><div style={CS.lbl}>Loan Balance</div><div style={{ fontSize: "16px", fontWeight: "800", color: T.red }}>{fmt(l.currentBal)}</div></div>
                        <div><div style={CS.lbl}>Home Equity</div><div style={{ fontSize: "16px", fontWeight: "800", color: T.teal }}>{fmt(equity)}</div></div>
                        <div><div style={CS.lbl}>Equity %</div><div style={{ fontSize: "16px", fontWeight: "800", color: T.green }}>{equityPct.toFixed(1)}%</div></div>
                        <div><div style={CS.lbl}>Monthly Payment</div><div style={{ fontSize: "16px", fontWeight: "800", color: T.gold }}>{fmt(l.monthlyPayment)}</div></div>
                      </div>
                      <div style={{ marginBottom: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}><span style={{ fontSize: "10px", color: T.sub }}>Equity built</span><span style={{ fontSize: "10px", color: T.teal, fontWeight: "700" }}>{equityPct.toFixed(1)}%</span></div>
                        <PBar value={equity} max={l.homeValue || 1} color={T.teal} h={8} />
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", flexWrap: "wrap", gap: "4px" }}>
                          <span style={{ fontSize: "10px", color: T.sub }}>Payoff in {Math.floor(payoffMo/12)}yr {payoffMo%12}mo</span>
                          <span style={{ fontSize: "10px", color: T.sub }}>Original: {fmt(l.originalAmt)}</span>
                        </div>
                      </div>
                      <div style={{ background: T.s1, borderRadius: "10px", padding: "12px 16px" }}>
                        <div style={{ fontSize: "10px", color: T.teal, fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>📈 Projected Home Value ({l.homeAppreciation || 3.5}%/yr)</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: "10px" }}>
                          {[["Now", l.homeValue, T.sub], ["5 Years", hv5, T.cyan], ["10 Years", hv10, T.blue], ["20 Years", hv20, T.purple]].map(([label, val, color]) => (
                            <div key={label}>
                              <div style={{ fontSize: "9px", color: T.sub, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "3px" }}>{label}</div>
                              <div style={{ fontSize: "14px", fontWeight: "800", color: color }}>{fmt(val)}</div>
                              <div style={{ fontSize: "9px", color: T.sub }}>Equity: {fmt(val - l.currentBal)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {liabilities.filter(l => !getLT(l.type).isMortgage).length > 0 && (
              <div>
                <div style={{ fontSize: "11px", color: T.red, fontWeight: "800", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px", marginTop: "6px" }}>💳 Loans & Credit — Counted Against Net Worth</div>
                {liabilities.filter(l => !getLT(l.type).isMortgage).map(l => {
                  const lt = getLT(l.type);
                  const paidPct = l.originalAmt > 0 ? ((1 - l.currentBal / l.originalAmt) * 100) : 0;
                  const moRemain = l.termMonths > 0 ? Math.max(0, l.termMonths - l.monthsPaid) : 0;
                  const monthlyInterest = l.currentBal * (l.rate / 100 / 12);
                  const monthlyPrincipal = Math.max(0, l.monthlyPayment - monthlyInterest);
                  return (
                    <div key={l.id} style={{ ...CS.card, marginBottom: "12px", border: `1px solid ${lt.c}33` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
                        <div>
                          <div style={{ fontWeight: "800", fontSize: "14px" }}>{lt.i} {l.name}</div>
                          <div style={{ fontSize: "11px", color: T.sub, marginTop: "2px" }}>{l.rate}% interest · {l.notes}</div>
                        </div>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                          <div style={{ textAlign: "right" }}><div style={CS.lbl}>Balance</div><div style={{ fontSize: "18px", fontWeight: "900", color: lt.c }}>{fmt(l.currentBal)}</div></div>
                          <button onClick={() => openEditLiab(l)} title="Edit" style={{ background: "none", border: "none", cursor: "pointer", color: T.blue, fontSize: "16px", padding: 0 }}>✎</button>
                          <button onClick={() => delLiab(l.id)} title="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: "18px", padding: 0 }}>🗑</button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "12px", marginBottom: "12px" }}>
                        <div><div style={CS.lbl}>Monthly Payment</div><div style={{ fontSize: "14px", fontWeight: "700", color: T.gold }}>{fmt(l.monthlyPayment)}</div></div>
                        <div><div style={CS.lbl}>Principal/mo</div><div style={{ fontSize: "14px", fontWeight: "700", color: T.green }}>{fmt(monthlyPrincipal)}</div></div>
                        <div><div style={CS.lbl}>Interest/mo</div><div style={{ fontSize: "14px", fontWeight: "700", color: T.red }}>{fmt(monthlyInterest)}</div></div>
                        <div><div style={CS.lbl}>{moRemain > 0 ? `${Math.floor(moRemain/12)}yr ${moRemain%12}mo left` : "Revolving"}</div><div style={{ fontSize: "14px", fontWeight: "700", color: T.sub }}>{l.rate}% APR</div></div>
                      </div>
                      {l.originalAmt > 0 && (
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}><span style={{ fontSize: "10px", color: T.sub }}>Paid off</span><span style={{ fontSize: "10px", color: lt.c, fontWeight: "700" }}>{paidPct.toFixed(1)}%</span></div>
                          <PBar value={paidPct} max={100} color={lt.c} h={6} />
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", flexWrap: "wrap", gap: "4px" }}><span style={{ fontSize: "10px", color: T.sub }}>Original: {fmt(l.originalAmt)}</span><span style={{ fontSize: "10px", color: T.sub }}>Remaining: {fmt(l.currentBal)}</span></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {liabilities.length === 0 && <Empty icon="✅" text={`No liabilities yet. Click "+ Add Liability" if you have any loans, or leave this blank if you're debt-free.`} />}
          </div>
        )}

        {/* ══ RETIREMENT ══ */}
        {view === "retirement" && (
          isPro ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {[["overview","Overview"],["strategy","Strategy"],["dividends","💰 Dividends"]].map(([id, l]) => <button key={id} style={stab(retTab === id)} onClick={() => setRetTab(id)}>{l}</button>)}
                </div>
                <button style={btn(T.blue, "#fff")} onClick={() => { setGoalDraft({ ...goals }); setEditGoals(true); }}>Edit Goals</button>
              </div>

              {retTab === "overview" && (
                <div>
                  <div style={CS.g4}>
                    <div style={CS.card}><div style={CS.lbl}>Current Portfolio</div><div style={{ ...CS.big, color: T.purple }}>{fmt(retBal)}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "3px" }}>Retirement + Investment</div></div>
                    <div style={CS.card}><div style={CS.lbl}>Projected at {goals.retireAge}</div><div style={{ ...CS.big, color: onTrack ? T.green : T.gold }}>{fmt(projected)}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "3px" }}>{yrsLeft} yrs · {strat.ret}% return</div></div>
                    <div style={CS.card}><div style={CS.lbl}>Nest Egg Goal</div><div style={CS.big}>{fmt(goals.nestEgg)}</div></div>
                    <div style={{ ...CS.card, border: `1px solid ${onTrack ? T.green : T.red}` }}><div style={CS.lbl}>Gap / Surplus</div><div style={{ ...CS.big, color: onTrack ? T.green : T.red }}>{onTrack ? "+" : " "}{fmt(Math.abs(projected - goals.nestEgg))}</div></div>
                  </div>
                  <div style={{ ...CS.card, marginBottom: "18px" }}>
                    <div style={CS.sec}>Retirement Account Trend</div>
                    {retBal <= 0 ? (
                      <Empty icon="🏖️" text="No retirement or investment accounts yet. Add one to start tracking growth over time." />
                    ) : (
                      <ResponsiveContainer width="100%" height={160}>
                        <AreaChart data={retHist}>
                          <defs><linearGradient id="rg1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.purple} stopOpacity={0.35} /><stop offset="95%" stopColor={T.purple} stopOpacity={0} /></linearGradient></defs>
                          <XAxis dataKey="mo" axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 11 }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 10 }} tickFormatter={v => `$${Math.round(v/1000)}k`} />
                          <Tooltip content={<CTip />} />
                          <Area type="monotone" dataKey="bal" name="Portfolio Balance" stroke={T.purple} fill="url(#rg1)" strokeWidth={2.5} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div style={{ ...CS.card, marginBottom: "18px" }}>
                    <div style={CS.sec}>Projection to Retirement</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={projData}>
                        <defs>
                          <linearGradient id="projBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.blue} stopOpacity={0.3} /><stop offset="95%" stopColor={T.blue} stopOpacity={0} /></linearGradient>
                          <linearGradient id="projGreen" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.green} stopOpacity={0.1} /><stop offset="95%" stopColor={T.green} stopOpacity={0} /></linearGradient>
                        </defs>
                        <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 11 }} interval={Math.max(Math.floor(yrsLeft / 6), 1)} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 10 }} tickFormatter={v => `$${Math.round(v/1000)}k`} />
                        <Tooltip content={<CTip />} />
                        <Legend wrapperStyle={{ fontSize: "11px", color: T.sub }} />
                        <Area type="monotone" dataKey="goal"    name="Nest Egg Goal"    stroke={T.green} strokeDasharray="5 5" fill="url(#projGreen)" strokeWidth={2} />
                        <Area type="monotone" dataKey="balance" name="Projected Balance" stroke={T.blue}  fill="url(#projBlue)"  strokeWidth={2.5} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {retTab === "strategy" && (
                <div>
                  <div style={{ ...CS.card, marginBottom: "18px" }}>
                    <div style={CS.sec}>Investment Strategy</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "11px" }}>
                      {STRATS.map(s => {
                        const sel = goals.investStrategy === s.id;
                        return (
                          <div key={s.id} onClick={() => setGoals({ ...goals, investStrategy: s.id })}
                            style={{ ...CS.card, cursor: "pointer", border: `2px solid ${sel ? T.blue : T.border}`, background: sel ? "#081830" : T.s2, padding: "14px 16px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                              <span style={{ fontSize: "18px" }}>{s.i}</span>
                              <span style={{ fontSize: "9px", fontWeight: "700", padding: "2px 7px", borderRadius: "20px", background: s.risk === "Low" ? `${T.green}22` : s.risk === "High" ? `${T.red}22` : `${T.gold}22`, color: s.risk === "Low" ? T.green : s.risk === "High" ? T.red : T.gold }}>{s.risk}</span>
                            </div>
                            <div style={{ fontWeight: "800", fontSize: "12px", marginBottom: "3px", color: sel ? T.blue : T.text }}>{s.l}</div>
                            <div style={{ fontSize: "10px", color: T.sub, marginBottom: "5px" }}>{s.alloc}</div>
                            <div style={{ fontSize: "11px", color: "#6a9abc", lineHeight: "1.4", marginBottom: "7px" }}>{s.desc}</div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: "10px", color: T.sub }}>Expected</span><span style={{ fontSize: "13px", fontWeight: "900", color: T.green }}>~{s.ret}%/yr</span></div>
                            {sel && <div style={{ marginTop: "7px", padding: "4px", background: `${T.blue}22`, borderRadius: "5px", textAlign: "center", fontSize: "10px", color: T.blue, fontWeight: "700" }}>✓ Selected</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={CS.card}>
                    <div style={CS.sec}>Optimization Tips</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
                      {[
                        { i: "💰", t: `Adding $200/mo more adds ~${fmt(projRet(retBal, goals.monthlyInvest + 200, yrsLeft, strat.ret) - projected)} to your nest egg.` },
                        (() => {
                          // Pick the single most relevant tip for this user's actual
                          // numbers instead of a generic "retire later" suggestion.
                          const efMonthsHere = mExp > 0 ? (totalAssets * 0.15) / mExp : 0;
                          const highRateDebt = liabilities.filter(l => l.type !== "mortgage" && l.rate > 8).sort((a, b) => b.rate - a.rate)[0];
                          const dtiVal = parseFloat(dti) || 0;
                          if (mInc === 0) {
                            return { i: "📋", t: "Add your income and bills on the Transactions tab — retirement projections get sharper once your real cashflow is on file." };
                          }
                          if (efMonthsHere < 3) {
                            return { i: "🛡️", t: `Your emergency fund covers ~${efMonthsHere.toFixed(1)} months. Building it to 3 months (${fmt(mExp * 3)}) protects this retirement plan from being derailed by an unexpected expense.` };
                          }
                          if (highRateDebt) {
                            return { i: "📉", t: `Your ${highRateDebt.name} at ${highRateDebt.rate}% interest is costing more than most investments return. Paying it down first is a guaranteed ${highRateDebt.rate}% "return."` };
                          }
                          if (dtiVal > 36) {
                            return { i: "⚖️", t: `Debt-to-income is ${dtiVal.toFixed(0)}% — above the 36% healthy threshold. Reducing monthly debt payments frees up more room for retirement contributions.` };
                          }
                          if (goals.monthlyInvest < mInc * 0.15) {
                            return { i: "📈", t: `You're investing ${((goals.monthlyInvest / Math.max(mInc,1)) * 100).toFixed(0)}% of income. Reaching 15% is a common target for a comfortable retirement — that's ~${fmt(mInc * 0.15)}/month.` };
                          }
                          return { i: "🏦", t: "If your employer offers a 401(k) match, contributing enough to capture the full match is an immediate, guaranteed return before any other investing." };
                        })(),
                        { i: "🎯", t: "Max out your 401(k) at $23,500/yr to reduce taxable income and compound tax-deferred." },
                        { i: "🔄", t: "Annual portfolio rebalancing historically improves risk-adjusted returns by 0.5–1%." },
                      ].map((it, i) => (
                        <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "10px 12px", background: T.s1, borderRadius: "10px" }}>
                          <span style={{ fontSize: "17px", flexShrink: 0 }}>{it.i}</span>
                          <span style={{ fontSize: "11px", color: "#8ab0cc", lineHeight: "1.5" }}>{it.t}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <CfpSection goals={goals} retBal={retBal} projected={projected} strat={strat} yrsLeft={yrsLeft} />
                </div>
              )}

              {retTab === "dividends" && <DividendTracker holdings={divHoldings} setHoldings={setDivHoldings} />}

              {editGoals && (
                <div style={CS.modalWrap} onClick={() => setEditGoals(false)}>
                  <div style={CS.mbox} onClick={e => e.stopPropagation()}>
                    <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "18px" }}>Retirement Goals</div>
                    {[["Current Age","currentAge"],["Target Retirement Age","retireAge"],["Nest Egg Goal ($)","nestEgg"],["Monthly Investment ($)","monthlyInvest"]].map(([l, k]) => (
                      <div key={k} style={{ marginBottom: "13px" }}><div style={CS.lbl}>{l}</div><input style={CS.inp} type="number" value={goalDraft[k]} onChange={e => setGoalDraft({ ...goalDraft, [k]: parseFloat(e.target.value) || 0 })} /></div>
                    ))}
                    <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
                      <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setEditGoals(false)}>Cancel</button>
                      <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={() => { setGoals({ ...goals, ...goalDraft }); setEditGoals(false); }}>Save</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                <div style={CS.sec}>Retirement Overview</div>
                <button style={{ ...btn(null, "#fff"), background: T.gradGold, fontSize: "11px" }} onClick={() => setActiveModal("paywall")}>💎 Unlock Full Planning</button>
              </div>
              <div style={CS.g3}>
                <div style={CS.card}><div style={CS.lbl}>Retirement Portfolio</div><div style={{ ...CS.big, color: T.purple }}>{fmt(retBal)}</div></div>
                <div style={CS.card}><div style={CS.lbl}>Monthly Contributions</div><div style={{ ...CS.big, color: T.cyan }}>{fmt(goals.monthlyInvest)}</div></div>
                <div style={CS.card}><div style={CS.lbl}>Years to Retirement</div><div style={{ ...CS.big, color: T.gold }}>{yrsLeft}</div></div>
              </div>
              <div style={{ ...CS.card, marginBottom: "18px" }}>
                <div style={CS.sec}>Retirement Account Trend</div>
                {retBal <= 0 ? (
                  <Empty icon="🏖️" text="No retirement or investment accounts yet. Add one to start tracking growth over time." />
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={retHist}>
                      <defs><linearGradient id="rg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.purple} stopOpacity={0.35} /><stop offset="95%" stopColor={T.purple} stopOpacity={0} /></linearGradient></defs>
                      <XAxis dataKey="mo" axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 11 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: T.sub, fontSize: 10 }} tickFormatter={v => `$${Math.round(v/1000)}k`} />
                      <Tooltip content={<CTip />} />
                      <Area type="monotone" dataKey="bal" name="Portfolio Balance" stroke={T.purple} fill="url(#rg2)" strokeWidth={2.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={{ ...CS.card, border: `1px solid ${T.gold}44`, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, background: "rgba(5,8,15,.78)", backdropFilter: "blur(3px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 2, gap: "14px", padding: "20px" }}>
                  <div style={{ fontSize: "34px" }}>🔒</div>
                  <div style={{ fontSize: "17px", fontWeight: "900", background: T.gradGold, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", textAlign: "center" }}>Strategy + Dividends (Pro)</div>
                  <div style={{ color: T.sub, fontSize: "12px", textAlign: "center", maxWidth: "300px", lineHeight: "1.6" }}>Unlock investment strategies, dividend income calendar, 5/10/20 year forecasts, and retirement projections.</div>
                  <button style={{ ...btn(null, "#fff"), background: T.gradGold, padding: "10px 28px", fontSize: "13px" }} onClick={() => setActiveModal("paywall")}>Upgrade to Pro — $9.99/mo</button>
                </div>
                <div style={{ filter: "blur(4px)", pointerEvents: "none", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "11px" }}>
                  {STRATS.slice(0, 3).map(s => <div key={s.id} style={{ ...CS.card, padding: "14px 16px" }}><div style={{ fontSize: "20px", marginBottom: "6px" }}>{s.i}</div><div style={{ fontWeight: "800", fontSize: "12px", marginBottom: "3px" }}>{s.l}</div><div style={{ fontSize: "13px", fontWeight: "900", color: T.green, marginTop: "8px" }}>~{s.ret}%/yr</div></div>)}
                </div>
              </div>
            </div>
          )
        )}

        {/* ══ ACCOUNTS ══ */}
        {view === "accounts" && (
          <div>
            <BankSyncCard />
            <LinkedAccountsCard accounts={accounts} setAccounts={setAccounts} liabilities={liabilities} setLiabilities={setLiabilities} txns={txns} setTxns={setTxns} customRules={customRules} />
            <TransferCard />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
              <div style={CS.sec}>All Accounts</div>
              <button style={btn(T.blue, "#fff")} onClick={() => setActiveModal("account")}>+ Add Account</button>
            </div>
            {accounts.length === 0 && <Empty icon="🏦" text='No accounts yet. Add your checking, savings, or investment accounts to unlock net worth tracking.' action="+ Add Account ↑" />}
            {Object.entries(ATYPES).map(([type, meta]) => {
              const grp = accounts.filter(a => a.type === type);
              if (!grp.length) return null;
              return (
                <div key={type} style={{ marginBottom: "20px" }}>
                  <div style={{ fontSize: "11px", color: meta.c, fontWeight: "800", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>{meta.i} {meta.l}</div>
                  {grp.map(ac => (
                    <div key={ac.id} style={{ ...CS.card, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "10px" }} onClick={() => setSelAcct(ac.id)}>
                      <div><div style={{ fontWeight: "700", fontSize: "14px" }}>{ac.name}</div><div style={{ fontSize: "11px", color: T.sub, marginTop: "2px" }}>{ac.owner}</div></div>
                      <div style={{ textAlign: "right" }}><div style={{ fontWeight: "800", fontSize: "18px", color: meta.c }}>{fmtD(ac.balance)}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "1px" }}>{txns.filter(t => t.aId === ac.id).length} transactions →</div></div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* ══ TRANSACTIONS ══ */}
        {view === "transactions" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
              <div style={CS.sec}>Transactions</div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <AiBtn onClick={openAI} />
                <button style={btn(T.s3)} onClick={() => exportCSV(txns, accounts, liabilities)}>⬇ CSV</button>
                <button style={btn(T.green, "#000")} onClick={openAddTxn}>+ Add Transaction</button>
              </div>
            </div>

            <div style={{ ...CS.card, marginBottom: "14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "14px", alignItems: "center" }}>
              <div><div style={CS.lbl}>Monthly Income</div><div style={{ fontSize: "18px", fontWeight: "900", color: T.green }}>{fmt(mInc)}</div><div style={{ fontSize: "9px", color: T.sub }}>Fixed + this month</div></div>
              <div><div style={CS.lbl}>Fixed Costs</div><div style={{ fontSize: "18px", fontWeight: "900", color: T.red }}>{fmt(mExpFixed)}</div><div style={{ fontSize: "9px", color: T.sub }}>Recurring</div></div>
              <div><div style={CS.lbl}>Flexible Spend</div><div style={{ fontSize: "18px", fontWeight: "900", color: T.gold }}>{fmt(mExpLiveExtra)}</div><div style={{ fontSize: "9px", color: T.sub }}>This month, variable</div></div>
              <div><div style={CS.lbl}>Net Cashflow</div><div style={{ fontSize: "18px", fontWeight: "900", color: mCash >= 0 ? T.green : T.red }}>{fmt(mCash)}</div><div style={{ fontSize: "9px", color: T.sub }}>Live</div></div>
              <div><div style={CS.lbl}>Savings Rate</div><div style={{ fontSize: "18px", fontWeight: "900", color: T.cyan }}>{savRate}%</div></div>
            </div>
            <div style={{ marginBottom: "14px", fontSize: "10px", color: T.sub }}>
              💡 Income, expenses, and your health score update live as you add transactions this month — not just from your fixed recurring bills.
            </div>

            <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap" }}>
              {[["all","All Transactions"],["recurring","↻ Hard Costs (Recurring)"],["flexible","~ Flexible Spending"]].map(([id, l]) => (
                <button key={id} style={stab(txnTab === id)} onClick={() => setTxnTab(id)}>{l}</button>
              ))}
            </div>

            {txnTab === "recurring" && (
              <div style={{ ...CS.card, marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
                  <div><div style={{ fontWeight: "800", fontSize: "14px", marginBottom: "2px" }}>Recurring / Fixed Costs</div><div style={{ fontSize: "11px", color: T.sub }}>Bills and commitments that repeat monthly</div></div>
                  <button style={btn(T.blue, "#fff")} onClick={() => setShowRecModal(true)}>+ Add Recurring</button>
                </div>
                <div style={CS.g2}>
                  <div>
                    <div style={{ fontSize: "10px", color: T.green, fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>↑ Income</div>
                    {recurring.filter(r => r.type === "income").length === 0 && <Empty icon="💼" text="No income sources yet." />}
                    {recurring.filter(r => r.type === "income").map(r => (
                      <div key={r.id} style={CS.recRow}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: "15px" }}>{gc(r.cat).i}</span>
                          <div><div style={{ fontWeight: "600", fontSize: "12px", color: r.active ? T.text : T.sub }}>{r.desc}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "1px" }}>Day {r.day} · <Tag cat={r.cat} /></div></div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontWeight: "800", color: r.active ? T.green : T.sub, fontSize: "12px" }}>{fmt(r.amt)}</span>
                          <button style={{ padding: "2px 7px", borderRadius: "5px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", fontWeight: "700", background: T.s3, color: T.sub }} onClick={() => toggleRec(r.id)}>{r.active ? "Pause" : "Resume"}</button>
                          <button style={{ padding: "2px 7px", borderRadius: "5px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", fontWeight: "700", background: `${T.red}22`, color: T.red }} onClick={() => delRec(r.id)}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", color: T.red, fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>↓ Expenses</div>
                    {recurring.filter(r => r.type === "expense").length === 0 && <Empty icon="🧾" text="No recurring bills yet." />}
                    {recurring.filter(r => r.type === "expense").map(r => (
                      <div key={r.id} style={CS.recRow}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: "15px" }}>{gc(r.cat).i}</span>
                          <div><div style={{ fontWeight: "600", fontSize: "12px", color: r.active ? T.text : T.sub }}>{r.desc}</div><div style={{ fontSize: "10px", color: T.sub, marginTop: "1px" }}>Day {r.day} · <Tag cat={r.cat} /></div></div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontWeight: "800", color: r.active ? T.red : T.sub, fontSize: "12px" }}>{fmt(r.amt)}</span>
                          <button style={{ padding: "2px 7px", borderRadius: "5px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", fontWeight: "700", background: T.s3, color: T.sub }} onClick={() => toggleRec(r.id)}>{r.active ? "Pause" : "Resume"}</button>
                          <button style={{ padding: "2px 7px", borderRadius: "5px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", fontWeight: "700", background: `${T.red}22`, color: T.red }} onClick={() => delRec(r.id)}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {txnTab === "flexible" && (
              <div style={{ ...CS.card, marginBottom: "12px", padding: "10px 16px" }}>
                <div style={{ fontSize: "11px", color: T.sub, fontStyle: "italic" }}>Showing variable / one-off transactions — the costs families have the most control over.</div>
              </div>
            )}

            {shownTxns.length === 0 && <Empty icon="🧾" text="No transactions in this view yet." action="+ Add Transaction" />}
            {shownTxns.map(t => {
              const src = resolveTxnSource(t.aId, accounts, liabilities);
              return (
                <div key={t.id} style={CS.txnRow}>
                  <span style={{ fontSize: "18px" }}>{gc(t.cat).i}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: "600", fontSize: "13px" }}>{t.desc}{t.catNote && <span style={{ color: T.sub, fontWeight: "400" }}> — {t.catNote}</span>}</div>
                    <div style={{ fontSize: "10px", color: T.sub, marginTop: "1px" }}>{t.date} · {src ? src.name : ""}{src?.kind === "liability" && <span style={{ color: T.gold }}> 💳</span>}{t.rec && <span style={{ color: T.purple }}> ↻ recurring</span>}{t.synced && <span style={{ color: T.teal }}> · via Plaid</span>}{appPrefs.markUncategorizedReview && (t.cat === "other_exp" || t.cat === "other_inc") && <span style={{ color: T.gold, fontWeight: "700" }}> · Needs Review</span>}</div>
                  </div>
                  <Tag cat={t.cat} />
                  <div style={{ fontWeight: "800", fontSize: "13px", color: t.amt > 0 ? T.green : T.red, minWidth: "82px", textAlign: "right" }}>{t.amt > 0 ? "+" : ""}{fmtD(t.amt)}</div>
                  <button onClick={() => openEditTxn(t)} title="Edit" style={{ background: "none", border: "none", cursor: "pointer", color: T.blue, fontSize: "13px", padding: "0 4px" }}>✎</button>
                  <button onClick={() => deleteTxn(t)} title="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: "13px", padding: "0 4px" }}>✕</button>
                </div>
              );
            })}
          </div>
        )}
        <DisclaimerFooter onOpen={() => setShowDisclaimer(true)} />
      </div>

      {/* ── Global Modals — TxnModal & LiabModal are module-scope components now,
             so they receive explicit props instead of closing over App's state.
             This is what fixes the focus-loss-while-typing bug. ── */}
      {activeModal === "txn" && (
        <TxnModal
          form={txnForm} setForm={setTxnForm} accounts={accounts} liabilities={liabilities}
          onCancel={() => { setActiveModal(null); setEditingTxnId(null); }}
          onSubmit={submitTxn} isEdit={!!editingTxnId}
        />
      )}
      {activeModal === "liab" && (
        <LiabModal
          form={liabForm} setForm={setLiabForm}
          onCancel={() => { setActiveModal(null); setEditingLiabId(null); }}
          onSubmit={submitLiab} isEdit={!!editingLiabId}
        />
      )}
      {activeModal === "paywall" && <Paywall onClose={() => setActiveModal(null)} onUpgrade={() => { setIsPro(true); setActiveModal(null); setView("retirement"); }} />}
      {activeModal === "account" && (
        <div style={CS.modalWrap} onClick={() => setActiveModal(null)}>
          <div style={CS.mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "18px" }}>Add Account</div>
            {[["Account Name","name","text"],["Owner","owner","text"],["Starting Balance ($)","balance","number"]].map(([l, k, t]) => (
              <div key={k} style={{ marginBottom: "13px" }}><div style={CS.lbl}>{l}</div><input style={CS.inp} type={t} value={acctForm[k]} onChange={e => setAcctForm({ ...acctForm, [k]: e.target.value })} /></div>
            ))}
            <div style={{ marginBottom: "13px" }}>
              <div style={CS.lbl}>Account Type</div>
              <select style={CS.inp} value={acctForm.type} onChange={e => setAcctForm({ ...acctForm, type: e.target.value })}>
                {Object.entries(ATYPES).map(([k, v]) => <option key={k} value={k}>{v.i} {v.l}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
              <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setActiveModal(null)}>Cancel</button>
              <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={addAcct}>Add</button>
            </div>
          </div>
        </div>
      )}
      {showRecModal && (
        <div style={CS.modalWrap} onClick={() => setShowRecModal(false)}>
          <div style={CS.mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "18px" }}>Add Recurring Item</div>
            <div style={{ marginBottom: "13px" }}>
              <div style={CS.lbl}>Type</div>
              <select style={CS.inp} value={recForm.type} onChange={e => setRecForm({ ...recForm, type: e.target.value, cat: e.target.value === "income" ? "salary" : "housing" })}>
                <option value="income">Income</option><option value="expense">Expense</option>
              </select>
            </div>
            <div style={{ marginBottom: "13px" }}>
              <div style={CS.lbl}>Category</div>
              <select style={CS.inp} value={recForm.cat} onChange={e => setRecForm({ ...recForm, cat: e.target.value })}>
                {(recForm.type === "income" ? INC : EXP).map(c => <option key={c.id} value={c.id}>{c.i} {c.l}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: "13px" }}><div style={CS.lbl}>Description</div><input style={CS.inp} placeholder="e.g. Mortgage, Netflix…" value={recForm.desc} onChange={e => setRecForm({ ...recForm, desc: e.target.value })} /></div>
            <div style={{ marginBottom: "13px" }}><div style={CS.lbl}>Monthly Amount ($)</div><input style={CS.inp} type="number" placeholder="0.00" value={recForm.amt} onChange={e => setRecForm({ ...recForm, amt: e.target.value })} /></div>
            <div style={{ marginBottom: "18px" }}><div style={CS.lbl}>Day of Month</div><input style={CS.inp} type="number" min="1" max="31" placeholder="1" value={recForm.day} onChange={e => setRecForm({ ...recForm, day: e.target.value })} /></div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setShowRecModal(false)}>Cancel</button>
              <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={addRec}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Insurance modal — whole life, term life, disability ── */}
      {showInsurance && (
        <div style={CS.modalWrap} onClick={() => setShowInsurance(false)}>
          <div style={{ ...CS.mbox, width: "480px" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: "800", fontSize: "17px", marginBottom: "6px" }}>Insurance Coverage</div>
            <div style={{ fontSize: "11px", color: T.sub, marginBottom: "14px" }}>This protects the income that funds your entire plan — it factors into your Wealth Building score. Answer "No" if you don't have a policy — that still counts as complete.</div>

            <button onClick={() => setShowDocAnalyzer(true)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", borderRadius: "10px", border: `1px solid ${T.blue}44`, background: `${T.blue}12`, cursor: "pointer", fontFamily: "inherit", marginBottom: "18px", textAlign: "left" }}>
              <span style={{ fontSize: "20px" }}>📄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "12px", fontWeight: "700", color: T.blue }}>Upload a policy document</div>
                <div style={{ fontSize: "10px", color: T.sub }}>Let AI read your coverage, find gaps, and estimate payout limits</div>
              </div>
              <span style={{ color: T.blue, fontSize: "16px" }}>→</span>
            </button>

            {insurance.docAnalysis && (
              <div style={{ background: T.s1, borderRadius: "10px", padding: "12px 14px", marginBottom: "18px", border: `1px solid ${T.green}33` }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                  <span style={{ fontSize: "13px" }}>✅</span>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: T.green }}>Document analyzed</span>
                  <span style={{ marginLeft: "auto", fontSize: "9px", color: T.sub }}>{new Date(insurance.docAnalysis.analyzedAt).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: "11px", color: "#8ab4cc", lineHeight: "1.5" }}>{insurance.docAnalysis.summary}</div>
              </div>
            )}

            {[
              { key: "termLife",   icon: "🛡️", label: "Term Life Insurance",
                fields: [["coverage","Coverage ($)","500000",false],["termYears","Term (years)","20",false],["monthlyPremium","Monthly Premium ($)","35",true]] },
              { key: "wholeLife",  icon: "🏛️", label: "Whole Life Insurance",
                fields: [["coverage","Coverage ($)","250000",false],["monthlyPremium","Monthly Premium ($)","150",false]] },
              { key: "disability", icon: "♿", label: "Disability Insurance",
                fields: [["monthlyBenefit","Monthly Benefit ($)","3000",false],["monthlyPremium","Monthly Premium ($)","45",false]] },
            ].map(policy => {
              const val = insuranceDraft[policy.key];
              const setPolicy = patch => setInsuranceDraft({ ...insuranceDraft, [policy.key]: { ...val, ...patch } });
              return (
                <div key={policy.key} style={{ background: T.s1, borderRadius: "10px", padding: "14px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "13px", fontWeight: "700", marginBottom: "10px" }}>{policy.icon} {policy.label}</div>
                  <div style={{ display: "flex", gap: "6px", marginBottom: (val.answered && val.has) ? "12px" : 0 }}>
                    <button onClick={() => setPolicy({ answered: true, has: true })}
                      style={{ flex: 1, padding: "8px", borderRadius: "7px", border: `2px solid ${val.answered && val.has ? T.green : T.border}`, background: val.answered && val.has ? `${T.green}22` : T.s2, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: "700", color: val.answered && val.has ? T.green : T.sub }}>
                      Yes, I have this
                    </button>
                    <button onClick={() => setPolicy({ answered: true, has: false })}
                      style={{ flex: 1, padding: "8px", borderRadius: "7px", border: `2px solid ${val.answered && !val.has ? T.blue : T.border}`, background: val.answered && !val.has ? `${T.blue}22` : T.s2, cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: "700", color: val.answered && !val.has ? T.blue : T.sub }}>
                      No, I don't
                    </button>
                    {!val.answered && (
                      <span style={{ flex: "0 0 auto", padding: "8px 10px", fontSize: "10px", color: T.gold, fontWeight: "700", alignSelf: "center" }}>Unanswered</span>
                    )}
                  </div>
                  {val.answered && val.has && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      {policy.fields.map(([field, label, placeholder, spanFull]) => (
                        <div key={field} style={spanFull ? { gridColumn: "1 / -1" } : undefined}>
                          <div style={CS.lbl}>{label}</div>
                          <input style={CS.inp} type="number" placeholder={placeholder} value={val[field] || ""}
                            onChange={e => setPolicy({ [field]: field === "termYears" ? (parseInt(e.target.value) || 0) : (parseFloat(e.target.value) || 0) })} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{ display: "flex", gap: "10px" }}>
              <button style={{ ...btn(T.s3), flex: 1 }} onClick={() => setShowInsurance(false)}>Cancel</button>
              <button style={{ ...btn(T.blue, "#fff"), flex: 1 }} onClick={() => { setInsurance(insuranceDraft); setShowInsurance(false); }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showDocAnalyzer && (
        <InsuranceDocAnalyzer
          mInc={mInc} annInc={annInc}
          onApplyFindings={applyDocFindings}
          onClose={() => setShowDocAnalyzer(false)}
        />
      )}

      {showAI && <AiPanel context={aiCtx} onClose={() => setShowAI(false)} />}
      {showDisclaimer && <DisclaimerModal onClose={acknowledgeDisclaimer} />}
      {renderAppChrome()}
    </div>
  );
}
