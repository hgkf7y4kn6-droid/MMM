"""Find subscriptions in a list of charges. Pure functions, no I/O.

Inputs are `Charge`s -- from a CSV statement (parse_csv), from a photo or PDF
read by the document reader (document_reader.py), or from linked bank
transactions (Pro). Output is a list of `Candidate`s for the user to review;
nothing is added to their subscriptions until they confirm.

How a charge becomes a candidate
    recurring    the same merchant charged 2+ times at a regular interval
                 (weekly, monthly, quarterly, yearly) for a similar amount
    stated       the document itself says it recurs ("renews monthly",
                 "next billing date ...") -- typical of a receipt
    known        one charge from a merchant that is almost always a
                 subscription (Netflix, Spotify, iCloud...), billed monthly
                 unless the document says otherwise; low confidence

Amounts: positive = money spent. Refunds and credits are ignored.
"""
from __future__ import annotations

import csv
import io
import re
import statistics
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta

from dateutil.relativedelta import relativedelta

BILLING_DAYS = {"weekly": 7, "monthly": 30.44, "quarterly": 91.3, "yearly": 365.25}
# Accepted spread around each cycle's typical gap, in days (billing dates move with weekends and short months).
BILLING_TOLERANCE = {"weekly": 2, "monthly": 5, "quarterly": 10, "yearly": 20}
STEP = {"weekly": relativedelta(weeks=1), "monthly": relativedelta(months=1),
        "quarterly": relativedelta(months=3), "yearly": relativedelta(years=1)}
MAX_CANDIDATES = 50


@dataclass(frozen=True)
class Charge:
    day: date
    merchant: str
    amount: float                 # positive = spent
    currency: str = "USD"


@dataclass(frozen=True)
class Hint:
    """What a document says about a recurring charge (from the document reader)."""
    merchant: str
    amount: float | None
    billing: str | None           # weekly | monthly | quarterly | yearly | None
    plan: str | None = None
    next_charge: date | None = None
    last_charge: date | None = None
    currency: str = "USD"
    evidence: str | None = None


@dataclass
class Candidate:
    id: str
    name: str
    price: float
    currency: str
    billing: str
    renewal_date: str             # ISO; the next expected charge
    category: str | None
    confidence: str               # high | medium | low
    reason: str                   # shown to the user: why we think this is a subscription
    occurrences: int
    last_charged: str | None
    plan: str | None = None
    already_tracked: bool = False
    matched_subscription_id: str | None = None
    charges: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ------------------------------------------------------------------ merchants
_NOISE_PREFIXES = re.compile(
    r"^(pos|debit|credit|card|purchase|recurring|payment|pmt|ach|online|web|visa|mc|dd|direct debit|"
    r"checkcard|check card|preauthorized|pre-authorized|autopay|auto pay|bill pay|billpay)\b[\s:*#-]*", re.I)
_PROCESSOR = re.compile(r"^(sq|tst|sp|pp|paypal|py|google|gglpay|apple pay|in|dnh|pos)\s*\*\s*", re.I)
_TRAILING = re.compile(r"(\s+#?\d[\d\s/*#-]*.*$)|(\s+(www\.)?[a-z0-9-]+\.(com|net|io|co|tv)\b.*$)|(\s+[A-Z]{2}\s*$)")

