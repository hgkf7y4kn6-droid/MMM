"""Read receipts and statements on this server, with no outside API.

    PDF with a text layer   text read directly (pypdfium2; light, always installed)
    photo / scanned PDF     OCR with EasyOCR, a PyTorch model (optional: requirements-ocr.txt)

The OCR words are put back into lines and parsed by text_extract.py. Nothing
leaves the server, which suits documents with financial details on them.

OCR_MODEL_DIR    where EasyOCR keeps its model weights (~100 MB, downloaded on first
                 use from GitHub; pre-download them at build time, see docs/DEPLOYMENT.md)
OCR_THREADS      CPU threads for inference (default 2)
OCR_MAX_PAGES    pages of a scanned PDF to OCR (default 10)

PyTorch is imported only when a photo is read, so the API starts as fast and as
small as before; the first photo after a restart pays the model load (seconds).
Memory: measured with PyPI's GPU build of PyTorch, importing it takes ~0.5 GB and the
loaded models (kept for later photos) bring the process to ~1.3 GB, peaking around
1.5-2 GB while reading. The CPU-only build in requirements-ocr.txt should be smaller
(not measured). Plan for an instance with 2 GB of RAM, or run OCR on the worker.
"""
from __future__ import annotations

import io
import logging
import os
import threading

log = logging.getLogger("local_ocr")

MIN_TEXT_CHARS = 80            # a PDF page with less text than this is treated as a scan
RENDER_SCALE = 1.6             # a letter page renders at ~1280 px tall, matching MAX_SIDE
# Photos are downscaled to this long side before OCR. Memory and time grow steeply with size
# (measured: 1280 px ~1.4 GB peak / 5 s; 1600 px ~2.4 GB / 16 s on 2 CPU threads), and a
# receipt photo reads correctly at 1280.
MAX_SIDE = 1280

_reader = None
_lock = threading.Lock()       # one OCR at a time: the model is shared and inference is CPU-bound


def ocr_installed() -> bool:
    try:
        import easyocr  # noqa: F401
        import torch  # noqa: F401
    except ImportError:
        return False
    return True


def _max_pages() -> int:
    try:
        return max(1, int(os.environ.get("OCR_MAX_PAGES", "10")))
    except ValueError:
        return 10


def _get_reader():
    global _reader
    if _reader is None:
        import easyocr
        import torch

        try:
            torch.set_num_threads(max(1, int(os.environ.get("OCR_THREADS", "2"))))
        except ValueError:
            pass
        kw = {"gpu": False, "verbose": False}
        if os.environ.get("OCR_MODEL_DIR"):
            kw["model_storage_directory"] = os.environ["OCR_MODEL_DIR"]
        _reader = easyocr.Reader(["en"], **kw)
    return _reader


def ocr_image(image) -> list[str]:
    """Lines of text in a PIL image."""
    import numpy as np
    from text_extract import group_lines

    image = image.convert("RGB")
    if max(image.size) > MAX_SIDE:
        image.thumbnail((MAX_SIDE, MAX_SIDE))
    import torch

    with _lock, torch.inference_mode():
        results = _get_reader().readtext(np.asarray(image), paragraph=False, canvas_size=MAX_SIDE, batch_size=4)
    return group_lines([(box, text) for box, text, conf in results if conf >= 0.2])


def pdf_lines(data: bytes) -> tuple[list[str], bool]:
    """(lines, needs_ocr). Pages with a text layer are read directly; if most pages have
    none (a scanned statement), they're rendered and OCR'd when OCR is installed."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    try:
        texts = []
        for i in range(min(len(pdf), 60)):
            page = pdf[i]
            texts.append(page.get_textpage().get_text_range())
        if sum(len(t.strip()) for t in texts) >= MIN_TEXT_CHARS * max(1, len(texts)) / 2:
            return [ln.strip() for t in texts for ln in t.splitlines() if ln.strip()], False
        if not ocr_installed():
            return [], True
        lines: list[str] = []
        for i in range(min(len(pdf), _max_pages())):
            lines += ocr_image(pdf[i].render(scale=RENDER_SCALE).to_pil())
        return lines, False
    finally:
        pdf.close()


def image_lines(data: bytes) -> list[str]:
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(data))
    img.draft("RGB", (MAX_SIDE, MAX_SIDE))      # JPEGs decode straight at reduced size: far less memory
    img = ImageOps.exif_transpose(img)          # phone photos store rotation in EXIF
    return ocr_image(img)
