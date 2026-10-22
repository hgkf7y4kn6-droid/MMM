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
