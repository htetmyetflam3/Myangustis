"""The Python Manager — this parser's own executor.

Historically this file was ``node_manager.py``: Python shelled out to
``extend/python-entry.js`` and the JavaScript Manager did the work. That made
the Python parser a client of the JavaScript one, which is exactly the
dependency this tree must not have. The Python parser now runs its own
pipeline end to end (extract -> detect -> convert -> cleanup -> write) and
this module is the single entry the CLI and the Flask API call.

Nothing here starts Node, imports a ``.js`` file, or reads a JavaScript
constant. The only shared input is JSON (see :mod:`maps`); the only shared
output is the file the caller asked for.

Public surface (kept identical to the old bridge so callers did not move):

    dispatch_path      file in  -> file out
    dispatch_bytes     bytes in -> file out
    dispatch_stream    opened binary stream in -> file out
    render_text        .txt in  -> .docx out
    mute_advisories    no advisories exist here; always succeeds
    ManagerError       the one error type callers catch
"""

from __future__ import annotations

import os
import shutil
import tempfile
from functools import lru_cache
from pathlib import Path

from myangustis_parser.workflow import ocr
from myangustis_parser.workflow import pipeline, finish
from myangustis_parser.output import render
from myangustis_parser.extract.docx_extract import strip_image_markers

__all__ = [
    "ManagerError",
    "dispatch_path",
    "dispatch_bytes",
    "dispatch_stream",
    "dispatch_ocr",
    "render_text",
    "mute_advisories",
    "conversion_lanes",
    "ocr_image_job",
    "ocr_pdf_job",
]

# Output extensions this parser can write.
_OUTPUT_FORMATS = ("txt", "docx", "pdf")
# Input lanes: text PDFs, DOCX, and (OCR) a bare image file.
_INPUT_KINDS = ("pdf", "docx", "ocr")
_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".tif", ".tiff",
                   ".webp", ".gif", ".bmp")


class ManagerError(RuntimeError):
    """A conversion failed in this parser."""


@lru_cache(maxsize=1)
def _detector():
    try:
        return pipeline.load_detector()
    except Exception as exc:  # noqa: BLE001 - surfaced with its own message
        raise ManagerError(str(exc)) from exc


def mute_advisories():
    """Compatibility shim.

    The advisories this used to silence belonged to the Node Manager. The
    Python parser has none, so muting is a successful no-op — callers that
    pass ``--quiet`` keep working without a Node dependency.
    """
    return ""


def conversion_lanes():
    """Which input/output combinations exist, without parsing anything."""
    return {"inputs": list(_INPUT_KINDS), "outputs": list(_OUTPUT_FORMATS)}


def _output_format(out_path) -> str:
    ext = Path(out_path).suffix.lower().lstrip(".")
    if ext not in _OUTPUT_FORMATS:
        raise ManagerError(
            f"Unsupported output extension {ext or '(none)'!r}; "
            f"use one of {', '.join('.' + e for e in _OUTPUT_FORMATS)}"
        )
    return ext


def _infer_kind(filename, kind=None):
    if kind is not None:
        kind = str(kind).lower()
        if kind not in _INPUT_KINDS:
            raise ManagerError(
                f"Unsupported input kind {kind!r} (use pdf, docx or ocr)")
        return kind
    name = str(filename or "").lower()
    if name.endswith(".pdf"):
        return "pdf"
    if name.endswith((".docx", ".doc")):
        return "docx"
    if name.endswith(_IMAGE_SUFFIXES):
        return "ocr"
    raise ManagerError(
        "input kind could not be inferred; pass pdf, docx or ocr")


def _ocr_enabled() -> bool:
    raw = (os.environ.get("PRASER_OCR") or "").strip().lower()
    return raw not in ("0", "off", "false", "no")


def ocr_image_job(data, filename, *, log=None):
    """A bare image file as a one-page job (the ``ocr`` lane).

    Returns the same job shape :func:`pipeline.process_bytes` produces, so a
    caller can pass it to :func:`pipeline.build_final_pages` /
    ``write_output_file`` without special-casing images.
    """
    return _ocr_job(data, os.path.basename(str(filename)), log or (lambda _m: None))


