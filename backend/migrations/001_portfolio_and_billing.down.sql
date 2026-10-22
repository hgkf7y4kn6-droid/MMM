-- Rolls back 001. Dropping subscriptions removes Pro state; export it first
-- (select * from subscriptions) if it may be needed again.
drop table if exists billing_events;
drop table if exists subscriptions;
alter table investment_transactions drop column if exists fees;
alter table investment_transactions drop column if exists price;
alter table investment_transactions drop column if exists quantity;