# Merchant keyword -> (display name, category). Matched against the normalized name.
KNOWN: list[tuple[str, str, str]] = [
    ("netflix", "Netflix", "Entertainment"), ("hulu", "Hulu", "Entertainment"),
    ("disney", "Disney+", "Entertainment"), ("hbo", "Max", "Entertainment"), ("max.com", "Max", "Entertainment"),
    ("paramount", "Paramount+", "Entertainment"), ("peacock", "Peacock", "Entertainment"),
    ("crunchyroll", "Crunchyroll", "Entertainment"), ("youtube", "YouTube Premium", "Entertainment"),
    ("sling", "Sling TV", "Entertainment"), ("fubo", "Fubo", "Entertainment"), ("espn", "ESPN+", "Entertainment"),
    ("prime video", "Prime Video", "Entertainment"), ("amazon prime", "Amazon Prime", "Other"),
    ("apple tv", "Apple TV+", "Entertainment"),
    ("spotify", "Spotify", "Music"), ("pandora", "Pandora", "Music"), ("tidal", "Tidal", "Music"),
    ("siriusxm", "SiriusXM", "Music"), ("sirius xm", "SiriusXM", "Music"), ("apple music", "Apple Music", "Music"),
    ("audible", "Audible", "News & reading"), ("kindle unlimited", "Kindle Unlimited", "News & reading"),
    ("nytimes", "The New York Times", "News & reading"), ("ny times", "The New York Times", "News & reading"),
    ("new york times", "The New York Times", "News & reading"), ("wsj", "The Wall Street Journal", "News & reading"),
    ("washington post", "The Washington Post", "News & reading"), ("substack", "Substack", "News & reading"),
    ("medium", "Medium", "News & reading"), ("patreon", "Patreon", "Other"),
    ("icloud", "iCloud+", "Cloud & storage"), ("dropbox", "Dropbox", "Cloud & storage"),
    ("google one", "Google One", "Cloud & storage"), ("google storage", "Google One", "Cloud & storage"),
    ("onedrive", "OneDrive", "Cloud & storage"), ("backblaze", "Backblaze", "Cloud & storage"),
    ("adobe", "Adobe", "Software"), ("microsoft 365", "Microsoft 365", "Software"),
    ("msft", "Microsoft", "Software"), ("microsoft", "Microsoft", "Software"),
    ("chatgpt", "ChatGPT", "Software"), ("openai", "OpenAI", "Software"), ("anthropic", "Claude", "Software"),
    ("claude.ai", "Claude", "Software"), ("github", "GitHub", "Software"), ("notion", "Notion", "Software"),
    ("canva", "Canva", "Software"), ("slack", "Slack", "Software"), ("zoom", "Zoom", "Software"),
    ("1password", "1Password", "Software"), ("lastpass", "LastPass", "Software"), ("nordvpn", "NordVPN", "Software"),
    ("expressvpn", "ExpressVPN", "Software"), ("grammarly", "Grammarly", "Software"), ("figma", "Figma", "Software"),
    ("xbox", "Xbox Game Pass", "Gaming"), ("playstation", "PlayStation Plus", "Gaming"),
    ("nintendo", "Nintendo Switch Online", "Gaming"), ("steam", "Steam", "Gaming"), ("twitch", "Twitch", "Gaming"),
    ("duolingo", "Duolingo", "Education"), ("coursera", "Coursera", "Education"),
    ("masterclass", "MasterClass", "Education"), ("skillshare", "Skillshare", "Education"),
    ("peloton", "Peloton", "Health & fitness"), ("planet fitness", "Planet Fitness", "Health & fitness"),
    ("la fitness", "LA Fitness", "Health & fitness"), ("equinox", "Equinox", "Health & fitness"),
    ("anytime fitness", "Anytime Fitness", "Health & fitness"), ("strava", "Strava", "Health & fitness"),
    ("headspace", "Headspace", "Health & fitness"), ("calm", "Calm", "Health & fitness"),
    ("noom", "Noom", "Health & fitness"), ("classpass", "ClassPass", "Health & fitness"),
    ("doordash", "DashPass", "Food & delivery"), ("dashpass", "DashPass", "Food & delivery"),
    ("uber one", "Uber One", "Food & delivery"), ("instacart", "Instacart+", "Food & delivery"),
    ("hellofresh", "HelloFresh", "Food & delivery"), ("grubhub", "Grubhub+", "Food & delivery"),
    ("verizon", "Verizon", "Utilities"), ("t-mobile", "T-Mobile", "Utilities"), ("tmobile", "T-Mobile", "Utilities"),
    ("at&t", "AT&T", "Utilities"), ("comcast", "Xfinity", "Utilities"), ("xfinity", "Xfinity", "Utilities"),
    ("spectrum", "Spectrum", "Utilities"), ("mint mobile", "Mint Mobile", "Utilities"),
    ("geico", "GEICO", "Insurance"), ("progressive", "Progressive", "Insurance"),
    ("state farm", "State Farm", "Insurance"), ("allstate", "Allstate", "Insurance"), ("lemonade", "Lemonade", "Insurance"),
]
# Words in a merchant name that point to a category, when it isn't a known merchant.
CATEGORY_WORDS = [
    ("Health & fitness", ("gym", "fitness", "yoga", "pilates", "crossfit")),
    ("Insurance", ("insurance", "insur", "assurance")),
    ("Utilities", ("wireless", "mobile", "internet", "electric", "energy", "water", "gas co", "broadband")),
    ("Software", ("software", "app", "cloud", "saas")),
    ("News & reading", ("news", "times", "journal", "magazine", "post")),
]


