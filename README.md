# Mindful Money

Track every subscription, research dividend growth stocks, and measure your portfolio against the S&P 500.
Live at **https://mmm.richesdigitalventures.com**.

| Part | What it is |
|---|---|
| `app/`, `components/`, `lib/` | The app: Expo (SDK 54) + Expo Router, NativeWind. One codebase for iOS, Android and the web. |
| `backend/` | The API: FastAPI + SQLAlchemy (Postgres in production), Celery for slow jobs. |
| `docs/` | Architecture, methodology, deployment and the launch report. |
| `reference/` | The original single-file prototype, kept for porting features. |

## Features

- **Subscriptions** — add what you pay for on repeat; see the monthly and yearly total, what renews next, and
  spend by category. Renewal dates roll forward automatically. Stored per account, so they follow you to every
  device.
- **Dividend growth research** — revenue, EPS, free cash flow and dividend growth, ROIC and capital allocation,
  each figure with its source and formula (Pro for the deeper analyses).
- **Portfolio** — income growth and time-weighted return against the S&P 500, from a brokerage account linked on the web app (up to 24 months of history; earlier positions are noted as not included) or a sample portfolio.
- **Accounts** — sign-in is shared with Riches Analytics (one Riches Digital Ventures account). Export or delete
  your data any time from Settings.

## Run it locally

```bash
# API (dev mode: no sign-in, demo market data, SQLite)
cd backend
pip install -r requirements-dev.txt
REQUIRE_SIGN_IN=0 MARKET_DATA_MODE=demo uvicorn main:app --reload

# App (another terminal, repo root)
npm install
EXPO_PUBLIC_API_URL=http://localhost:8000 \
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_... \
npx expo start
```

The production Clerk key only works on `*.richesdigitalventures.com`, so local development needs a `pk_test_` key
from a Clerk development instance.

## Checks

```bash
cd backend && pytest tests      # API tests
npx tsc --noEmit                # types
npx expo lint                   # lint
npm test                        # app unit tests
npx expo export --platform web  # web build
```

CI runs all of these on every push (`.github/workflows/ci.yml`). Deployment is described in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
