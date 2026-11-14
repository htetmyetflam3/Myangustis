"""The OCR lane — Python side.

Same rule as text extraction: an image-only page should produce text, not an
empty page. This module is the Python mirror of
``B.Parser/prised/@core/ocr/ocr.js``:

* a page qualifies when it **carries an image and has almost no extractable
  text** — a page with real text is never OCR'd;
* PDF pages are rendered as a whole before recognition, including placed
  images, clipping and vector content, at JS's default scale of 3;
* an OCR failure leaves the page exactly as it was, and is logged, never
  raised into the parse;
* Safety: ``LOCAL_MAX_OCR_PIXELS`` (default 25,000,000).

OCR backend: the native Tesseract CLI (``tesseract``), with Myanmar traineddata
installed in the system tessdata directory or supplied separately. No JavaScript
OCR runtime or language model is bundled in this Python package.

    PRASER_TESSERACT_BIN=/usr/bin/tesseract
    PRASER_OCR_LANG=mya
    PRASER_OCR_LANG_PATH=<dir with mya.traineddata>   (otherwise system tessdata)

No tesseract installed? :func:`available` is false, the parser logs one line
and behaves exactly as before — text lanes are unaffected.
"""

from __future__ import annotations

import io
import math
import os
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

from myangustis_parser.extract import pdf_extract

__all__ = [
    "OcrError",
    "available",
    "describe",
    "ocr_image",
    "ocr_pdf_page",
    "ocr_pdf_region",
    "max_pixels",
    "langs",
    "MODEL_DIR",
]

# Optional local tessdata directory under B.Parser, if present.
from myangustis_parser.resources.paths import PARSER_ROOT
MODEL_DIR = Path(os.environ.get("PRASER_OCR_LANG_PATH")
                 or (PARSER_ROOT / "resources" / "ocr"))


class OcrError(RuntimeError):
    """OCR could not run for this page/image."""


def max_pixels() -> float:
    """Per-image pixel cap, from the same limit.js entry as the JS lane."""
    from myangustis_parser.entry import limits
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
    # Remove the CLI form feed, but preserve line breaks in the OCR result.
    return text.replace("\r\n", "\n").replace("\f", "")


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


# ── recognising PDF pages and regions ─────────────────────────────────────
def _user_unit(pdf_bytes, page_number, objects):
    """Read the optional page-local UserUnit; PDFium does not apply it itself."""
    if objects is None and b'/ObjStm' in pdf_bytes:
        # Page dictionaries can themselves be in compressed object streams.
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        value = reader.pages[page_number - 1].get('/UserUnit')
    else:
        if b'/UserUnit' not in pdf_bytes:
            return 1.0
        from myangustis_parser.extract.pdf_fonts import Ref, parse_object
        if objects is None:
            objects = pdf_extract.parse_pdf_objects(pdf_bytes)
        pages = pdf_extract.collect_pages(objects, pdf_extract.find_root_pages(objects))
        if page_number > len(pages):
            return 1.0
        num, gen = pages[page_number - 1]
        page = parse_object(objects.get((num, gen), b''))
        value = page.get('UserUnit') if isinstance(page, dict) else None
        # UserUnit may be indirect, just as other dictionary numbers can be.
        seen = set()
        while isinstance(value, Ref) and value not in seen and len(seen) < 32:
            seen.add(value)
            value = parse_object(objects.get((value.num, value.gen), b''))
    if (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value > 0):
        return float(value)
    return 1.0


