"""Text from a receipt or statement -> charges and recurring-billing hints. Pure, no I/O.

Used by the local document reader (local_ocr.py): OCR gives words with positions,
`group_lines` puts them back into lines, and `extract` reads those lines.

Statements: a line that starts with a date and ends with an amount is a charge
("10/07  SPOTIFY USA  11.99"). Dates without a year take the statement's year
when one is printed, else the most recent such date that isn't in the future.

Receipts: the merchant is the first line that looks like a name, the charge is
the "Total" (else the largest amount), and wording like "renews", "monthly plan"
or "next billing date" makes it a recurring hint with the cycle and date stated.
"""
from __future__ import annotations

import re
import statistics
from datetime import date

from subscription_detect import Charge, Hint

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov",
                                          "dec"])}
_MON = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
DATE_PATTERNS = [
    (re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b"), "mdy"),
    (re.compile(r"\b(\d{1,2})-(\d{1,2})-(\d{2,4})\b"), "mdy"),
    (re.compile(rf"\b{_MON}\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", re.I), "Mdy"),
    (re.compile(rf"\b(\d{{1,2}})\s+{_MON}\s+(\d{{4}})\b", re.I), "dMy"),
    (re.compile(r"\b(\d{1,2})/(\d{1,2})\b"), "md"),
    (re.compile(rf"\b{_MON}\s+(\d{{1,2}})\b", re.I), "Md"),
]
# $1,234.56  1234.56  (12.00)  -12.00  12.00-  12.00 CR
AMOUNT = re.compile(r"(?<![\d/.-])(\(?-?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?)(\s?CR\b)?", re.I)
RECURRING_WORDS = re.compile(r"\b(subscription|subscribed|membership|renew(s|al|ed)?|auto[- ]?renew|recurring|"
                             r"next (billing|bill|payment|charge)|billed (monthly|annually|yearly|weekly)|"
                             r"(monthly|annual|yearly|weekly|quarterly) (plan|fee|membership|subscription))\b", re.I)
NEXT_DATE_WORDS = re.compile(r"\b(renew\w*|next (billing|bill|payment|charge)|will be charged|until)\b", re.I)
CYCLE_WORDS = [
    ("weekly", re.compile(r"\b(weekly|per week|/\s?wk|every week)\b", re.I)),
    ("quarterly", re.compile(r"\b(quarterly|every 3 months|per quarter)\b", re.I)),
    ("yearly", re.compile(r"\b(annual(ly)?|yearly|per year|/\s?yr|every year|12[- ]month)\b", re.I)),
    ("monthly", re.compile(r"\b(monthly|per month|/\s?mo|every month|month)\b", re.I)),
]
NOT_MERCHANT = re.compile(r"^(receipt|invoice|order|thank|date|total|subtotal|tax|bill to|ship|page|statement|"
                          r"account|customer|tel|phone|www\.|http)", re.I)
SKIP_STATEMENT = re.compile(r"\b(payment.*thank|balance|interest charge|total|subtotal|previous|minimum|credit limit|"
                            r"available)\b", re.I)


# ------------------------------------------------------------------ OCR words -> lines
def group_lines(words: list[tuple[list, str]]) -> list[str]:
    """OCR results (box = four [x, y] corners, text) -> lines of text, top to bottom.

    Words are read left to right and each joins the line whose latest word sits at about
    the same height (within ~0.6 word heights). Following the latest word rather than the
    line's start keeps a slightly tilted photo's lines apart as they drift across the page."""
    items = []
    for box, text in words:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        if text.strip():
            items.append({"yc": (min(ys) + max(ys)) / 2, "h": max(ys) - min(ys), "x0": min(xs), "x1": max(xs),
                          "text": text.strip()})
    if not items:
        return []
    tol = 0.6 * statistics.median(i["h"] for i in items)
    lines: list[dict] = []
    for it in sorted(items, key=lambda i: i["x0"]):
        fits = [ln for ln in lines if abs(ln["yc"] - it["yc"]) <= tol and ln["x1"] <= it["x0"] + it["h"]]
        if fits:
            ln = min(fits, key=lambda ln: abs(ln["yc"] - it["yc"]))
            ln["words"].append(it["text"])
            ln["yc"], ln["x1"] = it["yc"], it["x1"]
        else:
            lines.append({"y0": it["yc"], "yc": it["yc"], "x1": it["x1"], "words": [it["text"]]})
    lines.sort(key=lambda ln: ln["y0"])
    return [clean(" ".join(ln["words"])) for ln in lines]


def clean(line: str) -> str:
    """Undo common OCR spacing: '08 /16' -> '08/16', '23. 41' -> '23.41', '7 ,2026' -> '7, 2026',
    's0.00' -> '$0.00'."""
    s = re.sub(r"(\d)\s*/\s*(\d)", r"\1/\2", line)
    s = re.sub(r"(\d)\s*\.\s*(\d{2})\b", r"\1.\2", s)
    s = re.sub(r"\s+,", ",", s)
    s = re.sub(r"([A-Za-z])\s*\.\s+(com|net|org|io|co|tv)\b", r"\1.\2", s, flags=re.I)   # "NETFLIX. COM"
    s = re.sub(r"\b(\d{1,2}),(\d{4})\b", r"\1, \2", s)           # "Oct 7,2026"
    s = re.sub(r"(?<![A-Za-z])[sS](?=\d+[.,]\d{2}\b)", "$", s)
    return re.sub(r"\s+", " ", s).strip()


# ------------------------------------------------------------------ dates and amounts
def _year(y: str) -> int:
    n = int(y)
    return n + 2000 if n < 100 else n


def _mk(y: int | None, m: int, d: int, today: date, year_hint: int | None) -> date | None:
    try:
        if y is not None:
            return date(y, m, d)
        y0 = year_hint or today.year
        out = date(y0, m, d)
        if year_hint is None and out > today:          # "12/28" read in January is last year's
            out = date(y0 - 1, m, d)
        return out
    except ValueError:
        return None


def find_date(text: str, today: date, year_hint: int | None = None, at_start: bool = False) -> tuple[date, int, int] | None:
    """(date, start, end) of the first date in `text` (only at its start if at_start)."""
    best = None
    for pat, kind in DATE_PATTERNS:
        m = pat.search(text)
        if not m or (at_start and m.start() > 2):
            continue
        g = m.groups()
        if kind == "ymd":
            d = _mk(int(g[0]), int(g[1]), int(g[2]), today, None)
        elif kind == "mdy":
            d = _mk(_year(g[2]), int(g[0]), int(g[1]), today, None)
        elif kind == "Mdy":
            d = _mk(int(g[2]), MONTHS[g[0][:3].lower()], int(g[1]), today, None)
        elif kind == "dMy":
            d = _mk(int(g[2]), MONTHS[g[1][:3].lower()], int(g[0]), today, None)
        elif kind == "md":
            d = _mk(None, int(g[0]), int(g[1]), today, year_hint)
        else:
            d = _mk(None, MONTHS[g[0][:3].lower()], int(g[1]), today, year_hint)
        if d and (best is None or m.start() < best[1]):
            best = (d, m.start(), m.end())
    return best


def amounts(text: str) -> list[tuple[float, int, int]]:
    """Money amounts in `text` as (value, start, end); credits ('(12.00)', '-12.00', '12.00 CR') are negative."""
    out = []
    for m in AMOUNT.finditer(text):
        raw = m.group(1)
        neg = raw.startswith("(") or "-" in raw or bool(m.group(2))
        digits = re.sub(r"[^\d.]", "", raw)
        try:
            v = float(digits)
        except ValueError:
            continue
        out.append((-v if neg else v, m.start(), m.end()))
    return out


def _year_hint(lines: list[str]) -> int | None:
    for line in lines[:40]:
        if re.search(r"statement|period|closing|billing cycle", line, re.I):
            m = re.search(r"\b(20\d{2})\b", line)
            if m:
                return int(m.group(1))
    return None


# ------------------------------------------------------------------ extraction
def statement_charges(lines: list[str], today: date, currency: str = "USD") -> list[Charge]:
    hint = _year_hint(lines)
    out = []
    for line in lines:
        if SKIP_STATEMENT.search(line):
            continue
        found = find_date(line, today, hint, at_start=True)
        if not found:
            continue
        day, _, end = found
        rest = line[end:]
        # A second date right after the first is the posting date: skip it.
        second = find_date(rest, today, hint, at_start=True)
        if second:
            rest = rest[second[2]:]
        amts = amounts(rest)
        if not amts:
            continue
        value, a_start, _ = amts[-2] if _looks_like_balance(rest, amts) else amts[-1]
        merchant = re.sub(r"\s+", " ", rest[:a_start]).strip(" -*#:")
        if len(re.sub(r"[^A-Za-z]", "", merchant)) < 2 or day > today:
            continue
        out.append(Charge(day, merchant[:120], round(value, 2), currency))
    return out


def _looks_like_balance(rest: str, amts) -> bool:
    """Checking statements print a running balance after the amount: two amounts at the end of the line."""
    return len(amts) >= 2 and rest[amts[-2][2]:amts[-1][1]].strip() == ""


def receipt(lines: list[str], today: date, currency: str = "USD") -> tuple[list[Charge], list[Hint]]:
    merchant = next((ln for ln in lines[:8] if re.search(r"[A-Za-z]{2}", ln) and not NOT_MERCHANT.match(ln)
                     and not amounts(ln) and not find_date(ln, today)), None)
    if not merchant:
        return [], []
    merchant = re.sub(r"\s+(receipt|invoice)$", "", merchant, flags=re.I)[:120]
    total = None
    for ln in lines:
        if re.search(r"\b(total|amount (paid|charged|due)|charged)\b", ln, re.I) and not re.search(r"sub\s*total", ln, re.I):
            a = amounts(ln)
            if a:
                total = abs(a[-1][0])
    if total is None:
        every = [abs(v) for ln in lines for v, _, _ in amounts(ln)]
        total = max(every) if every else None
    next_charge = None
    day = None
    for ln in lines:
        found = find_date(ln, today)
        if not found:
            continue
        if NEXT_DATE_WORDS.search(ln):
            next_charge = next_charge or _mk(found[0].year, found[0].month, found[0].day, today, None)
        elif day is None and found[0] <= today:
            day = found[0]
    text = " ".join(lines)
    charges = [Charge(day, merchant, round(total, 2), currency)] if day and total else []
    hints = []
    evidence = next((ln for ln in lines if RECURRING_WORDS.search(ln)), None)
    if evidence and total:
        billing = next((name for name, pat in CYCLE_WORDS if pat.search(text)), None)
        plan = next((m.group(2).strip()[:80] for ln in lines
                     if (m := re.search(r"\b(plan|tier|membership type)\s*[:\-]\s*(.+)$", ln, re.I))), None)
        hints.append(Hint(merchant=merchant, amount=round(total, 2), billing=billing, plan=plan, next_charge=next_charge,
                          last_charge=day, currency=currency, evidence=evidence[:200]))
    return charges, hints


def currency_of(lines: list[str]) -> str:
    text = " ".join(lines[:200])
    for code, pat in (("EUR", r"€|\bEUR\b"), ("GBP", r"£|\bGBP\b"), ("CAD", r"\bCAD\b|C\$"), ("AUD", r"\bAUD\b|A\$")):
        if re.search(pat, text):
            return code
    return "USD"


def extract(lines: list[str], source: str, today: date | None = None) -> tuple[list[Charge], list[Hint]]:
    """Charges and hints from a document's lines. Statement lines are always read; a
    receipt (or a 'statement' that turns out to have no dated lines) is read as one."""
    today = today or date.today()
    cur = currency_of(lines)
    charges = statement_charges(lines, today, cur)
    hints: list[Hint] = []
    if source == "receipt" or len(charges) < 2:
        r_charges, hints = receipt(lines, today, cur)
        if not charges:
            charges = r_charges
    return charges, hints
