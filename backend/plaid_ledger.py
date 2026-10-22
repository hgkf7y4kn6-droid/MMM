"""Plaid investment transactions -> the normalized portfolio ledger.

Plaid's conventions: `amount` positive = cash leaving the account (a buy),
negative = cash arriving (a sale, a dividend); `quantity` positive = shares
in, negative = shares out. The dividend signal is in `subtype`.

DRIP: Plaid usually reports a reinvested dividend twice -- a cash
"dividend" and a "dividend reinvestment" buy. The buy is then an ordinary
buy (the dividend was already counted). Only a reinvestment buy with no
matching cash dividend (same ticker, within 5 days, amount within 1%) becomes
a combined "reinvest" event, so the dividend is counted exactly once.

Splits arrive as a share-quantity change; they're converted to a ratio from
the position size at the time, so dividend-per-share history stays
split-adjusted.

Limitation: Plaid returns up to 24 months of investment transactions. A
position opened before that window needs an opening balance (from
/investments/holdings/get) to be valued; without one, its earlier history is
treated as unavailable rather than guessed.
"""
from __future__ import annotations

from datetime import timedelta

from analytics.models import LedgerTxn

CASH_IN = {"deposit", "contribution"}
CASH_OUT = {"withdrawal", "distribution"}
DIVIDEND = {"dividend", "qualified dividend", "non-qualified dividend", "interest"}


def to_ledger(rows) -> tuple[list[LedgerTxn], list[str]]:
    """rows: InvestmentTransaction ORM rows (or anything with the same attributes)."""
    rows = sorted(rows, key=lambda r: r.date)
    notes: list[str] = []
    cash_divs = [(r.ticker, r.date, abs(r.amount)) for r in rows
                 if (r.subtype or "").lower() in DIVIDEND and (r.type or "").lower() == "cash"]
    held: dict[str, float] = {}
    out: list[LedgerTxn] = []
    skipped = 0
    for r in rows:
        t, sub = (r.type or "").lower(), (r.subtype or "").lower()
        sym = (r.ticker or "").upper() or None
        qty = abs(r.quantity) if r.quantity is not None else None
        price = r.price
        fee = abs(r.fees or 0)
        rid = r.investment_transaction_id
        if t == "cancel":
            skipped += 1
            continue
        if sub == "split" and sym and r.quantity:
            before = held.get(sym, 0)
            if before > 0:
                out.append(LedgerTxn(r.date, "split", sym, ratio=(before + r.quantity) / before, id=rid))
                held[sym] = before + r.quantity
            else:
                skipped += 1
            continue
        if t == "buy" and sym and qty:
            if sub == "dividend reinvestment" and not _has_cash_dividend(cash_divs, sym, r.date, abs(r.amount)):
                out.append(LedgerTxn(r.date, "reinvest", sym, qty, price, id=rid))
            else:
                out.append(LedgerTxn(r.date, "buy", sym, qty, price, fee=fee, id=rid))
            held[sym] = held.get(sym, 0) + qty
        elif t == "sell" and sym and qty:
            out.append(LedgerTxn(r.date, "sell", sym, qty, price, fee=fee, id=rid))
            held[sym] = held.get(sym, 0) - qty
        elif sub in DIVIDEND:
            out.append(LedgerTxn(r.date, "dividend", sym if sub != "interest" else None, amount=abs(r.amount), id=rid))
        elif t == "fee":
            out.append(LedgerTxn(r.date, "fee", amount=abs(r.amount), id=rid))
        elif t == "transfer" and sym and r.quantity:
            kind = "transfer_in" if r.quantity > 0 else "transfer_out"
            out.append(LedgerTxn(r.date, kind, sym, qty, price, id=rid))
            held[sym] = held.get(sym, 0) + r.quantity
        elif sub in CASH_IN or (t in ("cash", "transfer") and not sym and r.amount < 0):
            out.append(LedgerTxn(r.date, "deposit", amount=abs(r.amount), id=rid))
        elif sub in CASH_OUT or (t in ("cash", "transfer") and not sym and r.amount > 0):
            out.append(LedgerTxn(r.date, "withdrawal", amount=abs(r.amount), id=rid))
        else:
            skipped += 1
    if skipped:
        notes.append(f"{skipped} brokerage transaction(s) of an unsupported kind (cancellations, options, "
                     "unmatched splits) weren't included.")
    if any(r.quantity is None for r in rows if (r.type or "").lower() in ("buy", "sell")):
        notes.append("Some trades have no share quantity yet; re-sync the account to fill them in.")
    return out, notes


def _has_cash_dividend(cash_divs, sym, day, amount) -> bool:
    return any(t == sym and abs((d - day).days) <= 5 and abs(a - amount) <= max(0.01, amount * 0.01)
               for t, d, a in cash_divs if d <= day + timedelta(days=5))