def _region_pixels(box, rotation, scale, bbox, width, height):
    """Convert PDF coordinates to an outward-rounded, clipped viewport crop."""
    left, bottom, right, top = box
    def viewport(x, y):
        if rotation == 90:
            return (y - bottom) * scale, (x - left) * scale
        if rotation == 180:
            return (right - x) * scale, (y - bottom) * scale
        if rotation == 270:
            return (top - y) * scale, (right - x) * scale
        return (x - left) * scale, (top - y) * scale
    x0, y0, x1, y1 = bbox
    points = [viewport(x, y) for x, y in ((x0, y0), (x0, y1), (x1, y0), (x1, y1))]
    crop = (max(0, math.floor(min(p[0] for p in points))),
            max(0, math.floor(min(p[1] for p in points))),
            min(width, math.ceil(max(p[0] for p in points))),
            min(height, math.ceil(max(p[1] for p in points))))
    if crop[2] <= crop[0] or crop[3] <= crop[1]:
        raise OcrError("PDF image region is outside the visible page")
    return crop


def _render_pdf_png(pdf_bytes, page_number, *, scale=3, bbox=None, objects=None):
    """Render the complete visible page, optionally cropping in PDF coordinates.

    JS uses PDF.js plus canvas. Python uses PDFium, so rasterization is not
    necessarily pixel-identical; placement, rotation, page scale and the
    pre-allocation pixel guard follow the same runtime path.
    """
    if not isinstance(scale, (int, float)) or isinstance(scale, bool) or not math.isfinite(scale) or not 0 < scale <= 4:
        raise OcrError("OCR scale must be greater than zero and at most 4")
    if not isinstance(page_number, int) or isinstance(page_number, bool) or page_number < 1:
        raise OcrError("page numbers start at 1")
    if bbox is not None and (not isinstance(bbox, (list, tuple)) or len(bbox) != 4
                             or any(not isinstance(v, (int, float)) or isinstance(v, bool)
                                    or not math.isfinite(v) for v in bbox)):
        raise OcrError("PDF image region must be a four-number bounding box")
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise OcrError("PDF page rendering requires pypdfium2 and Pillow") from exc
    doc = None
    page = None
    bitmap = None
    try:
        doc = pdfium.PdfDocument(bytes(pdf_bytes))
        if page_number > len(doc):
            raise OcrError(f"page {page_number} is past the last page ({len(doc)})")
        page = doc[page_number - 1]
        factor = scale * _user_unit(bytes(pdf_bytes), page_number, objects)
        page_width, page_height = page.get_size()
        if not all(math.isfinite(v) and v > 0 for v in (factor, page_width, page_height)):
            raise OcrError("Invalid PDF page dimensions")
        width = max(1, math.ceil(page_width * factor))
        height = max(1, math.ceil(page_height * factor))
        if width * height > max_pixels():
            raise OcrError(f"PDF render exceeds the {max_pixels()} pixel cap")
        # Check the entire page, even when only a small region was requested.
        crop = _region_pixels(page.get_bbox(), page.get_rotation(), factor, bbox, width, height) if bbox is not None else None
        bitmap = page.render(scale=factor, draw_annots=True)
        image = bitmap.to_pil()
        if crop is not None:
            image = image.crop(crop)
        out = io.BytesIO()
        image.save(out, format='PNG')
        return out.getvalue(), (image.width, image.height)
    except OcrError:
        raise
    except Exception as exc:
        raise OcrError(f"PDF page render failed: {exc}") from exc
    finally:
        if bitmap is not None:
            bitmap.close()
        if page is not None:
            page.close()
        if doc is not None:
            doc.close()


def ocr_pdf_page(pdf_bytes, page_number, *, objects=None, log=lambda _m: None, scale=3):
    """OCR a rendered 1-based PDF page (not a single embedded image)."""
    data, _ = _render_pdf_png(pdf_bytes, page_number, scale=scale, objects=objects)
    return ocr_image(data, suffix='.png')


def ocr_pdf_region(pdf_bytes, page_number, bbox, *, scale=3, dpi=None):
    """OCR a PDF-coordinate region; ``dpi`` is a legacy scale alias."""
    if dpi is not None:
        scale = dpi / 72
    data, _ = _render_pdf_png(pdf_bytes, page_number, scale=scale, bbox=bbox)
    return ocr_image(data, suffix='.png')
