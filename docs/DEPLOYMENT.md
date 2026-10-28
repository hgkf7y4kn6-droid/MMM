# Deployment and operations

## Components

| Piece | Runs as | Needs |
|---|---|---|
| API | `uvicorn main:app --host 0.0.0.0 --port $PORT` from `backend/` | Python 3.12+, `pip install -r requirements.txt` |
| Worker (optional) | `celery -A tasks worker -B --loglevel=info` from `backend/` (`-B` adds the 6-hourly fallback sync) | Redis (`REDIS_URL`). Without `REDIS_URL` the API runs syncs itself in a background thread, and refreshes a stale linked account when the portfolio is opened, so no paid worker is required to start. |
| Database | Supabase Postgres (`DATABASE_URL`) | Tables are created and locked down at startup |
| App | Expo / EAS builds; web via `npx expo export --platform web` | `EXPO_PUBLIC_API_URL` |

## Render

| Service | Type | Build command | Start / publish |
|---|---|---|---|
| `mmm-api` | Python web service, `PYTHON_VERSION=3.12.7` | `cd backend && pip install -r requirements.txt` | `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT` |
| `mmm-web` | Static site | `npm ci && npx expo export --platform web` | publish `dist`; add a rewrite rule `/*` → `/index.html` (the web app is a single-page app) |

`EXPO_PUBLIC_API_URL` on `mmm-web` is read at **build** time, so redeploy the site after changing it. Add
the site's URL to `ALLOWED_ORIGINS` on `mmm-api`.

**Custom domain:** the web app is served at `mmm.richesdigitalventures.com` — a CNAME from `mmm` to
`mmm-web-0p2b.onrender.com`, added under the static site's Settings → Custom Domains.

**Sign-in:** the app uses the Riches Digital Ventures production Clerk instance (`clerk.richesdigitalventures.com`,
shared with Riches Analytics). The publishable key is built into `constants/config.ts`; the API needs the same
key in `CLERK_PUBLISHABLE_KEY` and `https://mmm.richesdigitalventures.com` in `CLERK_AUTHORIZED_PARTIES`.
Production Clerk keys only work on the instance's domain and its subdomains, so the `onrender.com` URL shows
the sign-in page but can't sign in. The API's own repo-root `package.json` is the Expo app,
so a Node web service pointed at the repo root can't run anything; that's why the API is a Python service.

### Why sign-in and password emails don't say "Mindful Money"

Sign-in codes and password emails are sent by Clerk, not by this repo, and the Riches Digital Ventures Clerk
instance is shared by every app that uses it. Their sender name, subject and body come from the instance's
**Customization → Emails** templates and its **Application name** (Clerk dashboard → Configure → Customization), which
apply to all apps at once. If those still name DFS Riches, the emails will say so whichever app asked for them.
Fix, in the Clerk dashboard (no code change):

1. Set the instance's application name to a neutral brand ("Riches Digital Ventures") and edit the *Verification code*
   and *Reset password code* templates to use `{{app.name}}` instead of a product name.
2. For emails that say Mindful Money specifically, the app needs its **own Clerk instance** (own users, own
   publishable key and `CLERK_PUBLISHABLE_KEY`). That ends single sign-on with Riches Analytics, so decide that first.

## Environment variables

`backend/.env.example` lists all of them with comments. For production (`APP_ENV=production`):

- **Required:** `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `ALLOWED_ORIGINS` (the web app origin),
  `CLERK_AUTHORIZED_PARTIES`.
- **Bank linking:** `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production`, `FERNET_KEY`, and
  `PLAID_WEBHOOK_URL=https://<api>/api/plaid/webhook` (without it Plaid sends no sync or login-expiry events).
  Institutions that sign in on their own site (OAuth, which includes several large brokerages) also need
  `PLAID_REDIRECT_URI` = the web app's `/portfolio` URL, registered in Plaid's dashboard. Without Plaid, link
  routes answer 503 and the app hides the connect card. Linking runs on the web app; the iOS/Android apps point
  to it until Plaid's native SDK is added in a development build.
- **Rate limiting:** `TRUSTED_PROXY_HOPS` (default 1, right for Render alone; 2 behind Cloudflare + Render). Set
  `TRUST_CLOUDFLARE=1` only if the API is reachable through Cloudflare alone.
- **Off unless needed:** `ENABLE_TRANSFERS=1` turns on the Plaid money-movement routes for admins. They are not
  part of the product and need legal review first.
- **Market data:** `TIINGO_API_KEY`, which needs a commercial plan for redistribution to end users and the
  fundamentals add-on for statements. Also `SP500_AGGREGATES_FILE`, a licensed benchmark dataset.
- **Pro:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `BILLING_RETURN_URLS`,
  `PRO_PRICE_DISPLAY` (optional), `REVENUECAT_WEBHOOK_AUTH` (store purchases), `GRACE_DAYS`.
- **Never set in production:** `REQUIRE_SIGN_IN=0` (the API refuses to start) and `MARKET_DATA_MODE=demo`
  (allowed, but it serves fictional data).

Secrets belong in the host's secret store (e.g. Render → Environment), never in the repo or the app bundle.
Only `EXPO_PUBLIC_*` values reach the client, and the only one is the API URL.

**Database (Supabase):** user data (tracked subscriptions, linked accounts) must live in Postgres. Without
`DATABASE_URL` the API falls back to SQLite on the instance's disk, which Render wipes on every deploy and
restart.

