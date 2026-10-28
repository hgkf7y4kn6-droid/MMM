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
treated as unavailable rather than guessed: a sale of shares the ledger never
saw bought (and dividends on them) is left out and reported in the notes, so the
rebuilt portfolio never holds a negative (phantom short) position.
"""
from __future__ import annotations

from datetime import date, timedelta

from analytics.models import LedgerTxn

CASH_IN = {"deposit", "contribution"}
CASH_OUT = {"withdrawal", "distribution"}
DIVIDEND = {"dividend", "qualified dividend", "non-qualified dividend", "interest"}


OPENING_TOLERANCE = 1e-6        # shares


def to_ledger(rows, holdings: dict[str, float] | None = None) -> tuple[list[LedgerTxn], list[str]]:
    """rows: InvestmentTransaction ORM rows (or anything with the same attributes).
    holdings: shares held now per ticker (summed over accounts) from /investments/holdings/get,
    or None when they haven't been synced yet.

    With holdings, shares owned before the history begins are recovered: the opening
    balance is today's holding minus the net change the transactions explain, entered as
    a transfer in (valued at that day's close) the day before the first transaction.
    Without them -- or where they can't explain the history -- the earlier shares are
    treated as unknown and reported, never guessed."""
    rows = sorted(rows, key=lambda r: r.date)
    opening: dict[str, float] = {}
    notes: list[str] = []
    if holdings is not None:
        raw = _build(rows, {})[5]
        for sym in sorted(set(holdings) | set(raw)):
            gap = holdings.get(sym, 0.0) - raw.get(sym, 0.0)
            if gap > OPENING_TOLERANCE:
                opening[sym] = gap
            elif gap < -max(OPENING_TOLERANCE, 1e-4 * abs(raw.get(sym, 0.0))):
                notes.append(f"{sym}: the transactions imply {raw[sym]:g} shares but the account holds "
                             f"{holdings.get(sym, 0.0):g}, so its history may be incomplete.")
    out, build_notes, skipped, untracked, _held, _raw = _build(rows, opening)
    if opening:
        day = (rows[0].date if rows else date.today()) - timedelta(days=1)
        out = [LedgerTxn(day, "transfer_in", sym, qty, None, id=f"opening-{sym}") for sym, qty in opening.items()] + out
        notes.append("Shares you already held when the available history begins (" + ", ".join(sorted(opening)) +
                     ") are included as an opening balance valued at that day's close; their earlier purchase "
                     "dates and prices aren't known.")
    notes += build_notes
    if untracked:
        notes.append("Shares bought before the available history (about 24 months) can't be valued yet. Sales of "
                     f"those shares and dividends paid on them were left out for {', '.join(sorted(untracked))}, so "
                     "results cover only what was bought within the history.")
    if skipped:
        notes.append(f"{skipped} brokerage transaction(s) of an unsupported kind (cancellations, options, "
                     "unmatched splits) weren't included.")
    if any(r.quantity is None for r in rows if (r.type or "").lower() in ("buy", "sell")):
        notes.append("Some trades have no share quantity yet; re-sync the account to fill them in.")
    return out, notes


def _build(rows, opening: dict[str, float]):
    """One pass over date-sorted rows from `opening` shares per symbol. Returns (ledger entries,
    notes, skipped count, untracked symbols, shares held at the end, `raw`): raw is the same
    share arithmetic with no clamping, used to size the opening balance."""
    cash_divs = [(r.ticker, r.date, abs(r.amount)) for r in rows
                 if (r.subtype or "").lower() in DIVIDEND and (r.type or "").lower() == "cash"]
    held: dict[str, float] = dict(opening)
    raw: dict[str, float] = dict(opening)
    untracked: set[str] = set()      # symbols with activity on shares bought before the history begins
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
            raw[sym] = raw.get(sym, 0) + r.quantity
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
            raw[sym] = raw.get(sym, 0) + qty
        elif t == "sell" and sym and qty:
            raw[sym] = raw.get(sym, 0) - qty
            have = max(held.get(sym, 0), 0.0)
            if qty > have + 1e-9:
                untracked.add(sym)               # sold shares that were bought before the history
                fee, qty = fee * (have / qty), have
            if qty > 1e-9:
                out.append(LedgerTxn(r.date, "sell", sym, qty, price, fee=fee, id=rid))
                held[sym] = have - qty
            else:
                skipped += 1
        elif sub in DIVIDEND:
            if sym and sub != "interest" and held.get(sym, 0) <= 1e-9:
                untracked.add(sym)               # paid on shares the ledger doesn't know
                skipped += 1
                continue
            out.append(LedgerTxn(r.date, "dividend", sym if sub != "interest" else None, amount=abs(r.amount), id=rid))
        elif t == "fee":
            out.append(LedgerTxn(r.date, "fee", amount=abs(r.amount), id=rid))
        elif t == "transfer" and sym and r.quantity:
            kind = "transfer_in" if r.quantity > 0 else "transfer_out"
            raw[sym] = raw.get(sym, 0) + r.quantity
            if r.quantity < 0 and qty > max(held.get(sym, 0), 0.0) + 1e-9:
                untracked.add(sym)
                skipped += 1
                continue
            out.append(LedgerTxn(r.date, kind, sym, qty, price, id=rid))
            held[sym] = held.get(sym, 0) + r.quantity
        elif sub in CASH_IN or (t in ("cash", "transfer") and not sym and r.amount < 0):
            out.append(LedgerTxn(r.date, "deposit", amount=abs(r.amount), id=rid))
        elif sub in CASH_OUT or (t in ("cash", "transfer") and not sym and r.amount > 0):
            out.append(LedgerTxn(r.date, "withdrawal", amount=abs(r.amount), id=rid))
        else:
            skipped += 1
    return out, [], skipped, untracked, held, raw


def _has_cash_dividend(cash_divs, sym, day, amount) -> bool:
    return any(t == sym and abs((d - day).days) <= 5 and abs(a - amount) <= max(0.01, amount * 0.01)
               for t, d, a in cash_divs if d <= day + timedelta(days=5))
