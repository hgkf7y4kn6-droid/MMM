"""Free-plan manual entry: subscription detection from receipts and statements, and
hand-entered holdings, cost basis and dividends."""
import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import api_holdings
import document_reader
import main
import subscription_detect as sd
import tasks
from auth import User, current_user
from database import Base, SessionLocal, engine
from models import ImportJob, ManualDividend, ManualHolding

TODAY = date(2026, 10, 31)


@pytest.fixture(autouse=True)
def clean_db(monkeypatch):
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    # Run background imports inline so the test sees the finished job.
    monkeypatch.setattr(tasks, "enqueue", lambda task, *args: task.apply(args=args, throw=True) and "inline")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    yield
    main.app.dependency_overrides.clear()


def client_as(user_id: str | None):
    main.app.dependency_overrides.clear()
    if user_id is not None:
        main.app.dependency_overrides[current_user] = lambda: User(user_id)
    return TestClient(main.app)


def months_back(n: int, day: int = 3) -> list[date]:
    out, d = [], date.today().replace(day=day)
    for _ in range(n):
        out.append(d)
        d = (d.replace(day=1) - timedelta(days=1)).replace(day=day)
    return sorted(out)


# ------------------------------------------------------------------ merchants
@pytest.mark.parametrize("raw,expected", [
    ("POS DEBIT NETFLIX.COM 866-579-7172 CA", "netflix"),
    ("SQ *BLUE BOTTLE COFFEE", "blue bottle coffee"),
    ("PAYPAL *SPOTIFY P1234ABCD", "spotify"),
    ("Spotify USA", "spotify usa"),
    ("CHECKCARD 1012 PLANET FITNESS #123", "planet fitness"),
])
def test_normalize_merchant(raw, expected):
    assert sd.normalize_merchant(raw) == expected


def test_known_merchants_and_categories():
    assert sd.known_merchant("APPLE.COM/BILL ICLOUD") == ("iCloud+", "Cloud & storage")
    assert sd.guess_category("CRUNCH GYM BROOKLYN") == "Health & fitness"
    assert sd.known_merchant("Joe's Pizza") is None


# ------------------------------------------------------------------ CSV
def test_csv_signed_amounts_spending_negative():
    data = b"Date,Description,Amount\n2026-09-03,NETFLIX.COM,-15.49\n2026-09-05,PAYROLL,2500.00\n2026-10-03,NETFLIX.COM,-15.49\n"
    charges = sd.parse_csv(data)
    assert [(c.day.isoformat(), c.amount) for c in charges] == [("2026-09-03", 15.49), ("2026-10-03", 15.49)]


def test_csv_debit_credit_columns_and_preamble():
    data = (b"Account: Checking ****1234\nStatement period: Sep 2026\n\n"
            b"Posted Date,Payee,Debit,Credit\n09/03/2026,Spotify,11.99,\n09/15/2026,Refund Store,,20.00\n"
            b"10/03/2026,Spotify,\"$11.99\",\n")
    charges = sd.parse_csv(data)
    assert [(c.merchant, c.amount) for c in charges] == [("Spotify", 11.99), ("Spotify", 11.99)]


def test_csv_without_columns_is_rejected():
    with pytest.raises(sd.UnreadableFile):
        sd.parse_csv(b"foo,bar\n1,2\n")


# ------------------------------------------------------------------ detection
def test_monthly_series_is_high_confidence():
    days = [date(2026, 6, 3), date(2026, 7, 3), date(2026, 8, 4), date(2026, 9, 3), date(2026, 10, 3)]
    charges = [sd.Charge(d, "NETFLIX.COM 866-579", 15.49) for d in days]
    [c] = sd.detect(charges, today=TODAY)
    assert (c.name, c.billing, c.confidence, c.occurrences, c.price) == ("Netflix", "monthly", "high", 5, 15.49)
    assert c.renewal_date == "2026-11-03" and c.category == "Entertainment"


def test_price_change_and_one_off_purchases():
    charges = [sd.Charge(date(2026, 7, 10), "Acme Cloud Storage", 9.99), sd.Charge(date(2026, 8, 10), "Acme Cloud Storage", 9.99),
               sd.Charge(date(2026, 9, 10), "Acme Cloud Storage", 11.99), sd.Charge(date(2026, 8, 20), "Hardware Store", 54.10),
               sd.Charge(date(2026, 9, 2), "Hardware Store", 12.00)]
    cands = sd.detect(charges, today=TODAY)
    assert [c.name for c in cands] == ["Acme Cloud Storage"]
    assert cands[0].price == 11.99 and cands[0].billing == "monthly"


