import { API_BASE_URL } from "@/constants/config";

/**
 * Client for the KaventaFi API. Every request carries the signed-in
 * user's session token (Authorization: Bearer); the server decides what the
 * account may see, so nothing here is trusted for access control.
 * Pattern from DFS-Riches mobile/lib/api.ts.
 */

/** Returns the session token; `fresh` skips any cached copy. */
type TokenSource = (fresh?: boolean) => Promise<string | null>;
let tokenSource: TokenSource = async () => null;

/** Set by the auth provider once someone signs in (and reset on sign-out). */
export function setTokenSource(fn: TokenSource | null) {
  tokenSource = fn ?? (async () => null);
}

export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
  /** The account needs Pro for this (HTTP 402). */
  get proRequired() {
    return this.status === 402;
  }
}

export const apiConfigured = () => API_BASE_URL.length > 0;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiConfigured()) {
    throw new ApiError("Not connected to the KaventaFi service yet.", 0, "not_configured");
  }
  const call = async (fresh: boolean) => {
    const token = await tokenSource(fresh);
    return fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  };
  let res: Response;
  try {
    res = await call(false);
    // A turned-down session gets one quiet retry with a fresh token.
    if (res.status === 401) res = await call(true);
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0, "network");
  }
  if (!res.ok) {
    let message = `Something went wrong (${res.status}).`;
    let code: string | null = null;
    try {
      const body = await res.json();
      const detail = body?.detail;
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail) && detail[0]?.msg) {
        // Validation errors (422): the first problem, without Pydantic's prefix.
        message = String(detail[0].msg).replace(/^Value error, /, "");
        code = "invalid";
      } else if (detail && typeof detail === "object") {
        message = detail.message ?? message;
        code = detail.code ?? null;
      }
    } catch {
      // not JSON: keep the generic message
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  me: () => request<MeResponse>("/api/me"),
  searchStocks: (q: string) =>
    request<{ results: StockSearchResult[]; data_mode: DataMode }>(`/api/stocks/search?q=${enc(q)}`),
  matrix: (symbol: string) => request<StockMatrix>(`/api/stocks/${enc(symbol)}/matrix`),
  fcf: (symbol: string) => request<FcfAnalysis>(`/api/stocks/${enc(symbol)}/fcf`),
  roic: (symbol: string) => request<RoicAnalysis>(`/api/stocks/${enc(symbol)}/roic`),
  dividendGrowth: (symbol: string) =>
    request<DividendGrowthAnalysis>(`/api/stocks/${enc(symbol)}/dividend-growth`),
  capitalAllocation: (symbol: string) =>
    request<CapitalAllocationAnalysis>(`/api/stocks/${enc(symbol)}/capital-allocation`),
  portfolioOverview: (source: PortfolioSource) =>
    request<PortfolioOverview>(`/api/portfolio/overview?source=${source}`),
  portfolioPerformance: (source: PortfolioSource) =>
    request<PerformanceResponse>(`/api/portfolio/performance?source=${source}`),
  portfolioIncome: (source: PortfolioSource, target: number) =>
    request<IncomeAnalysis>(`/api/portfolio/income?source=${source}&target=${target}`),
  plaidStatus: () => request<PlaidStatus>("/api/plaid/status"),
  plaidSync: () => request<{ status: string }>("/api/plaid/sync", { method: "POST" }),
  /** "new" links an institution; "update" repairs the existing link and keeps its history. */
  plaidLinkToken: (mode: "new" | "update" = "new") =>
    request<{ link_token: string }>(`/api/plaid/create-link-token?mode=${mode}`, { method: "POST" }),
  plaidReconnected: () => request<{ status: string }>("/api/plaid/reconnected", { method: "POST" }),
  plaidExchange: (publicToken: string) =>
    request<{ status: string }>("/api/plaid/exchange-public-token", {
      method: "POST",
      body: JSON.stringify({ public_token: publicToken }),
    }),
  exportMyData: () => request<Record<string, unknown>>("/api/me/export"),
  deleteMyData: () =>
    request<{ deleted: Record<string, number>; note: string | null; bank_link_revoked: boolean | null }>("/api/me", { method: "DELETE" }),
  checkout: (returnUrl: string) =>
    request<{ url: string }>("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ success_url: returnUrl, cancel_url: returnUrl }),
    }),
  billingPortal: (returnUrl: string) =>
    request<{ url: string }>("/api/billing/portal", {
      method: "POST",
      body: JSON.stringify({ success_url: returnUrl, cancel_url: returnUrl }),
    }),
  syncBilling: () => request<Entitlement>("/api/billing/sync", { method: "POST" }),
  subscriptions: () => request<SubscriptionsResponse>("/api/subscriptions"),
  createSubscription: (body: SubscriptionInput) =>
    request<Subscription>("/api/subscriptions", { method: "POST", body: JSON.stringify(body) }),
  updateSubscription: (id: string, body: SubscriptionInput) =>
    request<Subscription>(`/api/subscriptions/${enc(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteSubscription: (id: string) => request<null>(`/api/subscriptions/${enc(id)}`, { method: "DELETE" }),
};

export type PortfolioSource = "linked" | "demo";