def normalize_merchant(raw: str) -> str:
    """'POS DEBIT NETFLIX.COM 866-579-7172 CA' -> 'netflix'. Used to group charges."""
    s = (raw or "").strip()
    for _ in range(3):                                  # prefixes can stack: "POS DEBIT SQ *GYM"
        s2 = _PROCESSOR.sub("", _NOISE_PREFIXES.sub("", s)).strip()
        if s2 == s:
            break
        s = s2
    s = _TRAILING.sub("", s).strip() or s
    s = s.lower()
    s = re.sub(r"\.(com|net|io|co|tv)\b", "", s)
    s = re.sub(r"[^a-z0-9&+ ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Reference codes and dates ("1012", "p1234abcd") aren't part of the name; "1password" is.
    words = [w for w in s.split(" ") if w not in ("inc", "llc", "ltd", "co", "corp", "the", "bill", "subscription")
             and not w.isdigit() and sum(ch.isdigit() for ch in w) < 3]
    return " ".join(words[:3])


def known_merchant(raw: str) -> tuple[str, str] | None:
    """(display name, category) for a merchant that's almost always a subscription."""
    low = (raw or "").lower()
    norm = normalize_merchant(raw)
    for key, name, category in KNOWN:
        if key in norm or key in low:
            return name, category
    return None


def guess_category(raw: str) -> str | None:
    hit = known_merchant(raw)
    if hit:
        return hit[1]
    low = (raw or "").lower()
    for category, words in CATEGORY_WORDS:
        if any(w in low for w in words):
            return category
    return None


def display_name(raw: str) -> str:
    hit = known_merchant(raw)
    if hit:
        return hit[0]
    norm = normalize_merchant(raw)
    return " ".join(w.capitalize() if not w.isupper() else w for w in norm.split(" ")) or (raw or "").strip()[:80]


# ------------------------------------------------------------------ CSV
DATE_HEADERS = ("date", "transaction date", "trans date", "posted date", "posting date", "post date")
DESC_HEADERS = ("description", "merchant", "payee", "name", "details", "memo", "transaction", "original description")
AMOUNT_HEADERS = ("amount", "transaction amount", "amt")
DEBIT_HEADERS = ("debit", "withdrawal", "withdrawals", "money out", "charge", "charges")
CREDIT_HEADERS = ("credit", "deposit", "deposits", "money in", "payment")
DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y", "%Y/%m/%d", "%b %d, %Y", "%d %b %Y", "%m-%d-%Y",
                "%B %d, %Y")
MAX_CSV_ROWS = 20_000


class UnreadableFile(ValueError):
    """The file can't be read as a statement; the message is shown to the user."""


def parse_date(text: str) -> date | None:
    text = (text or "").strip()
    if not text:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text[:20].strip(), fmt).date()
        except ValueError:
            continue
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def parse_amount(text: str) -> float | None:
    s = (text or "").strip()
    if not s:
        return None
    negative = s.startswith("(") and s.endswith(")") or s.startswith("-") or s.endswith("-") or s.upper().endswith("CR")
    digits = re.sub(r"[^0-9.]", "", s)
    if not digits or digits.count(".") > 1:
        return None
    value = float(digits)
    return -value if negative else value


def _find(headers: list[str], names: tuple[str, ...]) -> int | None:
    for want in names:
        for i, h in enumerate(headers):
            if h == want:
                return i
    for want in names:
        for i, h in enumerate(headers):
            if want in h:
                return i
    return None


