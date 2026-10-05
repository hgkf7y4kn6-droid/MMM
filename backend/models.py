from sqlalchemy import Column, String, Text, DateTime, Float, Boolean, Date
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

