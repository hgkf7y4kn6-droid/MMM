alter table plaid_items drop column if exists last_error;
alter table plaid_items drop column if exists last_attempt_at;
alter table plaid_items drop column if exists last_synced_at;
alter table plaid_items drop column if exists status;
