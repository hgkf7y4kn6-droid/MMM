from sqlalchemy import Column, String, Text, DateTime, Float, Boolean, Date, Integer
from sqlalchemy.sql import func
from database import Base


class PlaidItem(Base):
    """Replaces the original `db_session = {}` in-memory dict. That dict lost
    every linked account's access_token on process restart — and an
    access_token is a bearer credential to someone's real bank data, so it
    shouldn't sit unencrypted in memory either. access_token_encrypted is
    written/read through crypto.py (Fernet), never in plaintext.
    """
    __tablename__ = "plaid_items"

    user_id = Column(String, primary_key=True)
    item_id = Column(String, unique=True, nullable=False, index=True)
    access_token_encrypted = Column(Text, nullable=False)
    cursor = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Account(Base):
    """One row per Plaid account — checking, savings, credit card, or loan.
    credit_limit is populated only for type == "credit" (Plaid leaves it
    null for every other account type, so its presence alone tells you
    whether a row is a credit card)."""
    __tablename__ = "accounts"

    account_id = Column(String, primary_key=True)  # Plaid's account_id
    user_id = Column(String, index=True, nullable=False)
    item_id = Column(String, index=True, nullable=False)
    name = Column(String)
    official_name = Column(String, nullable=True)
    mask = Column(String, nullable=True)          # last 4 digits
    type = Column(String)                          # depository | credit | loan | investment
    subtype = Column(String, nullable=True)        # checking | savings | credit card | ...
    current_balance = Column(Float, nullable=True)
    available_balance = Column(Float, nullable=True)
    credit_limit = Column(Float, nullable=True)
    iso_currency_code = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())


class Transaction(Base):
    """Bank/credit-card transactions from /transactions/sync. Plaid's amount
    convention: positive = money leaving the account, negative = money in
    (refunds, direct deposits, transfers received)."""
    __tablename__ = "transactions"

    transaction_id = Column(String, primary_key=True)
    account_id = Column(String, index=True, nullable=False)
    user_id = Column(String, index=True, nullable=False)
    date = Column(Date, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    merchant_name = Column(String, nullable=True)
    category_primary = Column(String, nullable=True)
    category_detailed = Column(String, nullable=True)
    city = Column(String, nullable=True)
    region = Column(String, nullable=True)
    pending = Column(Boolean, default=False)


class InvestmentTransaction(Base):
    """From /investments/transactions/get. is_dividend is precomputed at
    sync time from `subtype` (see plaid_service.DIVIDEND_SUBTYPES) so
    queries for confirmed dividend income don't need to re-derive it."""
    __tablename__ = "investment_transactions"

    investment_transaction_id = Column(String, primary_key=True)
    account_id = Column(String, index=True, nullable=False)
    user_id = Column(String, index=True, nullable=False)
    security_id = Column(String, nullable=True)
    ticker = Column(String, nullable=True, index=True)
    date = Column(Date, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    type = Column(String, nullable=True)           # buy | sell | cash | fee | transfer
    subtype = Column(String, nullable=True)         # dividend | dividend reinvestment | ...
    is_dividend = Column(Boolean, default=False, index=True)
    # Needed to rebuild positions for portfolio analytics (migrations/001).
    quantity = Column(Float, nullable=True)
    price = Column(Float, nullable=True)
    fees = Column(Float, nullable=True)


class TransferEvent(Base):
    """Audit trail for the Plaid Transfer product — every authorization
    decision and every transfer actually created, regardless of outcome.
    Keeping declined/failed rows (not just successes) matters here: this is
    real money movement, and "why was this declined" needs to be
    answerable without calling Plaid again."""
    __tablename__ = "transfer_events"

    id = Column(String, primary_key=True)  # authorization_id or transfer_id
    kind = Column(String, nullable=False)  # "authorization" | "transfer"
    user_id = Column(String, index=True, nullable=False)
    account_id = Column(String, index=True, nullable=False)
    type = Column(String, nullable=True)          # debit | credit
    network = Column(String, nullable=True)       # ach | same-day-ach | rtp
    amount = Column(String, nullable=True)         # kept as string, matching Plaid's own representation — avoids float cent errors
    status = Column(String, nullable=True)         # e.g. authorized/declined, or pending/posted/failed
    decision_rationale = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())



class Subscription(Base):
    """A user's Pro subscription as last reported by the billing provider's
    verified webhooks. Entitlement (entitlements.py) is derived from this row
    on every request; the client is never trusted to say it's Pro."""
    __tablename__ = "subscriptions"

    user_id = Column(String, primary_key=True)
    provider = Column(String, nullable=False)                  # stripe | revenuecat | manual
    customer_id = Column(String, nullable=True, index=True)
    subscription_id = Column(String, nullable=True, index=True)
    plan = Column(String, nullable=False, default="pro")
    # active | trialing | past_due | canceled | expired | paused | incomplete
    status = Column(String, nullable=False)
    cancel_at_period_end = Column(Boolean, default=False)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    grace_until = Column(DateTime(timezone=True), nullable=True)
    # Provider timestamp of the event that produced this state: an older event
    # arriving late (webhooks aren't ordered) can't overwrite a newer state.
    last_event_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TrackedSubscription(Base):
    """A recurring bill the user tracks in the app (streaming, software, gym...).
    Not to be confused with `Subscription`, the user's own Mindful Money Pro
    plan. Entered by the user; `renewal_date` is the next charge they gave,
    and the API rolls it forward by whole billing cycles once it passes."""
    __tablename__ = "tracked_subscriptions"

    id = Column(String, primary_key=True)
    user_id = Column(String, index=True, nullable=False)
    name = Column(String, nullable=False)
    price = Column(Float, nullable=False)
    currency = Column(String, nullable=False, default="USD")
    billing = Column(String, nullable=False, default="monthly")   # weekly | monthly | quarterly | yearly
    category = Column(String, nullable=True)
    plan = Column(String, nullable=True)
    payment_method = Column(String, nullable=True)
    status = Column(String, nullable=False, default="active")     # active | paused | cancelled
    start_date = Column(Date, nullable=True)
    renewal_date = Column(Date, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class BillingEvent(Base):
    """Every billing webhook received, keyed by the provider's event id, so a
    redelivered event is recognized and applied at most once."""
    __tablename__ = "billing_events"

    event_id = Column(String, primary_key=True)
    provider = Column(String, nullable=False)
    type = Column(String, nullable=False)
    user_id = Column(String, nullable=True, index=True)
    outcome = Column(String, nullable=False)                   # applied | ignored | stale
    received_at = Column(DateTime(timezone=True), server_default=func.now())
    attempts = Column(Integer, default=1)
