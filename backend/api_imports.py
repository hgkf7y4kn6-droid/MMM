"""Find subscriptions in an uploaded receipt or statement (Free), or in linked bank
transactions (Pro).

    POST   /api/imports              upload a photo, PDF or CSV; processed in the background
    POST   /api/imports/linked       Pro: scan the linked bank account's transactions
    GET    /api/imports              recent imports
    GET    /api/imports/{id}         one import and the subscriptions it found (poll while queued)
    POST   /api/imports/{id}/apply   add the ones the user picked (with their edits) to their subscriptions
    DELETE /api/imports/{id}

Nothing is added to a user's subscriptions until they confirm. Uploaded files are
deleted as soon as they've been read (see models.ImportJob). Every route is scoped
to the verified caller; another user's import id answers 404.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import document_reader
import subscription_detect as sd
from api_subscriptions import MAX_PER_USER, SubscriptionIn
from auth import User, current_user
from database import get_db
from entitlements import Entitlement, require_feature, resolve
from models import ImportJob, TrackedSubscription, Transaction

log = logging.getLogger("imports")
router = APIRouter(prefix="/api/imports", tags=["imports"])

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_BYTES = 5 * 1024 * 1024          # the model API's per-image limit
DEFAULT_DAILY_LIMIT = 20                   # uploads per user per 24h (each photo/PDF is a paid model call)
STUCK_AFTER = timedelta(minutes=15)        # a job still queued/processing after this is reported as failed
LINKED_LOOKBACK_DAYS = 400
Source = Literal["receipt", "statement"]


def daily_limit(pro: bool) -> int:
    try:
        base = int(os.environ.get("IMPORT_DAILY_LIMIT", DEFAULT_DAILY_LIMIT))
    except ValueError:
        base = DEFAULT_DAILY_LIMIT
    return base * 5 if pro else base


def sniff(data: bytes) -> str | None:
    """The file's real type from its first bytes; the client's Content-Type isn't trusted."""
    head = data[:16]
    if head.startswith(b"%PDF"):
        return "application/pdf"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if head[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"mif1", b"msf1", b"hevc"):
        return "image/heic"
    try:
        sample = data[:4096].decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            sample = data[:4096].decode("latin-1")
        except UnicodeDecodeError:
            return None
    if "," in sample or ";" in sample or "\t" in sample:
        if not any(ord(ch) < 9 for ch in sample):
            return "text/csv"
    return None


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _out(job: ImportJob, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    status, error = job.status, job.error
    created = _aware(job.created_at)
    if status in ("queued", "processing") and created and now - created > STUCK_AFTER:
        status, error = "failed", "This import didn't finish. Please upload the file again."
    return {
        "id": job.id, "source": job.source, "filename": job.filename, "status": status, "error": error,
        "created_at": created.isoformat() if created else None,
        "finished_at": _aware(job.finished_at).isoformat() if job.finished_at else None,
        "transactions_found": job.transactions_found,
        "candidates": json.loads(job.candidates) if job.candidates else [],
        "notes": json.loads(job.notes) if job.notes else [],
    }


def _own(db: Session, user: User, job_id: str) -> ImportJob:
    job = db.get(ImportJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Import not found.")
    return job


def _existing(db: Session, user_id: str) -> dict[str, str]:
    rows = db.query(TrackedSubscription).filter(TrackedSubscription.user_id == user_id,
                                                TrackedSubscription.status != "cancelled").all()
    return {s.name: s.id for s in rows}


def _finish(db: Session, job: ImportJob, charges: list[sd.Charge], hints: list[sd.Hint], notes: list[str]) -> None:
    cands = sd.detect(charges, hints, _existing(db, job.user_id))
    if not cands:
        notes.append("No subscriptions found. Statements covering two or more months work best: a charge has to "
                     "repeat for us to be sure it's a subscription." if job.source != "receipt" else
                     "This receipt doesn't look like a subscription. Receipts that say “renews”, "
                     "“membership” or “monthly plan” are recognized.")
    job.candidates = json.dumps([c.to_dict() for c in cands])
    job.transactions_found = len(charges)
    job.notes = json.dumps(notes)
    job.status = "ready"


def process(db: Session, job: ImportJob) -> None:
    """Read the uploaded file, detect subscriptions, and delete the file. Run by the
    background worker (tasks.process_import_task); safe to call again on a retried job."""
    if job.status not in ("queued", "processing") or job.file_data is None:
        return
    job.status = "processing"
    db.commit()
    notes: list[str] = []
    try:
        if job.media_type == "text/csv":
            charges, hints = sd.parse_csv(job.file_data), []
        else:
            charges, hints, doc_type = document_reader.read(job.file_data, job.media_type, job.source)
            if doc_type == "other" and not charges:
                raise sd.UnreadableFile("This doesn't look like a receipt or statement.")
        _finish(db, job, charges, hints, notes)
    except (sd.UnreadableFile, document_reader.ReaderFailed, document_reader.ReaderUnavailable) as exc:
        job.status, job.error = "failed", str(exc)
    except Exception:
        log.exception("import %s failed", job.id)
        job.status, job.error = "failed", "Something went wrong reading this file. Please try again."
    finally:
        job.file_data = None                    # the document itself is never kept
        job.finished_at = datetime.now(timezone.utc)
        db.commit()


# ------------------------------------------------------------------ routes
@router.get("")
async def list_imports(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = (db.query(ImportJob).filter(ImportJob.user_id == user.id)
            .order_by(ImportJob.created_at.desc()).limit(20).all())
    return {"imports": [_out(j) for j in rows], "reads_photos": document_reader.configured(),
            "max_file_mb": MAX_FILE_BYTES // (1024 * 1024)}


@router.post("", status_code=202)
async def upload(file: UploadFile = File(...), source: Source = Form("statement"),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"Files can be up to {MAX_FILE_BYTES // (1024 * 1024)} MB.")
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty.")
    kind = sniff(data)
    if kind == "image/heic":
        raise HTTPException(status_code=415, detail="HEIC photos aren't supported. Choose the photo again from the "
                                                    "app (it converts to JPEG), or take a screenshot of it.")
    if kind is None:
        raise HTTPException(status_code=415, detail="Upload a photo (JPEG, PNG, WebP), a PDF, or a CSV export.")
    if kind != "text/csv" and not document_reader.configured():
        raise HTTPException(status_code=503, detail="Reading photos and PDFs isn't set up yet. "
                                                    "Upload a CSV export from your bank instead.")
    if kind.startswith("image/") and len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="That photo is over 5 MB. Try a lower-resolution photo.")
    since = datetime.now(timezone.utc) - timedelta(days=1)
    recent = db.query(ImportJob).filter(ImportJob.user_id == user.id, ImportJob.source != "linked",
                                        ImportJob.created_at >= since).count()
    limit = daily_limit(resolve(user, db).pro)
    if recent >= limit:
        raise HTTPException(status_code=429, detail=f"You can import up to {limit} files a day. Try again tomorrow.")

    job = ImportJob(id=uuid.uuid4().hex, user_id=user.id, source="csv" if kind == "text/csv" else source,
                    filename=(file.filename or "")[-120:] or None, media_type=kind, file_data=data, status="queued")
    db.add(job)
    db.commit()
    from tasks import enqueue, process_import_task
    enqueue(process_import_task, job.id)
    db.refresh(job)
    return _out(job)


@router.post("/linked", status_code=201)
async def scan_linked(user: User = Depends(current_user), db: Session = Depends(get_db),
                      _: Entitlement = Depends(require_feature("auto_detect_subscriptions"))):
    """Pro: find subscriptions in the linked bank account's synced transactions -- nothing to upload."""
    since = date.today() - timedelta(days=LINKED_LOOKBACK_DAYS)
    rows = (db.query(Transaction).filter(Transaction.user_id == user.id, Transaction.date >= since,
                                         Transaction.pending == False)  # noqa: E712
            .all())
    if not rows:
        raise HTTPException(status_code=404, detail={
            "code": "no_transactions",
            "message": "No bank transactions yet. Link a checking or credit card account, then try again."})
    skip = {"TRANSFER_IN", "TRANSFER_OUT", "INCOME", "LOAN_PAYMENTS"}
    charges = [sd.Charge(t.date, t.merchant_name or t.category_detailed or "", t.amount) for t in rows
               if (t.category_primary or "").upper() not in skip and (t.merchant_name or "").strip()]
    job = ImportJob(id=uuid.uuid4().hex, user_id=user.id, source="linked", status="processing")
    db.add(job)
    _finish(db, job, charges, [], [])
    job.finished_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return _out(job)


@router.get("/{job_id}")
async def get_import(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(_own(db, user, job_id))


class ApplyItem(BaseModel):
    candidate_id: str = Field(max_length=120)
    subscription: SubscriptionIn


class ApplyIn(BaseModel):
    items: list[ApplyItem] = Field(..., min_length=1, max_length=sd.MAX_CANDIDATES)


@router.post("/{job_id}/apply")
async def apply(job_id: str, body: ApplyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Add the picked candidates as tracked subscriptions. Each item carries the full
    subscription as the user confirmed it (they can edit name, price, cycle, date)."""
    job = _own(db, user, job_id)
    if job.status not in ("ready", "applied"):
        raise HTTPException(status_code=409, detail="This import isn't ready yet.")
    cands = json.loads(job.candidates or "[]")
    by_id = {c["id"]: c for c in cands}
    unknown = [i.candidate_id for i in body.items if i.candidate_id not in by_id]
    if unknown:
        raise HTTPException(status_code=422, detail="Some of those items aren't part of this import.")
    if any(by_id[i.candidate_id].get("added_subscription_id") for i in body.items):
        raise HTTPException(status_code=409, detail="Some of those were already added.")
    count = db.query(TrackedSubscription).filter(TrackedSubscription.user_id == user.id).count()
    if count + len(body.items) > MAX_PER_USER:
        raise HTTPException(status_code=400, detail=f"You can track up to {MAX_PER_USER} subscriptions.")
    note = {"linked": "Found in your linked bank transactions.", "receipt": "Added from a receipt you imported."}
    created = []
    for item in body.items:
        fields = item.subscription.model_dump()
        fields["notes"] = fields.get("notes") or note.get(job.source, "Added from a statement you imported.")
        s = TrackedSubscription(id=uuid.uuid4().hex, user_id=user.id, **fields)
        db.add(s)
        by_id[item.candidate_id]["added_subscription_id"] = s.id
        created.append(s.id)
    job.candidates = json.dumps(cands)
    job.status = "applied"
    db.commit()
    return {"added": len(created), "subscription_ids": created, "import": _out(job)}


@router.delete("/{job_id}", status_code=204)
async def delete_import(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own(db, user, job_id))
    db.commit()
