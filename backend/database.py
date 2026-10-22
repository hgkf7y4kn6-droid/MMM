"""SQLAlchemy engine and session for the API.

DATABASE_URL   Neon Postgres in production ("postgresql://..."; the psycopg 3
               driver is selected automatically). Outside production an unset
               URL falls back to a local SQLite file so the API runs for
               development; production refuses to start without it.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

APP_ENV = os.environ.get("APP_ENV", "development")


def _url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        if APP_ENV == "production":
            raise RuntimeError("DATABASE_URL is required in production.")
        return "sqlite:///./mmm-dev.db"
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _url()
_kwargs: dict = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    _kwargs = {"connect_args": {"check_same_thread": False}}
    if DATABASE_URL in ("sqlite://", "sqlite:///:memory:"):
        _kwargs["poolclass"] = StaticPool        # one shared in-memory database (tests)

engine = create_engine(DATABASE_URL, **_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
