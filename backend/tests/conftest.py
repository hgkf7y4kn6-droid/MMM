"""Tests run from the repo root (`pytest backend/tests`) or from backend/; the
service imports its modules flat (`import analytics`), as uvicorn does when
started from backend/."""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("MARKET_DATA_MODE", "demo")
os.environ.setdefault("REQUIRE_SIGN_IN", "1")
os.environ.setdefault("CLERK_PUBLISHABLE_KEY", "pk_test_" + "ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk")  # example.clerk.accounts.dev
for _bucket in ("WRITE", "HEAVY", "API"):          # the suite makes many requests from one client
    os.environ.setdefault(f"RATE_LIMIT_{_bucket}", "100000")