def _ocr_job(data, name, log):
    """A bare image file is one page of OCR text (the ``ocr`` lane)."""
    if not _ocr_enabled():
        raise ManagerError("OCR is disabled by PRASER_OCR")
    if not ocr.available():
        raise ManagerError(ocr.describe())
    raw = ocr.ocr_image(data, suffix=Path(name).suffix or ".png")
    finished = finish.finish_text(raw, source='ocr')
    text = finished['base']
    log(f"[+] {name}: OCR text ({len(text):,} characters)")
    return {
        "filename": name, "kind": "ocr",
        "reports": [{"page": 1, "category": "UNKNOWN", "prob": 0.0,
                     "base": text, "clean": finished["clean"],
                     "decision": "ocr", "scan": finished["scan"]}],
        "counts": {"UNKNOWN": 1}, "metadata": {}, "changes": [],
        "pages": [{"text": text}],
    }


def ocr_pdf_job(data, filename="input.pdf", *, log=None):
    """OCR every page of a PDF via ``workflow.ocr`` and finish via ``finish_text``."""
    log = log or (lambda _m: None)
    if not _ocr_enabled():
        raise ManagerError("OCR is disabled by PRASER_OCR")
    if not ocr.available():
        raise ManagerError(ocr.describe())

    from myangustis_parser.extract.decrypt import (
        decrypt_pdf,
        expand_object_streams,
        has_object_streams,
        is_encrypted_pdf,
    )
    from myangustis_parser.extract import pdf_extract

    name = os.path.basename(str(filename or "input.pdf"))
    raw = bytes(data)
    if is_encrypted_pdf(raw):
        raw = decrypt_pdf(raw, log)
    if has_object_streams(raw):
        raw = expand_object_streams(raw, log)
    objects = pdf_extract.parse_pdf_objects(raw)
    root = pdf_extract.find_root_pages(objects)
    pdf_pages = pdf_extract.collect_pages(objects, root) if root else []
    if not pdf_pages:
        raise ManagerError(f"No PDF pages found in {name}")

    reports = []
    pages = []
    ocr_pages = []
    for page_number in range(1, len(pdf_pages) + 1):
        raw_text = ocr.ocr_pdf_page(raw, page_number, objects=objects, log=log) or ""
        finished = finish.finish_text(raw_text, source="ocr")
        base = finished["base"]
        reports.append({
            "page": page_number,
            "category": "UNKNOWN",
            "prob": 0.0,
            "base": base,
            "clean": finished["clean"],
            "decision": "ocr",
            "scan": finished["scan"],
        })
        pages.append({"text": base})
        ocr_pages.append(page_number)
        log(f"    Page {page_number}/{len(pdf_pages)}: OCR ({len(base.strip()):,} chars)")

    return {
        "filename": name,
        "kind": "ocr",
        "reports": reports,
        "counts": {"UNKNOWN": len(pdf_pages)},
        "metadata": {},
        "changes": pipeline.collect_changes(reports),
        "pages": pages,
        "ocrPages": ocr_pages,
    }


# ECMAScript String.trim whitespace (Python str.strip differs for BOM and
# several control characters). Used for JS OCR routing and success checks.
_JS_TRIM_CHARS = ('\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680'
                  '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a'
                  '\u2028\u2029\u202f\u205f\u3000\ufeff')