def test_yearly_and_skipped_month():
    yearly = [sd.Charge(date(2024, 3, 1), "ADOBE *CREATIVE", 239.88), sd.Charge(date(2025, 3, 2), "ADOBE *CREATIVE", 239.88)]
    gappy = [sd.Charge(date(2026, 5, 15), "Local Gym", 40), sd.Charge(date(2026, 6, 15), "Local Gym", 40),
             sd.Charge(date(2026, 8, 15), "Local Gym", 40), sd.Charge(date(2026, 9, 15), "Local Gym", 40)]
    by_name = {c.name: c for c in sd.detect(yearly + gappy, today=TODAY)}
    assert by_name["Adobe"].billing == "yearly" and by_name["Adobe"].renewal_date == "2027-03-02"
    assert by_name["Local Gym"].billing == "monthly" and by_name["Local Gym"].category == "Health & fitness"


def test_single_known_charge_is_low_confidence_and_refunds_ignored():
    charges = [sd.Charge(date(2026, 10, 12), "SPOTIFY USA", 11.99), sd.Charge(date(2026, 10, 1), "NETFLIX", -15.49)]
    [c] = sd.detect(charges, today=TODAY)
    assert c.name == "Spotify" and c.confidence == "low" and c.renewal_date == "2026-11-12"


def test_document_hint_and_already_tracked():
    hint = sd.Hint(merchant="Peloton Interactive", amount=44.0, billing="monthly", plan="All-Access",
                   next_charge=date(2026, 11, 20), evidence="Your membership renews on Nov 20")
    cands = sd.detect([], [hint], existing={"Peloton": "sub-1"}, today=TODAY)
    [c] = cands
    assert (c.name, c.plan, c.renewal_date, c.confidence) == ("Peloton", "All-Access", "2026-11-20", "high")
    assert c.already_tracked and c.matched_subscription_id == "sub-1"


def test_parse_extraction_drops_bad_rows():
    raw = {"document_type": "statement", "currency": "eur", "charges": [
        {"date": "2026-10-01", "merchant": "Spotify", "amount": 10.99},
        {"date": None, "merchant": "No date", "amount": 3},
        {"date": "2099-01-01", "merchant": "Future", "amount": 3},
        {"date": "2026-10-02", "merchant": "", "amount": 3}],
        "recurring": [{"merchant": "Spotify", "amount": "10.99", "billing": "monthly", "plan": None,
                       "next_charge_date": "2026-11-01", "last_charge_date": None, "evidence": "Premium, renews monthly"}]}
    charges, hints, kind = document_reader.parse_extraction(raw, today=TODAY)
    assert [c.merchant for c in charges] == ["Spotify"] and charges[0].currency == "EUR"
    assert hints[0].amount == 10.99 and hints[0].billing == "monthly" and kind == "statement"


# ------------------------------------------------------------------ imports API
def csv_bytes():
    rows = ["Date,Description,Amount"] + [f"{d.isoformat()},NETFLIX.COM,-15.49" for d in months_back(3)]
    one_offs = [(date.today() - timedelta(days=n), amt) for n, amt in ((5, 4.25), (19, 17.80), (51, 9.10))]
    rows += [f"{d.isoformat()},Coffee Shop,-{amt:.2f}" for d, amt in one_offs]
    return ("\n".join(rows) + "\n").encode()


def test_csv_import_end_to_end():
    c = client_as("alice")
    r = c.post("/api/imports", files={"file": ("statement.csv", csv_bytes(), "text/csv")}, data={"source": "statement"})
    assert r.status_code == 202, r.text
    job = c.get(f"/api/imports/{r.json()['id']}").json()
    assert job["status"] == "ready" and job["source"] == "csv" and job["transactions_found"] == 6
    [cand] = job["candidates"]
    assert cand["name"] == "Netflix" and cand["confidence"] == "high"

    db = SessionLocal()
    assert db.get(ImportJob, job["id"]).file_data is None          # the upload is never kept
    db.close()

    sub = {"name": "Netflix", "price": 15.49, "billing": "monthly", "renewal_date": cand["renewal_date"],
           "category": cand["category"]}
    r = c.post(f"/api/imports/{job['id']}/apply", json={"items": [{"candidate_id": cand["id"], "subscription": sub}]})
    assert r.status_code == 200 and r.json()["added"] == 1
    assert [s["name"] for s in c.get("/api/subscriptions").json()["subscriptions"]] == ["Netflix"]
    # applying the same candidate twice is refused
    assert c.post(f"/api/imports/{job['id']}/apply",
                  json={"items": [{"candidate_id": cand["id"], "subscription": sub}]}).status_code == 409

    # a second import now flags Netflix as already tracked
    r = c.post("/api/imports", files={"file": ("s.csv", csv_bytes(), "text/csv")})
    assert r.json()["candidates"][0]["already_tracked"] is True

    # other users can't see or apply alice's import
    bob = client_as("bob")
    assert bob.get(f"/api/imports/{job['id']}").status_code == 404
    assert bob.get("/api/imports").json()["imports"] == []


