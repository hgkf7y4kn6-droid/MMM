# Mindful Money Management

A dividend growth research and portfolio app. It helps investors see how companies turn capital into growth,
free cash flow and rising dividends, and whether their own portfolio's income and total return are keeping
pace with the S&P 500. It's analytical decision support, not investment advice.

- **App:** Expo SDK 54 (expo-router, NativeWind v5) in the repo root
- **API:** FastAPI in `backend/`: calculation engine, data providers, auth, Pro entitlements, Plaid sync
- **Prototype:** `reference/MindfulMoneyManagement.jsx` (the original single-file web prototype)

## Run it locally

```bash
# API, using demo data with sign-in off (development only)
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
REQUIRE_SIGN_IN=0 MARKET_DATA_MODE=demo COMPLIMENTARY_PRO_USER_IDS=dev-user uvicorn main:app --reload --port 8000
pytest tests

# App (another terminal, repo root)
npm install
EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start
```

Demo mode serves four **fictional** companies (`DEMO-LITE`, `DEMO-GRID`, `DEMO-TURN`, `DEMO-CASH`), an
illustrative benchmark and a sample portfolio. Everything is labeled "Demo data · not market data".

## Docs

- [Architecture](docs/ARCHITECTURE.md): repository comparison, structure, feature inventory, Free vs Pro matrix
- [Methodology](docs/METHODOLOGY.md): every formula, benchmark construction, edge cases
- [Deployment](docs/DEPLOYMENT.md): environment variables, migrations, billing setup, data providers, launch checklist
- [Launch report](docs/LAUNCH_REPORT.md): tests, performance, security, outstanding work

## Checks

```bash
npx tsc --noEmit && npx expo lint          # app
cd backend && pytest tests                 # API (98 tests)
```
