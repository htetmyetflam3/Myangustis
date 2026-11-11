"""The OCR lane — Python side.

Same rule as text extraction: an image-only page should produce text, not an
empty page. This module is the Python mirror of
``B.Parser/prised/@core/ocr/ocr.js``:

* a page qualifies when it **carries an image and has almost no extractable
  text** — a page with real text is never OCR'd;
* the page's own raster image is extracted from the PDF and handed to the
  engine at native resolution. Rendering the page again would resample a scan
  and blur it *before* recognition;
* an OCR failure leaves the page exactly as it was, and is logged, never
  raised into the parse;
* limits: ``PRASER_MAX_OCR_PAGES`` (default 50) and
  ``LOCAL_MAX_OCR_PIXELS`` (default 25,000,000).

Engine: the Tesseract CLI (``tesseract``). Both parsers use the same bundled
Myanmar model — ``B.Parser/prised/@core/ocr/model/mya.traineddata`` — which is
data, not code. The JavaScript parser drives tesseract.js; this one drives the
native binary. Neither runs the other.

    PRASER_TESSERACT_BIN=/usr/bin/tesseract
    PRASER_OCR_LANG=mya
    PRASER_OCR_LANG_PATH=<dir with mya.traineddata>   (default: the bundled model)
    PRASER_OCR_DPI=200                                 (poppler fallback only)

No tesseract installed? :func:`available` is false, the parser logs one line
and behaves exactly as before — text lanes are unaffected.
"""

from __future__ import annotations

import os
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

import pdf_extract

__all__ = [
    "OcrError",
    "available",
    "describe",
    "ocr_image",
    "ocr_pdf_page",
    "ocr_pdf_region",
    "page_limit",
    "max_pixels",
    "langs",
    "MODEL_DIR",
]

# modules/ocr.py -> Python -> B.Parser
PARSER_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = Path(os.environ.get("PRASER_OCR_LANG_PATH")
                 or (PARSER_ROOT / "prised" / "@core" / "ocr" / "model"))


class OcrError(RuntimeError):
    """OCR could not run for this page/image."""


def _env_int(name, default, *, low=0, high=None):
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    value = max(low, value)
    return min(high, value) if high is not None else value


def page_limit() -> int:
    """Maximum image-only pages one document may OCR."""
    return _env_int("PRASER_MAX_OCR_PAGES", 50, low=1)


def max_pixels() -> float:
    """Per-image pixel cap, from the same limit.js entry as the JS lane."""
    import limits
    return limits.MAX_OCR_PIXELS


def langs():
    raw = (os.environ.get("PRASER_OCR_LANG") or "mya").replace("+", ",")
    return [part.strip() for part in raw.split(",") if part.strip()] or ["mya"]


def _binary() -> str:
    return (os.environ.get("PRASER_TESSERACT_BIN")
            or os.environ.get("PRASER_OCR_BIN") or "tesseract")


def _tessdata_dir():
    """Directory holding ``<lang>.traineddata``, or ``None`` for the default."""
    override = os.environ.get("PRASER_TESSDATA_DIR")
    if override:
        return Path(override)
    for lang in langs():
        for suffix in (".traineddata", ".traineddata.gz"):
            if (MODEL_DIR / f"{lang}{suffix}").is_file():
                return MODEL_DIR
    return None


def available() -> bool:
    """True when an OCR binary can be found on this machine."""
    return shutil.which(_binary()) is not None


def describe() -> str:
    if not available():
        return f"OCR unavailable (no {_binary()!r} on PATH)"
    where = _tessdata_dir()
    model = f"traineddata: {where}" if where else "system tessdata"
    return f"OCR: {_binary()} languages={','.join(langs())} ({model})"


# ── recognising one image ────────────────────────────────────────────────
def _clean_text(text: str) -> str:
    # Tesseract ends each page with a form feed; blank lines are the layout.
    return text.replace("\r\n", "\n").replace("\f", "").strip("\n")


