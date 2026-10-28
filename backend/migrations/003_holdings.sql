-- Current holdings per account (opening balances for the portfolio ledger). Idempotent.
-- Rollback: migrations/003_holdings.down.sql
create table if not exists holdings (
    user_id     varchar not null,
    account_id  varchar not null,
    security_id varchar not null,
    ticker      varchar,
    quantity    double precision not null,
    as_of       timestamptz default now(),
    primary key (user_id, account_id, security_id)
);
create index if not exists ix_holdings_ticker on holdings (ticker);
alter table holdings enable row level security;