1. Create a Supabase project in a US East region (closest to the API in Render's Ohio region).
2. Project → **Connect** → **Session pooler** → copy the URI and put the database password in it. Don't use
   the "Direct connection" string: it's IPv6-only, and Render can't reach it. The transaction pooler (port
   6543) also works; `database.py` turns off prepared statements for it.
3. Set it as `DATABASE_URL` on `mmm-api`. On start the API creates its tables and turns on row-level
   security for each one, so Supabase's public REST API (reachable with the project's anon key) returns no
   rows. The API connects as the table owner, which RLS doesn't restrict. Don't add RLS policies for `anon`
   or `authenticated`: the app never reads the database directly.

## Database migrations

`Base.metadata.create_all()` creates missing tables at startup (including `tracked_subscriptions`) but never
alters existing ones. For a
database created before this release:

```bash
psql "$DATABASE_URL" -f backend/migrations/001_portfolio_and_billing.sql        # idempotent
psql "$DATABASE_URL" -f backend/migrations/002_plaid_sync_status.sql            # linked-account sync status
# rollback (newest first):
psql "$DATABASE_URL" -f backend/migrations/002_plaid_sync_status.down.sql
psql "$DATABASE_URL" -f backend/migrations/001_portfolio_and_billing.down.sql
```

Before migrating, take a backup (Supabase → Database → Backups). Supabase's daily backups, and point-in-time
recovery on paid plans, cover accidental data loss afterwards. Before the next schema change, adopt Alembic: the SQL file shows
the shape to start from.

## Billing setup

**Web (Stripe)**
1. Create a Product and a recurring Price, then set `STRIPE_PRICE_ID`. Pricing lives in Stripe, not in code.
2. Add a webhook endpoint at `https://<api>/api/billing/webhook/stripe` for `checkout.session.completed`
   and `customer.subscription.created`, `.updated` and `.deleted`. Set `STRIPE_WEBHOOK_SECRET`.
3. Enable the Customer Portal (cancel, update payment method).
4. Add the app's return scheme to `BILLING_RETURN_URLS` (`mmmapp://`).

**iOS and Android (RevenueCat)**

App Store and Play rules generally require in-app purchase for digital subscriptions bought inside the app.
1. Create the products in App Store Connect and Play Console, then an entitlement "pro" in RevenueCat.
2. In the app, add `react-native-purchases` (this requires a development build) and call
   `Purchases.logIn(<Clerk user id>)` so webhook `app_user_id` values match API users.
3. Point the RevenueCat webhook at `https://<api>/api/billing/webhook/revenuecat` with an Authorization
   value, and set the same value in `REVENUECAT_WEBHOOK_AUTH`.

Both paths write the same `subscriptions` row. Duplicate events are recorded once (`billing_events`), and
older events can't overwrite newer state. "Restore purchase" calls `POST /api/billing/sync`, which re-reads
Stripe directly, for a webhook that never arrived.

## Data provider report

| Need | Source now | Status and licensing |
|---|---|---|
| Daily prices, splits, distributions | Tiingo EOD (`providers/tiingo.py`) | Works with `TIINGO_API_KEY`. Redistribution in a commercial app needs Tiingo's commercial license. Data is end-of-day and labeled "delayed". |
| Annual fundamentals | Tiingo Fundamentals add-on | The adapter is written. Its **data codes are unverified against a live subscription**; check them against `/tiingo/fundamentals/definitions`. Unknown codes yield "Not available", never zero. |
| Analyst consensus estimates | **None** | No licensed source is configured, so projected-growth rows say so. Add an `Estimates` provider (e.g. FactSet, S&P, Zacks) when one is licensed. |
| S&P 500 aggregates (FCF and DPS per index share, ROIC) | `SP500_AGGREGATES_FILE` | **Needs a licensed dataset** (S&P DJI index data, or aggregates built from a licensed fundamentals universe point-in-time). Without it, live mode marks the benchmark unavailable. |
| S&P 500 total return | SPY adjusted close via Tiingo | A total-return proxy, net of the 0.0945% expense ratio. Licensing the S&P 500 TR index directly would remove the tracking difference. |
| Brokerage holdings and transactions | Plaid Investments | 24 months of history. Sales of shares bought earlier, and dividends on them, are left out and reported in the app's notes (no phantom short positions). A true opening balance from `/investments/holdings/get` is **not yet implemented**. |
| Demo | `providers/demo.py` | Fictional companies, an illustrative benchmark and a sample portfolio, always labeled "Demo data · not market data" |

Freshness: provider responses are cached (prices 6h, fundamentals 24h, search 24h). A failed refresh serves
the last good copy, marked **stale** in the app. Every response carries `provenance` (source, retrieval
time, demo or stale flags, license note).

## Launch checklist

1. Supabase backup → run migration 001 (only for a database created before that release).
2. Set production environment variables. Confirm `GET /` and `GET /api/health/db` respond.
3. Configure Clerk (production instance) and add sign-in to the app (see LAUNCH_REPORT.md, outstanding work).
4. Configure Stripe and/or RevenueCat. Send a test webhook and confirm the `billing_events` row and the
   `/api/me` plan.
5. Load a licensed `SP500_AGGREGATES_FILE`. Verify the Tiingo fundamentals mapping on 5–10 known tickers
   against filings.
6. Legal review of `app/disclosures.tsx`, plus terms and a privacy policy (DFS-Riches `docs/legal/` is a
   template to start from).
7. Monitoring: platform health check on `/`, error reporting (Sentry or similar; not yet wired), and alerts
   on 5xx rate and webhook failures.
8. Scale-out: the rate limiter is per process. With more than one instance, move counters to Redis.