def ocr_image(data, *, suffix: str = ".png") -> str:
    """Recognise one encoded image (PNG/JPEG/PPM/PGM/TIFF/...) and return text."""
    if not available():
        raise OcrError(f"OCR engine not installed ({_binary()!r})")
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError("image data must be bytes")
    payload = bytes(data)
    if not payload:
        raise OcrError("empty image")

    work = Path(tempfile.mkdtemp(prefix="myangustis-ocr-"))
    try:
        source = work / f"page{suffix}"
        source.write_bytes(payload)
        command = [_binary(), str(source), "stdout",
                   "-l", "+".join(langs())]
        tessdata = _tessdata_dir()
        if tessdata is not None:
            command += ["--tessdata-dir", str(tessdata)]
        psm = os.environ.get("PRASER_OCR_PSM")
        if psm:
            command += ["--psm", psm]
        timeout = int(os.environ.get("PRASER_OCR_TIMEOUT_SECONDS", "600"))
        try:
            proc = subprocess.run(command, capture_output=True, text=True,
                                  encoding="utf-8", timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise OcrError(f"could not run {_binary()}: {exc}") from exc
        if proc.returncode != 0:
            detail = (proc.stderr or "").strip().splitlines()
            raise OcrError(detail[-1] if detail else
                           f"tesseract exited {proc.returncode}")
        return _clean_text(proc.stdout)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def image_size(data):
    """``(width, height)`` for PNG/JPEG/PPM/PGM, else ``(0, 0)``."""
    head = bytes(data[:32])
    if head[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", bytes(data[16:24]))
    if head[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                          0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                height, width = struct.unpack(">HH", bytes(data[i + 5:i + 9]))
                return width, height
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            length = struct.unpack(">H", bytes(data[i + 2:i + 4]))[0]
            i += 2 + length
        return 0, 0
    if head[:2] == b"P6" or head[:2] == b"P5":
        parts = bytes(data[:64]).split(b"\n", 3)
        if len(parts) >= 3:
            try:
                width, height = (int(v) for v in parts[1].split()[:2])
                return width, height
            except ValueError:
                return 0, 0
    return 0, 0


# ── recognising one PDF page ─────────────────────────────────────────────
def _poppler_render(pdf_bytes, page_number, dpi):
    """Render one page with ``pdftoppm`` when the page image cannot be read."""
    binary = shutil.which(os.environ.get("PRASER_PDFTOPPM_BIN") or "pdftoppm")
    if binary is None:
        raise OcrError(
            "page image could not be decoded and pdftoppm is not installed "
            "(install poppler-utils, or supply a DCT/Flate scan)")
    work = Path(tempfile.mkdtemp(prefix="myangustis-ocr-render-"))
    try:
        source = work / "input.pdf"
        source.write_bytes(pdf_bytes)
        prefix = work / "page"
        command = [binary, "-f", str(page_number), "-l", str(page_number),
                   "-r", str(dpi), "-png", str(source), str(prefix)]
        proc = subprocess.run(command, capture_output=True, text=True,
                              timeout=int(os.environ.get("PRASER_OCR_TIMEOUT_SECONDS", "600")),
                              check=False)
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip().splitlines()
            raise OcrError(detail[-1] if detail else "pdftoppm failed")
        rendered = sorted(work.glob("page*.png"))
        if not rendered:
            raise OcrError("pdftoppm produced no page image")
        return rendered[0].read_bytes(), ".png"
    finally:
        shutil.rmtree(work, ignore_errors=True)


def ocr_pdf_page(pdf_bytes, page_number, *, objects=None, log=lambda _m: None):
    """OCR one 1-based PDF page: its own embedded image, else a render."""
    number = int(page_number)
    if number < 1:
        raise OcrError("page numbers start at 1")
    if objects is None:
        objects = pdf_extract.parse_pdf_objects(pdf_bytes)
    pages = pdf_extract.collect_pages(
        objects, pdf_extract.find_root_pages(objects))
    if number > len(pages):
        raise OcrError(f"page {number} is past the last page ({len(pages)})")
    num, gen = pages[number - 1]

    decoded = None
    try:
        decoded = pdf_extract.page_image_bytes(
            objects, num, gen, max_pixels=max_pixels(), log=log)
    except ValueError:
        raise
    if decoded is None:
        dpi = _env_int("PRASER_OCR_DPI", 200, low=50, high=600)
        decoded = _poppler_render(pdf_bytes, number, dpi)
    data, suffix = decoded
    width, height = image_size(data)
    if width and height and width * height > max_pixels():
        raise OcrError(f"{width}x{height} exceeds the {max_pixels()} pixel cap")
    return ocr_image(data, suffix=suffix)


def ocr_pdf_region(pdf_bytes, page_number, bbox, *, dpi=None):
    """OCR a region of a page (``(x0, y0, x1, y1)`` in page points)."""
    binary = shutil.which(os.environ.get("PRASER_PDFTOPPM_BIN") or "pdftoppm")
    if binary is None:
        raise OcrError("region OCR needs pdftoppm (poppler-utils)")
    x0, y0, x1, y1 = (float(v) for v in bbox)
    if x1 <= x0 or y1 <= y0:
        raise OcrError("empty OCR region")
    work = Path(tempfile.mkdtemp(prefix="myangustis-ocr-region-"))
    try:
        source = work / "input.pdf"
        source.write_bytes(pdf_bytes)
        # pdftoppm's crop box is in points, origin top-left.
        crop = f"{x0},{y0},{x1 - x0},{y1 - y0}"
        prefix = work / "region"
        command = [binary, "-f", str(int(page_number)), "-l", str(int(page_number)),
                   "-r", str(dpi or _env_int("PRASER_OCR_DPI", 200, low=50, high=600)),
                   "-x", str(int(x0)), "-y", str(int(y0)),
                   "-W", str(int(x1 - x0)), "-H", str(int(y1 - y0)),
                   "-png", str(source), str(prefix)]
        proc = subprocess.run(command, capture_output=True, text=True,
                              timeout=int(os.environ.get("PRASER_OCR_TIMEOUT_SECONDS", "600")),
                              check=False)
        if proc.returncode != 0:
            raise OcrError(f"pdftoppm region crop failed ({crop})")
        rendered = sorted(work.glob("region*.png"))
        if not rendered:
            raise OcrError("pdftoppm produced no region image")
        return ocr_image(rendered[0].read_bytes(), suffix=".png")
    finally:
        shutil.rmtree(work, ignore_errors=True)
