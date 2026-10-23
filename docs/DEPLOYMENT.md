# Deployment and operations

## Components

| Piece | Runs as | Needs |
|---|---|---|
| API | `uvicorn main:app --host 0.0.0.0 --port $PORT` from `backend/` | Python 3.12+, `pip install -r requirements.txt` |
| Worker | `celery -A tasks worker --loglevel=info` from `backend/` | Redis (`REDIS_URL`) |
| Database | Neon Postgres (`DATABASE_URL`) | Run the migrations below |
| App | Expo / EAS builds; web via `npx expo export --platform web` | `EXPO_PUBLIC_API_URL` |

## Render

| Service | Type | Build command | Start / publish |
|---|---|---|---|
| `mmm-api` | Python web service, `PYTHON_VERSION=3.12.7` | `cd backend && pip install -r requirements.txt` | `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT` |
| `mmm-web` | Static site | `npm ci && npx expo export --platform web` | publish `dist`; add a rewrite rule `/*` → `/index.html` (the web app is a single-page app) |

`EXPO_PUBLIC_API_URL` on `mmm-web` is read at **build** time, so redeploy the site after changing it. Add
the site's URL to `ALLOWED_ORIGINS` on `mmm-api`. The API's own repo-root `package.json` is the Expo app,
so a Node web service pointed at the repo root can't run anything; that's why the API is a Python service.

## Environment variables

`backend/.env.example` lists all of them with comments. For production (`APP_ENV=production`):

- **Required:** `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `ALLOWED_ORIGINS` (the web app origin),
  `CLERK_AUTHORIZED_PARTIES`.
- **Bank linking:** `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production`, `FERNET_KEY`. Without Plaid,
  link routes answer 503 and everything else runs.
- **Market data:** `TIINGO_API_KEY`, which needs a commercial plan for redistribution to end users and the
  fundamentals add-on for statements. Also `SP500_AGGREGATES_FILE`, a licensed benchmark dataset.
- **Pro:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `BILLING_RETURN_URLS`,
  `PRO_PRICE_DISPLAY` (optional), `REVENUECAT_WEBHOOK_AUTH` (store purchases), `GRACE_DAYS`.
- **Never set in production:** `REQUIRE_SIGN_IN=0` (the API refuses to start) and `MARKET_DATA_MODE=demo`
  (allowed, but it serves fictional data).

Secrets belong in the host's secret store (e.g. Render → Environment), never in the repo or the app bundle.
Only `EXPO_PUBLIC_*` values reach the client, and the only one is the API URL.

## Database migrations

`Base.metadata.create_all()` creates missing tables at startup but never alters existing ones. For a
database created before this release:

```bash
psql "$DATABASE_URL" -f backend/migrations/001_portfolio_and_billing.sql        # idempotent
# rollback:
psql "$DATABASE_URL" -f backend/migrations/001_portfolio_and_billing.down.sql
```

Before migrating, take a Neon branch (an instant copy) as the restore point. Neon's point-in-time restore
covers accidental data loss afterwards. Before the next schema change, adopt Alembic: the SQL file shows
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
| Brokerage holdings and transactions | Plaid Investments | 24 months of history. Positions opened earlier need an opening balance from `/investments/holdings/get` (not yet implemented). |
| Demo | `providers/demo.py` | Fictional companies, an illustrative benchmark and a sample portfolio, always labeled "Demo data · not market data" |

Freshness: provider responses are cached (prices 6h, fundamentals 24h, search 24h). A failed refresh serves
the last good copy, marked **stale** in the app. Every response carries `provenance` (source, retrieval
time, demo or stale flags, license note).

## Launch checklist

1. Neon branch for restore → run migration 001.
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
