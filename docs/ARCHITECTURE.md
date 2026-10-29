# Architecture

## 1. Repository comparison: what was adopted and why

| Source | Pattern | Where it landed in KaventaFi | Why |
|---|---|---|---|
| **DFS-Riches** `app/accounts.py` | Clerk RS256 session-JWT verification against the instance JWKS (rate-limited refresh, `azp` allow-list) | `backend/auth.py` | KaventaFi had **no authentication**: every route trusted a `user_id` in the URL or body |
| DFS-Riches `accounts.plan()` / `entitled()` + `_require_feature` → 402 | Server-side plan resolution and feature gating, `PRO_GATING` switch for staged rollout | `backend/entitlements.py` | KaventaFi's "Pro" was a client-side boolean (`isPro` in the prototype) |
| DFS-Riches `app/guard.py` | Sliding-window rate limits per client and bucket, body-size caps, Cloudflare-aware client IP | `backend/guard.py` | No abuse protection existed |
| DFS-Riches `app/cache.py` | TTL cache, in-flight de-duplication, stale-on-error fallback, LRU cap | `backend/providers/cache.py` | Provider calls had no caching, and an outage would have broken screens |
| DFS-Riches account export/delete (`/api/me`) | User-initiated export and deletion | `backend/api_account.py` | Privacy and commercial-readiness requirement |
| DFS-Riches mobile `lib/api.ts` | Token source, one quiet retry on 401, server `detail` surfaced as the error | `lib/api.ts` | Consistent auth and error handling for every request |
| DFS-Riches mobile `ProLock`, `StatusView`, `Skeleton` | Locked previews, loading, error and empty states | `components/pro-lock.tsx`, `status-view.tsx`, `skeleton.tsx` | KaventaFi had no loading, error or locked states. Unlike DFS's version, KaventaFi's `ProLock` never renders the locked content. |
| DFS-Riches tests layout | pytest per module, API tests through the real app with dependency overrides | `backend/tests/` | KaventaFi had no tests |
| **GSAP-Web-dom** | Staggered entrance motion (`stagger`, `expo.out`) | Reanimated `FadeInDown` with per-item delay on the research list and matrix sections. Reanimated respects the system reduce-motion setting. | Same feel without adding GSAP, which targets the DOM and doesn't run in React Native |
| GSAP-Web-dom `constants/index.js` | Content as data (lists rendered from constants) | `PRO_FEATURE_COPY`, `QUESTIONS`, the disclosure `SECTIONS` | Copy edits don't touch layout code |

**Not adopted:** DFS-Riches' NFL modeling and LLM agents, and GSAP itself plus its video and scroll pinning.
They don't apply to a React Native finance app. No code was copied verbatim. Both reference repos belong
to the same owner, so licensing isn't a concern; patterns were adapted to KaventaFi's conventions (NativeWind v5
`@utility` classes, global `type.d.ts`, flat backend modules).

## 2. What changed

```
mobile app (Expo SDK 54, expo-router)                 backend (FastAPI)
─────────────────────────────────────                 ──────────────────────────────────────────────
app/(tabs)/insights.tsx  research hub   ─┐            main.py      legacy Plaid/transfer routes, now authed
app/stocks/[symbol].tsx  matrix + Pro    │  HTTPS     ├─ guard.py  rate limits, body caps (outermost)
app/portfolio.tsx        overview + Pro  ├──Bearer───▶├─ auth.py   Clerk JWT → User (or 401)
app/pro.tsx              upgrade/manage  │  JWT       ├─ entitlements.py  plan from Subscription → 402
app/disclosures.tsx                      │            ├─ api_stocks.py     /api/stocks/*
app/(tabs)/settings.tsx  plan/export/del ┘            ├─ api_portfolio.py  /api/portfolio/*
lib/api.ts  lib/entitlements.tsx  lib/format.ts       ├─ api_account.py    /api/me, /api/billing/*
components/*  (ProLock, MetricRow, charts…)           │
                                                      ├─ analytics/   pure calculation engine (no I/O)
                                                      │    models · metric · growth · fundamentals
                                                      │    capital · stock · portfolio · income
                                                      ├─ providers/   adapters behind Protocols
                                                      │    tiingo · demo · registry · cache
                                                      ├─ billing.py   Stripe + RevenueCat adapters, idempotent apply
                                                      ├─ plaid_ledger.py  Plaid investment txns → ledger
                                                      ├─ tasks.py     Celery syncs (Plaid), allow-listed fetches
                                                      └─ database.py · models.py · crypto.py · migrations/
```

Layering rules: `analytics/` imports nothing outside itself, `providers/` produce only `analytics.models`
types, routes compose the two, and the UI only formats.

