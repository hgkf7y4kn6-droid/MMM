-- Free-plan manual entry: hand-entered holdings and dividends, and receipt / statement imports
-- that detect subscriptions. Idempotent. Rollback: migrations/004_manual_entry.down.sql
create table if not exists manual_holdings (
    id            varchar primary key,
    user_id       varchar not null,
    symbol        varchar not null,
    shares        double precision not null,
    cost_basis    double precision,
    acquired_on   date,
    account_label varchar,
    notes         text,
    created_at    timestamptz default now(),
    updated_at    timestamptz default now()
);
create index if not exists ix_manual_holdings_user_id on manual_holdings (user_id);
alter table manual_holdings enable row level security;

create table if not exists manual_dividends (
    id          varchar primary key,
    user_id     varchar not null,
    symbol      varchar not null,
    paid_on     date not null,
    amount      double precision not null,
    reinvested  boolean not null default false,
    notes       text,
    created_at  timestamptz default now()
);
create index if not exists ix_manual_dividends_user_id on manual_dividends (user_id);
alter table manual_dividends enable row level security;

create table if not exists import_jobs (
    id                 varchar primary key,
    user_id            varchar not null,
    source             varchar not null,
    filename           varchar,
    media_type         varchar,
    file_data          bytea,
    status             varchar not null default 'queued',
    error              varchar,
    transactions_found integer,
    candidates         text,
    notes              text,
    created_at         timestamptz default now(),
    finished_at        timestamptz
);
create index if not exists ix_import_jobs_user_id on import_jobs (user_id);
alter table import_jobs enable row level security;
