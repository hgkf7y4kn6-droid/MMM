"""The local document reader: OCR lines -> charges, PDF text layers, and the engine choice.
OCR itself (PyTorch) is optional and not installed in CI, so it's exercised through
group_lines with OCR-shaped input; PDFs with a text layer are read for real."""
from datetime import date

import pytest

import document_reader as dr
import local_ocr
import subscription_detect as sd
import text_extract as tx
from tests.pdf_helper import text_pdf

TODAY = date(2026, 10, 31)
STATEMENT = ["CHASE FREEDOM", "Statement Period: 07/12/2026 - 10/11/2026",
             "07/14 07/15 NETFLIX.COM 866-579-7172 CA 15.49", "07/20 07/21 SHELL OIL 57444 41.02",
             "08/14 08/15 NETFLIX. COM 866-579-7172 CA 15.49", "08/22 08/22 PAYMENT THANK YOU -500.00",
             "09/14 09/15 NETFLIX.COM 866-579-7172 CA 15.49", "Total purchases 72.00", "New Balance 1,234.56"]


def box(x, y, w=60, h=24):
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]


def test_group_lines_orders_words_and_follows_tilt():
    # Two lines, each drifting 10px downward across the page (a tilted photo), given out of order.
    words = [(box(300, 70), "15.49"), (box(10, 20), "07/14"), (box(150, 25), "NETFLIX"), (box(300, 30), "15.49"),
             (box(10, 60), "08/14"), (box(150, 65), "SPOTIFY")]
    assert tx.group_lines(words) == ["07/14 NETFLIX 15.49", "08/14 SPOTIFY 15.49"]


@pytest.mark.parametrize("raw,clean", [("08 /16 WHOLEFDS 23. 41", "08/16 WHOLEFDS 23.41"), ("Oct 7 ,2026", "Oct 7, 2026"),
                                       ("Tax s0 . 00", "Tax $0.00"), ("NETFLIX. COM", "NETFLIX.COM"),
                                       ("Balance 1,234.56", "Balance 1,234.56")])
def test_clean_ocr_spacing(raw, clean):
    assert tx.clean(raw) == clean


def test_statement_lines():
    charges, hints = tx.extract(STATEMENT, "statement", today=TODAY)
    assert [(c.day.isoformat(), c.amount) for c in charges] == [
        ("2026-07-14", 15.49), ("2026-07-20", 41.02), ("2026-08-14", 15.49), ("2026-09-14", 15.49)]
    [cand] = sd.detect(charges, hints, today=TODAY)
    assert (cand.name, cand.billing, cand.confidence, cand.occurrences) == ("Netflix", "monthly", "high", 3)


def test_checking_statement_running_balance_and_year_rollover():
    lines = ["12/28 HULU 866 7.99 1,020.11", "01/28 HULU 866 7.99 1,012.12"]      # amount, then balance
    charges = tx.statement_charges(lines, date(2027, 1, 30))
    assert [(c.day.isoformat(), c.amount) for c in charges] == [("2026-12-28", 7.99), ("2027-01-28", 7.99)]


def test_receipt_with_renewal_wording():
    lines = ["Spotify AB", "Receipt", "Date: Oct 7, 2026", "Spotify Premium Individual", "Monthly subscription",
             "Subtotal $11.99", "Tax $0.00", "Total $11.99", "Your plan renews on Nov 7, 2026", "Visa ending 4242"]
    charges, hints = tx.extract(lines, "receipt", today=TODAY)
    assert [(c.day, c.merchant, c.amount) for c in charges] == [(date(2026, 10, 7), "Spotify AB", 11.99)]
    [h] = hints
    assert (h.billing, h.next_charge, h.amount) == ("monthly", date(2026, 11, 7), 11.99)
    [cand] = sd.detect(charges, hints, today=TODAY)
    assert (cand.name, cand.renewal_date, cand.confidence) == ("Spotify", "2026-11-07", "high")


def test_plain_purchase_receipt_is_not_a_subscription():
    lines = ["Corner Hardware", "10/02/2026", "Hammer 18.99", "Nails 4.50", "TOTAL 23.49", "Thank you!"]
    charges, hints = tx.extract(lines, "receipt", today=TODAY)
    assert hints == [] and sd.detect(charges, hints, today=TODAY) == []


def test_text_pdf_is_read_without_ocr(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(local_ocr, "ocr_installed", lambda: False)
    charges, _, _ = dr.read(text_pdf(STATEMENT), "application/pdf", "statement")
    assert len(charges) == 4 and charges[0].merchant.startswith("NETFLIX")


def test_scanned_pdf_and_photos_without_ocr_explain_what_works(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(local_ocr, "ocr_installed", lambda: False)
    with pytest.raises(dr.ReaderUnavailable, match="scan"):
        dr.read(text_pdf([]), "application/pdf", "statement")
    with pytest.raises(dr.ReaderUnavailable, match="PDF or CSV"):
        dr.read(b"\xff\xd8\xff" + b"0" * 10, "image/jpeg", "receipt")
    assert dr.reads_photos() is False


def test_engine_choice(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("DOCUMENT_READER", raising=False)
    assert dr.engine() == "local"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    assert dr.engine() == "claude"
    monkeypatch.setenv("DOCUMENT_READER", "local")                # keep documents on the server even with a key
    assert dr.engine() == "local"