def _ocr_pdf_image_pages(job, data, log):
    """OCR image-only PDF pages; returns the 1-based page numbers that worked.

    A page qualifies exactly as in the JS branch: it carries an image and has
    fewer than 8 characters of extractable text. Nothing else is touched, and
    a failure leaves the page as it was.
    """
    pages = job.get("pages") or []
    # JS String.length counts UTF-16 code units, not Unicode code points.
    targets = [i for i, page in enumerate(pages)
               if page.get("has_img") and len(str(page.get("text") or "").strip(_JS_TRIM_CHARS).encode('utf-16-le', 'surrogatepass')) // 2 < 8]
    if not targets:
        return []
    if not _ocr_enabled():
        log("[i] OCR disabled (PRASER_OCR=off); image-only pages left empty")
        return []
    if not ocr.available():
        log(f"[i] {ocr.describe()}; image-only pages left empty")
        return []

    from myangustis_parser.extract.decrypt import (decrypt_pdf, expand_object_streams, has_object_streams,
                         is_encrypted_pdf)
    from myangustis_parser.extract import pdf_extract

    # The pipeline rewrites encrypted / object-stream PDFs before parsing, so
    # the OCR lane must look at the same prepared bytes or it sees no pages.
    raw = data
    if is_encrypted_pdf(raw):
        raw = decrypt_pdf(raw, log)
    if has_object_streams(raw):
        raw = expand_object_streams(raw, log)
    objects = pdf_extract.parse_pdf_objects(raw)
    done = []
    for index in targets:
        try:
            text = ocr.ocr_pdf_page(raw, index + 1, objects=objects, log=log)
        except Exception as exc:  # noqa: BLE001 - OCR never fails the parse
            log(f"    Page {index + 1}: OCR skipped ({exc})")
            continue
        if text and text.strip(_JS_TRIM_CHARS):
            # JS replaces only page.text, leaving the PDF report and original
            # lines unchanged. Its final markup prefers any existing nonempty
            # lines over this text, even after successful OCR.
            pages[index]["text"] = text
            pages[index]["_ocr_supplied"] = True
            done.append(index + 1)
            log(f"    Page {index + 1}: OCR supplied the text (image-only page)")
    return done


def _replace_markers(job, replacements, log, clean_replacements=None):
    """Swap OCR placeholders in page and report text; drop the leftovers."""
    def swap(value, replacements):
        if not isinstance(value, str):
            return value
        for marker, text in replacements.items():
            value = value.replace(marker, text)
        return strip_image_markers(value)

    for page in job.get("pages") or []:
        page["text"] = swap(page.get("text"), replacements)
    for report in job.get("reports") or []:
        report["base"] = swap(report.get("base"), replacements)
        report["clean"] = swap(report.get("clean"), clean_replacements if clean_replacements is not None else replacements)
    job["changes"] = pipeline.collect_changes(job.get("reports") or [])


def _ocr_docx_images(job, log):
    """OCR pictures embedded in a DOCX; returns their ids."""
    files = job.get("image_files") or []
    if not files:
        return []
    replacements = {item["marker"]: "" for item in files}
    if not _ocr_enabled() or not ocr.available():
        log(f"[i] {ocr.describe() if _ocr_enabled() else 'OCR disabled'}; "
            "embedded DOCX images left as placeholders (removed)")
        _replace_markers(job, replacements, log)
        return []
    clean_replacements = dict(replacements)
    recognized = []
    for item in files:
        try:
            data = Path(item["path"]).read_bytes()
            text = ocr.ocr_image(data, suffix=Path(item["path"]).suffix)
            # JS inserts the trimmed OCR reading directly, without a separate
            # parsing or cleanup pass for the embedded image.
            replacements[item['marker']] = (text or '').strip(_JS_TRIM_CHARS)
            clean_replacements[item['marker']] = replacements[item['marker']]
            if replacements[item["marker"]]:
                recognized.append(item["id"])
                log(f"    DOCX image {item['id']}: OCR supplied the text")
        except Exception as exc:  # noqa: BLE001 - OCR never fails the parse
            log(f"    DOCX image {item['id']}: OCR skipped ({exc})")
    _replace_markers(job, replacements, log, clean_replacements)
    return recognized


def prepare_job(data, name, *, kind, source_encoding="auto", text_layout=None, log=None):
    """Extract and finish a document, including embedded-image OCR."""
    kind = _infer_kind(name, kind)
    if source_encoding not in ("auto", "unicode", "zawgyi-one"):
        raise ManagerError(f"Unknown source encoding {source_encoding!r}")
    log = log or (lambda _m: None)
    ocr_pages = []
    image_dir = None
    try:
        if kind == "ocr":
            job = _ocr_job(data, name, log)
            ocr_pages = [1]
        elif kind == "docx":
            # Pictures are extracted to a scratch dir, OCR'd, then their
            # placeholders are replaced; the dir never outlives the call.
            image_dir = tempfile.mkdtemp(prefix="myangustis-docx-img-")
            job = pipeline.process_docx_bytes(
                data, _detector(), filename=name, log=log, image_dir=image_dir,
                source_encoding=source_encoding)
            ocr_pages = _ocr_docx_images(job, log)
        else:
            job = pipeline.process_bytes(
                data, kind, _detector(), filename=name, log=log,
                text_layout=text_layout, source_encoding=source_encoding)
            ocr_pages = _ocr_pdf_image_pages(job, data, log)
    except ManagerError:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        raise ManagerError(f"{name}: {exc}") from exc
    finally:
        if image_dir is not None:
            shutil.rmtree(image_dir, ignore_errors=True)

    job["ocrPages"] = ocr_pages
    return job


def _convert(data, filename, out_path, *, kind, method=None,
             include_text=True, include_preview=False, source_encoding="auto",
             caller="site", text_layout=None, log=None):
    """Run this parser's pipeline on bytes and write the requested output.

    The returned dict keeps the field names the site, the CLI and the JSON
    job contract already use (``file``, ``text``, ``pages``, ``counts``,
    ``metadata``, ``changes``, ``encodingPath``), so a caller can move between
    this parser and the JavaScript one by exchanging JSON alone.
    """
    log = log or (lambda _m: None)
    kind = _infer_kind(filename, kind)
    out_format = _output_format(out_path)
    if method is None:
        method = "manual" if kind == "pdf" else "default"
    if method not in ("manual", "default"):
        raise ManagerError(f"Unknown method {method!r} (use manual or default)")
    if source_encoding not in ("auto", "unicode", "zawgyi-one"):
        raise ManagerError(
            f"Unknown source encoding {source_encoding!r} "
            "(use auto, unicode or zawgyi-one)")

    default_name = {"pdf": "input.pdf", "docx": "input.docx"}.get(kind, "input.png")
    name = os.path.basename(str(filename or default_name))
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError("data must be bytes")
    data = bytes(data)

    log(f"[+] {name}: {len(data):,} bytes -> .{out_format}")
    job = prepare_job(data, name, kind=kind, source_encoding=source_encoding,
                      text_layout=text_layout, log=log)
    ocr_pages = job["ocrPages"]

    page_count = len(job.get("reports") or [])

    pages = pipeline.build_final_pages(job, True)
    counts = job.get("counts") or {}
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    try:
        written_path, pos_report = pipeline.render_and_scan(out_path, pages, counts, name)
    except (OSError, ValueError, RuntimeError) as exc:
        raise ManagerError(f"could not finish {out_path}: {exc}") from exc

    result = {
        "posScan": pos_report,
        "file": written_path,
        "from": kind,
        "to": out_format,
        "filename": name,
        "method": method,
        "caller": caller,
        "parserRuntime": "python",
        "pages": page_count,
        "counts": counts,
        "metadata": job.get("metadata") or {},
        # 1-based PDF pages (or DOCX image ids) whose text came from OCR.
        "ocrPages": ocr_pages,
    }
    if include_text:
        result["text"] = pipeline.build_content(job, True, kind)
    if include_preview:
        result["changes"] = job.get("changes") or []
    if job.get("encoding_path"):
        result["encodingPath"] = job["encoding_path"]
    return result


def dispatch_path(in_path, out_path, *, kind=None, filename=None, method=None,
                  include_text=True, include_preview=False,
                  source_encoding="auto", caller="site", text_layout=None,
                  log=None):
    """Convert one file, by this parser's own pipeline."""
    source = Path(in_path)
    if not source.is_file():
        raise ManagerError(f"Input not found: {source}")
    return _convert(source.read_bytes(), filename or source.name, out_path,
                    kind=kind, method=method,
                    include_text=include_text, include_preview=include_preview,
                    source_encoding=source_encoding, caller=caller,
                    text_layout=text_layout, log=log)


def dispatch_bytes(data, filename, out_path, *, kind, method=None,
                   include_text=True, include_preview=False,
                   source_encoding="auto", caller="site", text_layout=None,
                   log=None):
    """Convert in-memory bytes (the API upload path)."""
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError("data must be bytes")
    return _convert(data, filename, out_path, kind=kind, method=method,
                    include_text=include_text,
                    include_preview=include_preview,
                    source_encoding=source_encoding, caller=caller,
                    text_layout=text_layout, log=log)


def dispatch_stream(source, out_path, *, filename, kind=None, method=None,
                    include_text=False, include_preview=False,
                    source_encoding="auto", caller="local", log=None,
                    chunk_size=64 * 1024):
    """Convert from an opened binary stream.

    The stream is read in bounded chunks by this process (the caller keeps
    ownership of the source), then handed to the same pipeline as the bytes
    path. Keeping the signature mirrors the old local-caller bridge, so
    existing local dispatch code does not change.
    """
    if not callable(getattr(source, "read", None)):
        raise TypeError("source must be an opened binary stream")
    chunks = []
    while True:
        chunk = source.read(chunk_size)
        if not isinstance(chunk, (bytes, bytearray, memoryview)):
            raise TypeError("source must yield bytes")
        if not chunk:
            break
        chunks.append(bytes(chunk))
    kind = _infer_kind(filename, kind)
    return dispatch_bytes(b"".join(chunks), os.path.basename(filename), out_path,
                          kind=kind, method=method,
                          include_text=include_text,
                          include_preview=include_preview,
                          source_encoding=source_encoding, caller=caller, log=log)


def dispatch_ocr(in_path, out_path, *, filename=None,
                 include_text=True, include_preview=False, caller="local",
                 log=None):
    """Run the OCR lane across a PDF or image file and write the requested output."""
    source = Path(in_path)
    if not source.is_file():
        raise ManagerError(f"Input not found: {source}")
    log = log or (lambda _m: None)
    name = os.path.basename(str(filename or source.name))
    out_format = _output_format(out_path)
    kind = _infer_kind(name)
    if kind == "docx":
        raise ManagerError(
            "OCR mode supports PDF and image inputs; run without --ocr to parse DOCX "
            "(embedded DOCX images are still OCR'd)"
        )
    data = source.read_bytes()
    log(f"[+] {name}: {len(data):,} bytes -> .{out_format} (OCR)")
    try:
        if kind == "ocr":
            job = _ocr_job(data, name, log)
            job["ocrPages"] = [1]
        else:
            job = ocr_pdf_job(data, name, log=log)
    except ManagerError:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        raise ManagerError(f"{name}: {exc}") from exc

    pages = pipeline.build_final_pages(job, True)
    counts = job.get("counts") or {}
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    try:
        written_path, pos_report = pipeline.render_and_scan(out_path, pages, counts, name)
    except (OSError, ValueError, RuntimeError) as exc:
        raise ManagerError(f"could not finish {out_path}: {exc}") from exc

    result = {
        "posScan": pos_report,
        "file": written_path,
        "from": "ocr",
        "to": out_format,
        "filename": name,
        "method": "ocr",
        "caller": caller,
        "parserRuntime": "python",
        "pages": len(job.get("reports") or []),
        "counts": counts,
        "metadata": job.get("metadata") or {},
        "ocrPages": job.get("ocrPages") or [],
    }
    if include_text:
        result["text"] = pipeline.build_content(job, True, "ocr")
    if include_preview:
        result["changes"] = job.get("changes") or []
    return result


def render_text(in_path, out_path):
    """Render an already-parsed ``.txt`` as ``.docx`` (no re-parsing)."""
    source = Path(in_path)
    if not source.is_file():
        raise ManagerError(f"Input not found: {source}")
    if Path(out_path).suffix.lower() != ".docx":
        raise ManagerError("render_text writes .docx only")
    text = source.read_text(encoding="utf-8")
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    try:
        written_path = render.write_docx_plain(str(out_path), text)
    except (OSError, ValueError, RuntimeError) as exc:
        raise ManagerError(f"could not write {out_path}: {exc}") from exc
    return {"file": written_path, "from": "txt", "to": "docx",
            "pages": text.count("\n\n") + 1 if text else 0,
            "counts": {}, "metadata": {}, "text": text}
