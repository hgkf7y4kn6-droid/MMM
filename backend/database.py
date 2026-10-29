"""SQLAlchemy engine and session for the API.

DATABASE_URL   Supabase Postgres in production ("postgresql://..."; the psycopg 3
               driver is selected automatically). Use Supabase's *pooler*
               connection string: the direct db.<ref>.supabase.co address is
               IPv6-only, which Render can't reach. Outside production an unset
               URL falls back to a local SQLite file so the API runs for
               development; production refuses to start without it.
"""
import logging
import os
from urllib.parse import urlsplit

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

APP_ENV = os.environ.get("APP_ENV", "development")
log = logging.getLogger("database")


def _url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        if APP_ENV == "production":
            raise RuntimeError("DATABASE_URL is required in production.")
        return "sqlite:///./kaventafi-dev.db"
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def engine_options(url: str) -> dict:
    """Connection options for the database at `url`."""
    if url.startswith("sqlite"):
        opts: dict = {"connect_args": {"check_same_thread": False}}
        if url in ("sqlite://", "sqlite:///:memory:"):
            opts["poolclass"] = StaticPool        # one shared in-memory database (tests)
        return opts
    opts = {"pool_pre_ping": True, "pool_recycle": 300, "connect_args": {}}
    parts = urlsplit(url)
    if parts.hostname and parts.hostname.endswith(".supabase.com"):
        # Supabase only accepts encrypted connections.
        if "sslmode=" not in (parts.query or ""):
            opts["connect_args"]["sslmode"] = "require"
        # Its transaction pooler (port 6543) hands each transaction to any
        # server connection, so psycopg's automatic prepared statements would
        # collide. The session pooler (5432) doesn't need this, but it's harmless.
        if parts.port == 6543:
            opts["connect_args"]["prepare_threshold"] = None
    return opts


DATABASE_URL = _url()
engine = create_engine(DATABASE_URL, **engine_options(DATABASE_URL))
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def lock_down_tables() -> None:
    """Turn on row-level security for every app table (Postgres only).

    Supabase publishes everything in the `public` schema through its REST
    API, reachable with the project's public anon key. With RLS on and no
    policies, that API sees no rows at all. This API connects as the table
    owner, which RLS doesn't apply to, so the app itself is unaffected.
    Idempotent: runs on every start, so new tables are covered too.
    """
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            conn.execute(text(f'alter table "{table.name}" enable row level security'))
    log.info("row-level security on for %d tables", len(Base.metadata.sorted_tables))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