def parse_csv(data: bytes, currency: str = "USD") -> list[Charge]:
    """Charges from a bank or card CSV export. Handles a single signed amount column
    (either sign convention) or separate debit / credit columns."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    rows = list(csv.reader(io.StringIO(text)))
    # Some banks put a few lines of account info above the header row.
    header_at = next((i for i, r in enumerate(rows[:15])
                      if _find([c.strip().lower() for c in r], DATE_HEADERS) is not None
                      and _find([c.strip().lower() for c in r], DESC_HEADERS) is not None), None)
    if header_at is None:
        raise UnreadableFile("We couldn't find date and description columns in this CSV. Export it from your bank "
                           "with a header row, or upload a PDF or photo instead.")
    headers = [c.strip().lower() for c in rows[header_at]]
    di, ni = _find(headers, DATE_HEADERS), _find(headers, DESC_HEADERS)
    ai, dbi, cri = _find(headers, AMOUNT_HEADERS), _find(headers, DEBIT_HEADERS), _find(headers, CREDIT_HEADERS)
    if ai is None and dbi is None:
        raise UnreadableFile("We couldn't find an amount column in this CSV.")
    raw: list[tuple[date, str, float]] = []
    for r in rows[header_at + 1: header_at + 1 + MAX_CSV_ROWS]:
        if len(r) <= max(i for i in (di, ni, ai, dbi, cri) if i is not None):
            continue
        day, merchant = parse_date(r[di]), r[ni].strip()
        if day is None or not merchant:
            continue
        if ai is not None and (dbi is None or not r[dbi].strip()):
            amt = parse_amount(r[ai])
            if amt is None:
                continue
            raw.append((day, merchant, amt))
        else:
            out_ = parse_amount(r[dbi]) if dbi is not None else None
            in_ = parse_amount(r[cri]) if cri is not None else None
            if out_:
                raw.append((day, merchant, abs(out_)))
            elif in_:
                raw.append((day, merchant, -abs(in_)))
    if not raw:
        raise UnreadableFile("This CSV has no transactions we could read.")
    if ai is not None and dbi is None:
        # One signed column: most banks show spending as negative. If most rows are negative, flip.
        negatives = sum(1 for _, _, a in raw if a < 0)
        if negatives > len(raw) / 2:
            raw = [(d, m, -a) for d, m, a in raw]
    return [Charge(d, m, round(a, 2), currency) for d, m, a in raw if a > 0]


# ------------------------------------------------------------------ detection
def _cycle(gaps: list[int]) -> str | None:
    """The billing cycle that explains these day gaps between charges, if any.
    A skipped month (gap of ~2 cycles) is tolerated so one missing statement page doesn't hide it."""
    if not gaps:
        return None
    med = statistics.median(gaps)
    for name, days in BILLING_DAYS.items():
        tol = BILLING_TOLERANCE[name]
        if abs(med - days) <= tol:
            ok = sum(1 for g in gaps if abs(g - days) <= tol or abs(g - 2 * days) <= 2 * tol)
            if ok >= max(1, round(0.75 * len(gaps))):
                return name
    return None


def _similar(amounts: list[float]) -> bool:
    lo, hi = min(amounts), max(amounts)
    return hi - lo <= max(2.0, 0.25 * lo)


def next_charge(last: date, billing: str, today: date) -> date:
    step = STEP.get(billing, STEP["monthly"])
    n, current = 1, last + step
    while current < today:
        n += 1
        current = last + step * n
    return current


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def _match_existing(name: str, merchant: str, existing: dict[str, str]) -> str | None:
    """existing: normalized tracked-subscription name -> id."""
    for k in {_key(name), _key(normalize_merchant(merchant)), _key(display_name(merchant))}:
        if not k:
            continue
        for ek, sid in existing.items():
            if ek and (ek == k or (len(k) >= 4 and k in ek) or (len(ek) >= 4 and ek in k)):
                return sid
    return None


