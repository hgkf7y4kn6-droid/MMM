-- Portfolio analytics + Pro subscriptions.
-- Base.metadata.create_all() creates new tables but never alters existing ones,
-- so databases created before this change need this run once (idempotent).
-- Rollback: migrations/001_portfolio_and_billing.down.sql

alter table investment_transactions add column if not exists quantity double precision;
alter table investment_transactions add column if not exists price double precision;
alter table investment_transactions add column if not exists fees double precision;

create table if not exists subscriptions (
    user_id              varchar primary key,
    provider             varchar not null,
    customer_id          varchar,
    subscription_id      varchar,
    plan                 varchar not null default 'pro',
    status               varchar not null,
    cancel_at_period_end boolean default false,
    current_period_end   timestamptz,
    grace_until          timestamptz,
    last_event_at        timestamptz,
    updated_at           timestamptz default now()
);
create index if not exists ix_subscriptions_customer_id on subscriptions (customer_id);
create index if not exists ix_subscriptions_subscription_id on subscriptions (subscription_id);

create table if not exists billing_events (
    event_id    varchar primary key,
    provider    varchar not null,
    type        varchar not null,
    user_id     varchar,
    outcome     varchar not null,
    received_at timestamptz default now(),
    attempts    integer default 1
);
create index if not exists ix_billing_events_user_id on billing_events (user_id);
