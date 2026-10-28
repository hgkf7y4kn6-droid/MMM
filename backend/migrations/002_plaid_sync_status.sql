-- Sync status on the linked-account row, so the app can say when data stopped
-- updating and ask the user to reconnect. Idempotent.
-- Rollback: migrations/002_plaid_sync_status.down.sql

alter table plaid_items add column if not exists status varchar not null default 'active';
alter table plaid_items add column if not exists last_synced_at timestamptz;
alter table plaid_items add column if not exists last_attempt_at timestamptz;
alter table plaid_items add column if not exists last_error varchar;