def detect(charges: list[Charge], hints: list[Hint] | None = None, existing: dict[str, str] | None = None,
           today: date | None = None) -> list[Candidate]:
    """Subscriptions suggested by these charges and document hints, most confident first.
    `existing` maps the user's tracked subscription names to ids, so a match is flagged
    `already_tracked` instead of being suggested twice."""
    today = today or date.today()
    existing = {_key(k): v for k, v in (existing or {}).items()}
    groups: dict[str, list[Charge]] = {}
    for c in charges:
        if c.amount <= 0:
            continue
        k = normalize_merchant(c.merchant)
        if k:
            groups.setdefault(k, []).append(c)

    out: dict[str, Candidate] = {}

    def add(key: str, cand: Candidate):
        prev = out.get(key)
        rank = {"high": 3, "medium": 2, "low": 1}
        if prev is None or rank[cand.confidence] > rank[prev.confidence]:
            sid = _match_existing(cand.name, cand.charges[0]["merchant"] if cand.charges else cand.name, existing)
            cand.already_tracked, cand.matched_subscription_id = sid is not None, sid
            out[key] = cand

    for key, cs in groups.items():
        cs.sort(key=lambda c: c.day)
        # One charge per day: a duplicated statement page or a pending + posted pair isn't two charges.
        by_day: dict[date, Charge] = {}
        for c in cs:
            by_day.setdefault(c.day, c)
        cs = list(by_day.values())
        merchant = cs[-1].merchant
        known = known_merchant(merchant)
        charge_list = [{"date": c.day.isoformat(), "merchant": c.merchant, "amount": c.amount} for c in cs[-12:]]
        if len(cs) >= 2:
            # A merchant can bill several things (two streaming plans, a phone and a tablet line):
            # look for a regular series among charges of a similar amount.
            series = _best_series(cs)
            if series:
                billing, run = series
                last = run[-1]
                price = run[-1].amount
                n = len(run)
                conf = "high" if n >= 3 or (n == 2 and known) else "medium"
                add(key, Candidate(
                    id=f"r-{_key(key)}", name=display_name(merchant), price=price, currency=last.currency,
                    billing=billing, renewal_date=next_charge(last.day, billing, today).isoformat(),
                    category=guess_category(merchant), confidence=conf,
                    reason=f"Charged {n} times, about every {_cycle_word(billing)}"
                           + (f"; latest {price:.2f}" if len({c.amount for c in run}) > 1 else ""),
                    occurrences=n, last_charged=last.day.isoformat(),
                    charges=[{"date": c.day.isoformat(), "merchant": c.merchant, "amount": c.amount} for c in run[-12:]]))
                continue
        if known:
            last = cs[-1]
            add(key, Candidate(
                id=f"k-{_key(key)}", name=known[0], price=last.amount, currency=last.currency, billing="monthly",
                renewal_date=next_charge(last.day, "monthly", today).isoformat(), category=known[1],
                confidence="low",
                reason=f"{known[0]} is usually a subscription; only {len(cs)} charge{'s' if len(cs) > 1 else ''} "
                       "found, so check the billing cycle",
                occurrences=len(cs), last_charged=last.day.isoformat(), charges=charge_list))

    for h in hints or []:
        key = normalize_merchant(h.merchant) or _key(h.merchant)
        if not key:
            continue
        billing = h.billing if h.billing in STEP else None
        related = groups.get(key, [])
        last_day = h.last_charge or (max(c.day for c in related) if related else None)
        price = h.amount if h.amount is not None else (related[-1].amount if related else None)
        if price is None or price <= 0:
            continue
        known = known_merchant(h.merchant)
        cycle = billing or "monthly"
        if h.next_charge and h.next_charge >= today:
            renewal = h.next_charge
        elif h.next_charge:                       # a stated date that has passed: roll it forward
            renewal = next_charge(h.next_charge, cycle, today)
        elif last_day:
            renewal = next_charge(last_day, cycle, today)
        else:
            renewal = today + timedelta(days=int(BILLING_DAYS[cycle]))
        add(key, Candidate(
            id=f"h-{_key(key)}", name=known[0] if known else display_name(h.merchant), price=round(price, 2),
            currency=h.currency or "USD", billing=cycle, renewal_date=renewal.isoformat(),
            category=guess_category(h.merchant), confidence="high" if billing else "medium",
            reason=(h.evidence or "The document describes a recurring charge")[:200]
                   + ("" if billing else "; billing cycle not stated, so check it"),
            occurrences=max(1, len(related)), last_charged=last_day.isoformat() if last_day else None, plan=h.plan,
            charges=[{"date": c.day.isoformat(), "merchant": c.merchant, "amount": c.amount} for c in related[-12:]]))

    rank = {"high": 0, "medium": 1, "low": 2}
    result = sorted(out.values(), key=lambda c: (c.already_tracked, rank[c.confidence], c.renewal_date, c.name))
    return result[:MAX_CANDIDATES]


def _best_series(cs: list[Charge]) -> tuple[str, list[Charge]] | None:
    """The longest regular series (billing cycle, charges) among date-sorted charges of
    similar amounts, or None. Charges are clustered by amount first."""
    clusters: list[list[Charge]] = []
    for c in sorted(cs, key=lambda c: c.amount):
        if clusters and _similar([clusters[-1][0].amount, c.amount]):
            clusters[-1].append(c)
        else:
            clusters.append([c])
    best: tuple[str, list[Charge]] | None = None
    for cl in clusters + ([cs] if len(clusters) > 1 and _similar([c.amount for c in cs]) else []):
        if len(cl) < 2:
            continue
        run = sorted(cl, key=lambda c: c.day)
        gaps = [(b.day - a.day).days for a, b in zip(run, run[1:])]
        billing = _cycle(gaps)
        if billing and (best is None or len(run) > len(best[1])):
            best = (billing, run)
    return best


def _cycle_word(billing: str) -> str:
    return {"weekly": "week", "monthly": "month", "quarterly": "3 months", "yearly": "year"}[billing]