### Defects fixed in the existing code

- The API couldn't start: `database`, `crypto`, `market_data`, `dividend_analytics` and `tasks` were imported
  but never committed. `plaid.Environment.Development` and `LinkTokenCreateRequestTransactions` no longer
  exist in plaid-python 46.
- **Authorization:** `/api/accounts/{user_id}`, `/api/transactions/{user_id}`,
  `/api/dividends/confirmed/{user_id}`, link-token, token-exchange and transfer endpoints accepted any user id
  from anyone. They now require a session and serve only the caller. Transfers must target the caller's own
  synced account and an approved authorization the caller created.
- **Plaid webhooks:** "verification" accepted any non-empty header. Webhooks are now checked against Plaid's
  ES256 JWT (key fetched by `kid`), with a 5-minute age limit and a body SHA-256 match.
- **SSRF:** `/api/alt-data/scrape` let anyone make the server fetch any URL. It's now admin-only, HTTPS-only,
  limited to an allow-list of hosts, and doesn't follow redirects.
- `/api/health/db` leaked exception text. Plaid enum objects were stored un-coerced, so the "approved" check
  could never match. The `months` parameter was unbounded.

## 3. Feature inventory

**Preserved:** home screen with subscriptions and upcoming renewals, tab navigation, fonts and theme, all
legacy API routes and response shapes (`/api/market/dividend-analytics` keeps the prototype's field names),
Plaid linking, sync and transfer flows, and the prototype in `reference/`.

**New (free):** stock search; the analysis matrix (historical growth, projected growth, capital intensity,
balance sheet, dividends) with inspectable formulas; the dividend-per-share chart; side-by-side comparison
of up to 2 stocks (API); the portfolio overview; data export and deletion; methodology and disclosures.

**New (Pro):** FCF growth history and comparison with the S&P 500; ROIC (current, ex-goodwill, incremental,
vs the S&P 500); dividend growth vs the S&P 500 with consistency and coverage; capital allocation and the
growth model; portfolio performance across nine windows (TWR, MWR, volatility, drawdown); income growth
(actual, organic, projected, attribution, vs the S&P 500); CSV export; comparing up to 8 stocks.

## 4. Subscription matrix and enforcement points

| Feature | Free | Pro | Enforced at |
|---|:-:|:-:|---|
| Stock matrix, search, dividend history | ✓ | ✓ | `current_user` only |
| Compare stocks | 2 | 8 | `api_stocks.compare` → 402 above the limit |
| FCF vs S&P 500 | — | ✓ | `require_feature("fcf_vs_benchmark")` on `GET /api/stocks/{s}/fcf` |
| ROIC analysis | — | ✓ | `require_feature("roic")` on `/roic` |
| Dividend growth vs S&P 500 | — | ✓ | `require_feature("dividend_vs_benchmark")` on `/dividend-growth` |
| Capital allocation | — | ✓ | `require_feature("capital_allocation")` on `/capital-allocation` |
| CSV export of analyses | — | ✓ | `require_feature("export")` on `/export.csv` |
| Portfolio overview | ✓ | ✓ | `current_user` |
| Portfolio performance (9 windows) | — | ✓ | `require_feature("portfolio_performance")` on GET and POST `/api/portfolio/performance` |
| Income growth and attribution | — | ✓ | `require_feature("portfolio_income_growth")` on GET and POST `/api/portfolio/income` |
| Income vs S&P 500 | — | ✓ | Benchmark omitted from the response unless `portfolio_income_vs_benchmark` is allowed |
| Export and delete my data | ✓ | ✓ | `current_user`; never gated |

`require_feature` runs as a FastAPI dependency, **before** the handler loads or computes anything, so a Free
request gets a 402 with `{code: "pro_required", feature, message}` and no data. The plan comes only from
the `subscriptions` row written by verified webhooks (or `ADMIN_USER_IDS` / `COMPLIMENTARY_PRO_USER_IDS`).
Client headers or parameters can't change it; `test_client_cannot_claim_pro` checks this. Existing
entitlements: KaventaFi had none server-side to migrate. Founders and testers can be kept on Pro with
`COMPLIMENTARY_PRO_USER_IDS`.

States: `active` / `trialing` → Pro until period end + `GRACE_DAYS` (covers a late renewal webhook).
`past_due` → Pro until the provider's grace end, or period end + grace. `canceled` → Pro until the paid
period ends. `expired`, `paused` and `incomplete` → Free. An `active` row whose period ended more than
`GRACE_DAYS` ago is treated as expired, so a lost webhook can't grant access forever.
