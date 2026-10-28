# Launch report: testing, performance, security, outstanding work

## Testing

| Suite | Command | Result |
|---|---|---|
| Backend unit and API tests (on SQLite and Postgres) | `cd backend && pip install -r requirements-dev.txt && pytest tests` | **149 passed** |
| App unit tests (`lib/format.ts`) | `npm test` (Node's built-in runner, no extra dependency) | **9 passed** |
| TypeScript | `npx tsc --noEmit` | clean |
| Lint | `npx expo lint` | clean |
| Web build | `npx expo export --platform web` | builds |
| Rendered check | Web build against the API in demo mode, captured in Chromium (light and dark, 390px wide) | all screens render; a table-layout bug found this way was fixed (see below) |

Coverage by area:
- **Formulas:** known values plus negative, zero and missing inputs for CAGR, FCF, margins, coverage,
  leverage, NOPAT and tax fallback, ROIC (average, ex-goodwill, negative capital), incremental ROIC, payout,
  reinvestment, allocation and the growth model.
- **Portfolio:** deposits not credited as performance, TWR equals price growth despite flows, all nine
  windows, annualization, young portfolio, dividends counted once, DRIP, splits, implicit funding, missing
  prices, duplicates, weekend events, XIRR, price-only labeling.
- **Income:** organic vs new money, new positions, split-adjusted DPS, partial first year, no dividends.
  Attribution sums are checked exactly.
- **Subscriptions:** Free gets 402 with no data on all 7 Pro endpoints, Pro gets 200, ten subscription
  states, a client claiming Pro is refused, Stripe signature (bad, old, missing), duplicate and stale
  webhooks, RevenueCat lifecycle and auth, checkout return-URL allow-list.
- **Isolation:** legacy `/{user_id}` routes return 403 for other users, linked portfolios are scoped,
  export and delete touch only the caller.
- **Infrastructure:** rate limiter, buckets, client IP, cache de-duplication and stale fallback, Plaid
  ledger mapping (DRIP de-duplication, split ratio).

Bugs found and fixed while testing:
- `table-row` and `table-cell` collided with built-in Tailwind utilities, which broke table layout on web.
- A non-payer's dividend CAGR read "not meaningful" instead of "doesn't pay a dividend".
- A "▼ +1.0%" glyph conflict; favorability now uses check/alert icons.
- "−$0.00" float dust.
- The comparable-holdings rule excluded positions bought on the year's first trading day.

**Gaps:**
- JS unit tests cover only `lib/format.ts`; components and screens have none (add `jest-expo` for those).
- No device end-to-end runs (iOS/Android simulators weren't available here); the web build was checked
  instead.
- The Tiingo and Plaid live paths aren't exercised (no credentials).
- The web static export logs React hydration warning #418 because the server-rendered HTML has no data or
  color scheme. This is web-only and cosmetic.

## Performance (measured locally, demo mode)

| Endpoint | Latency | Payload (gzip) |
|---|---|---|
| `GET /api/stocks/{s}/matrix` | 10 ms | 11.8 KB (2.9 KB) |
| `GET /api/stocks/{s}/roic` | 16 ms | 2.7 KB (1.1 KB) |
| `GET /api/portfolio/performance` (8 years daily, 9 windows) | 118 ms | 85 KB (23 KB) |
| `GET /api/portfolio/income` | 64 ms | 8.6 KB (2.6 KB) |

- Chart series are downsampled to at most 120 points per window.
- Prices for all holdings and the benchmark are fetched concurrently.
- Provider calls are cached with in-flight de-duplication.
- GZip is on for responses of 1 KB and up.
- Free accounts don't request Pro endpoints at all.

**Remaining bottleneck:** performance replays the whole ledger once per request. That's fine at
thousands of transactions; cache per user (invalidated on sync) if it grows.

## Security

- **Authentication:** Clerk session JWT on every `/api/` route except `/`, the health checks and the
  webhooks. `REQUIRE_SIGN_IN=0` is refused in production.
- **Isolation:** per-user queries filter on the verified user id. Legacy routes reject a mismatched path or
  body id with 403. Transfers check account ownership and the caller's own approved authorization.
- **Billing integrity:**
  - Stripe uses HMAC signatures with a 5-minute tolerance and constant-time comparison.
  - RevenueCat requires a shared Authorization secret.
  - Each event id is applied once, and stale events are ignored.
  - The user id comes from server-set checkout metadata, never from the client.
  - Checkout return URLs are allow-listed.
- **Plaid:** webhooks are JWT-verified with a body hash. Access tokens are encrypted with Fernet and can be
  rotated (`FERNET_OLD_KEYS`). Tokens are excluded from data exports.
- **Abuse:** per-IP rate limits and a 1 MB body cap. The scraping endpoint is admin-only and limited to an
  allow-list of hosts.
- **Secrets:** server-only. The app bundle contains only the API URL. The Tiingo key is sent in a header,
  never a URL.
- **Known risks:**
  - The rate limiter is in-memory (per instance).
  - `BillingEvent` rows are anonymized, not deleted, on account deletion (they hold no personal data
    besides the id, which is nulled).
  - Deleting data doesn't delete the Clerk account itself; DFS-Riches does this with `CLERK_SECRET_KEY` and
    it can be ported.
  - No error-reporting service is wired.
  - No backup automation beyond Supabase's built-in daily backups.

## Outstanding work (priority order)

1. ~~Sign-in in the app~~ — done: Clerk sign-in and sign-up (shared Riches Digital Ventures instance), every
   screen except the disclosures requires an account, and `lib/session.tsx` hands the session token to the API.
2. **Licensed data:** an S&P 500 aggregates file, a Tiingo commercial plan with fundamentals (and the data
   code mapping verified), and an estimates provider.
3. **In-app purchase:** add `react-native-purchases` (needs a development build) for App Store and Play
   compliance. The server side is done.
4. **Plaid in the app:** port the prototype's Link flow (`reference/MindfulMoneyManagement.jsx`
   `BankSyncCard`), and add `/investments/holdings/get` opening balances for positions older than Plaid's
   24 months of history.
5. **Manual holdings entry:** the API accepts posted ledgers (`POST /api/portfolio/performance|income`), but
   the app has no editor yet.
6. Error reporting and monitoring, Alembic, a JS test runner, the Clerk account deletion call, and a
   Redis-backed rate limiter for multiple instances.
7. A comparison screen in the app (the API supports it) and CSV export from the stock screen (the endpoint
   exists).