def test_upload_rejects_unknown_and_heic_and_unconfigured_photos(monkeypatch):
    import local_ocr
    monkeypatch.setattr(local_ocr, "ocr_installed", lambda: False)      # no API key and no local OCR
    c = client_as("alice")
    assert c.post("/api/imports", files={"file": ("x.bin", b"\x00\x01\x02\x03" * 10, "application/octet-stream")}).status_code == 415
    heic = b"\x00\x00\x00\x18ftypheic" + b"\x00" * 32
    assert c.post("/api/imports", files={"file": ("x.heic", heic, "image/heic")}).status_code == 415
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 100
    r = c.post("/api/imports", files={"file": ("r.jpg", jpeg, "image/jpeg")}, data={"source": "receipt"})
    assert r.status_code == 503 and "CSV" in r.json()["detail"]
    assert c.get("/api/imports").json()["reads_photos"] is False


def test_photo_import_uses_the_document_reader(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    seen = {}

    def fake_read(data, media_type, source):
        seen.update(media_type=media_type, source=source)
        return [], [sd.Hint("Disney Plus", 13.99, "monthly", evidence="Subscription renews monthly")], "receipt"

    monkeypatch.setattr(document_reader, "read", fake_read)
    c = client_as("alice")
    r = c.post("/api/imports", files={"file": ("r.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "image/png")},
               data={"source": "receipt"})
    job = c.get(f"/api/imports/{r.json()['id']}").json()
    assert seen == {"media_type": "image/png", "source": "receipt"}
    assert job["status"] == "ready" and job["candidates"][0]["name"] == "Disney+"


def test_reader_failure_is_reported_and_file_deleted(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")

    def boom(*a):
        raise document_reader.ReaderFailed("We couldn't read that file. Try a clearer photo.")

    monkeypatch.setattr(document_reader, "read", boom)
    c = client_as("alice")
    r = c.post("/api/imports", files={"file": ("doc.pdf", b"%PDF-1.7\n" + b"x" * 64, "application/pdf")})
    job = c.get(f"/api/imports/{r.json()['id']}").json()
    assert job["status"] == "failed" and "clearer photo" in job["error"]
    db = SessionLocal()
    assert db.get(ImportJob, job["id"]).file_data is None
    db.close()


def test_daily_import_limit(monkeypatch):
    monkeypatch.setenv("IMPORT_DAILY_LIMIT", "2")
    c = client_as("alice")
    for _ in range(2):
        assert c.post("/api/imports", files={"file": ("s.csv", csv_bytes(), "text/csv")}).status_code == 202
    assert c.post("/api/imports", files={"file": ("s.csv", csv_bytes(), "text/csv")}).status_code == 429


def test_uploads_may_exceed_the_json_body_cap():
    big = b"Date,Description,Amount\n" + b"2026-10-01,Thing,-1.00\n" * 90_000      # ~2 MB
    assert len(big) > 1024 * 1024
    c = client_as("alice")
    assert c.post("/api/imports", files={"file": ("big.csv", big, "text/csv")}).status_code == 202
    assert c.post("/api/subscriptions", content=big, headers={"content-type": "application/json"}).status_code == 413


def test_linked_scan_is_pro(monkeypatch):
    from models import Transaction
    assert client_as("alice").post("/api/imports/linked").status_code == 402
    monkeypatch.setenv("COMPLIMENTARY_PRO_USER_IDS", "alice")
    c = client_as("alice")
    assert c.post("/api/imports/linked").status_code == 404                  # nothing synced yet
    db = SessionLocal()
    for i, d in enumerate(months_back(4)):
        db.add(Transaction(transaction_id=f"t{i}", account_id="a", user_id="alice", date=d, amount=11.99,
                           merchant_name="Spotify", category_primary="ENTERTAINMENT"))
        db.add(Transaction(transaction_id=f"x{i}", account_id="a", user_id="alice", date=d, amount=500,
                           merchant_name="Savings", category_primary="TRANSFER_OUT"))
    db.commit()
    db.close()
    r = c.post("/api/imports/linked")
    assert r.status_code == 201
    assert [x["name"] for x in r.json()["candidates"]] == ["Spotify"]


# ------------------------------------------------------------------ holdings
def test_holdings_crud_validation_and_isolation():
    c = client_as("alice")
    assert c.post("/api/holdings/lots", json={"symbol": "not a ticker!", "shares": 1}).status_code == 422
    assert c.post("/api/holdings/lots", json={"symbol": "VTI", "shares": 0}).status_code == 422
    future = (date.today() + timedelta(days=3)).isoformat()
    assert c.post("/api/holdings/lots", json={"symbol": "VTI", "shares": 1, "acquired_on": future}).status_code == 422

    a = c.post("/api/holdings/lots", json={"symbol": " demo-lite ", "shares": 10, "cost_basis": 900,
                                           "acquired_on": "2024-01-02", "account_label": "Roth IRA"}).json()
    assert a["symbol"] == "DEMO-LITE" and a["cost_per_share"] == 90
    c.post("/api/holdings/lots", json={"symbol": "DEMO-LITE", "shares": 5, "cost_basis": 600, "acquired_on": "2025-01-02"})
    c.post("/api/holdings/dividends", json={"symbol": "DEMO-LITE", "paid_on": "2025-06-15", "amount": 12.5})
    body = c.get("/api/holdings").json()
    [summary] = body["summary"]
    assert summary["shares"] == 15 and summary["cost_basis"] == 1500 and summary["avg_cost"] == 100
    assert summary["dividends_total"] == 12.5

    bob = client_as("bob")
    assert bob.get("/api/holdings").json()["lots"] == []
    assert bob.put(f"/api/holdings/lots/{a['id']}", json={"symbol": "X", "shares": 1}).status_code == 404
    assert bob.delete(f"/api/holdings/lots/{a['id']}").status_code == 404

    c = client_as("alice")
    assert c.put(f"/api/holdings/lots/{a['id']}", json={"symbol": "DEMO-LITE", "shares": 12}).json()["cost_basis"] is None
    assert c.delete(f"/api/holdings/lots/{a['id']}").status_code == 204
    assert len(c.get("/api/holdings").json()["lots"]) == 1


def test_manual_ledger():
    lot = lambda **kw: ManualHolding(id=kw.pop("id"), user_id="u", **kw)   # noqa: E731
    div = lambda **kw: ManualDividend(id=kw.pop("id"), user_id="u", reinvested=False, **kw)   # noqa: E731
    lots = [lot(id="1", symbol="AAA", shares=10, cost_basis=1000, acquired_on=date(2024, 1, 2)),
            lot(id="2", symbol="BBB", shares=3, cost_basis=None, acquired_on=None)]
    divs = [div(id="d1", symbol="AAA", paid_on=date(2024, 3, 1), amount=5.0),
            div(id="d2", symbol="AAA", paid_on=date(2023, 12, 1), amount=4.0),      # before the purchase
            div(id="d3", symbol="CCC", paid_on=date(2024, 3, 1), amount=1.0)]       # never held
    txns, notes = api_holdings.to_ledger(lots, divs)
    kinds = [(t.day.isoformat(), t.type, t.symbol, t.price) for t in txns]
    assert ("2024-01-02", "buy", "AAA", 100.0) in kinds
    assert ("2023-11-30", "transfer_in", "BBB", None) in kinds                       # opening balance
    assert [t.amount for t in txns if t.type == "dividend"] == [5.0]
    assert any("BBB" in n for n in notes) and any("AAA, CCC" in n for n in notes)


def test_manual_portfolio_overview_has_cost_basis():
    c = client_as("alice")
    assert c.get("/api/portfolio/overview?source=manual").json()["detail"]["code"] == "no_portfolio"
    c.post("/api/holdings/lots", json={"symbol": "DEMO-LITE", "shares": 10, "cost_basis": 500, "acquired_on": "2024-01-02"})
    c.post("/api/holdings/dividends", json={"symbol": "DEMO-LITE", "paid_on": "2024-06-01", "amount": 7})
    r = c.get("/api/portfolio/overview?source=manual")
    assert r.status_code == 200, r.text
    body = r.json()
    [h] = body["holdings"]
    assert h["cost_basis"] == 500 and h["dividends_received"] == 7
    assert h["unrealized_gain"] == pytest.approx(h["market_value"] - 500)
    assert body["total_cost_basis"] == 500 and body["dividends_received_total"] == 7 and body["source"] == "manual"


def test_export_and_delete_cover_manual_data():
    c = client_as("alice")
    c.post("/api/holdings/lots", json={"symbol": "VTI", "shares": 1})
    c.post("/api/holdings/dividends", json={"symbol": "VTI", "paid_on": "2025-01-01", "amount": 1})
    c.post("/api/imports", files={"file": ("s.csv", csv_bytes(), "text/csv")})
    export = c.get("/api/me/export").json()
    assert len(export["manual_holdings"]) == 1 and len(export["manual_dividends"]) == 1
    assert len(export["imports"]) == 1 and "file_data" not in export["imports"][0]
    deleted = c.delete("/api/me").json()["deleted"]
    assert deleted["manual_holdings"] == 1 and deleted["manual_dividends"] == 1 and deleted["import_jobs"] == 1
    assert json.dumps(c.get("/api/holdings").json()) == json.dumps({"lots": [], "dividends": [], "summary": []})
