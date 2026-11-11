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

import ocr
import math
import limits
import pipeline
import render
from docx_extract import strip_image_markers

__all__ = [
    "ManagerError",
    "dispatch_path",
    "dispatch_bytes",
    "dispatch_stream",
    "render_text",
    "mute_advisories",
    "conversion_lanes",
    "ocr_image_job",
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


def _page_cap() -> int:
    """Public page cap from the environment (``0`` means no cap).

    The cap is this parser's own policy knob, read by this process. The
    trusted in-process stream path (``caller="local"``) is not subject to it,
    which is why the cap is applied here rather than inside the pipeline.
    """
    raw = (os.environ.get("PRASER_MAX_PAGES") or "").strip()
    policy = 0
    if raw:
        try:
            value = int(raw)
        except ValueError:
            value = 0
        policy = value if value > 0 else 0
    # limit.js's own resource cap always applies; the policy knob above can
    # only tighten it (an owner worker is uncapped there, so it never wins).
    resource = limits.MAX_PAGES
    if math.isinf(resource):
        return policy
    return min(policy, resource) if policy else int(resource)


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
    text = ocr.ocr_image(data, suffix=Path(name).suffix or ".png")
    log(f"[+] {name}: OCR text ({len(text):,} characters)")
    return {
        "filename": name, "kind": "ocr",
        "reports": [{"page": 1, "category": "UNKNOWN", "prob": 0.0,
                     "base": text, "clean": text}],
        "counts": {"UNKNOWN": 1}, "metadata": {}, "changes": [],
        "pages": [{"text": text}],
    }


def _ocr_pdf_image_pages(job, data, log):
    """OCR image-only PDF pages; returns the 1-based page numbers that worked.

    A page qualifies exactly as in the JS branch: it carries an image and has
    fewer than 8 characters of extractable text. Nothing else is touched, and
    a failure leaves the page as it was.
    """
    pages = job.get("pages") or []
    targets = [i for i, page in enumerate(pages)
               if page.get("has_img") and len(str(page.get("text") or "").strip()) < 8]
    if not targets:
        return []
    if not _ocr_enabled():
        log("[i] OCR disabled (PRASER_OCR=off); image-only pages left empty")
        return []
    if not ocr.available():
        log(f"[i] {ocr.describe()}; image-only pages left empty")
        return []
    limit = ocr.page_limit()
    if len(targets) > limit:
        raise ManagerError(
            f"Scanned PDF has {len(targets)} image-only pages; OCR accepts at "
            f"most {limit} at a time. Split the file and submit it in parts.")

    from decrypt import (decrypt_pdf, expand_object_streams, has_object_streams,
                         is_encrypted_pdf)
    import pdf_extract

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
        if text and text.strip():
            pages[index]["text"] = text
            report = job["reports"][index]
            report["base"] = text
            if report.get("clean") is not None:
                report["clean"] = text
            done.append(index + 1)
            log(f"    Page {index + 1}: OCR supplied the text (image-only page)")
    if done:
        job["changes"] = pipeline.collect_changes(job["reports"])
    return done


def _replace_markers(job, replacements, log):
    """Swap OCR placeholders in page and report text; drop the leftovers."""
    def swap(value):
        if not isinstance(value, str):
            return value
        for marker, text in replacements.items():
            value = value.replace(marker, text)
        return strip_image_markers(value)

    for page in job.get("pages") or []:
        page["text"] = swap(page.get("text"))
    for report in job.get("reports") or []:
        report["base"] = swap(report.get("base"))
        report["clean"] = swap(report.get("clean"))
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
    for item in files:
        try:
            data = Path(item["path"]).read_bytes()
            text = ocr.ocr_image(data, suffix=Path(item["path"]).suffix)
            replacements[item["marker"]] = (text or "").strip()
            if replacements[item["marker"]]:
                log(f"    DOCX image {item['id']}: OCR supplied the text")
        except Exception as exc:  # noqa: BLE001 - OCR never fails the parse
            log(f"    DOCX image {item['id']}: OCR skipped ({exc})")
    _replace_markers(job, replacements, log)
    return [item["id"] for item in files]


def _convert(data, filename, out_path, *, kind, method=None, apply_cleanup=True,
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
    if kind == "docx" and out_format != "txt":
        raise ManagerError("DOCX input carries no page layout; write .txt only")
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

    if len(data) > limits.MAX_INPUT_BYTES:
        raise ManagerError(
            f"Parser input exceeds the {limits.MAX_INPUT_MB:g} MB cap")
    log(f"[+] {name}: {len(data):,} bytes -> .{out_format}")
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
                data, _detector(), filename=name, log=log, image_dir=image_dir)
            ocr_pages = _ocr_docx_images(job, log)
        else:
            job = pipeline.process_bytes(
                data, kind, _detector(), filename=name, log=log,
                text_layout=text_layout)
            ocr_pages = _ocr_pdf_image_pages(job, data, log)
    except ManagerError:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        raise ManagerError(f"{name}: {exc}") from exc
    finally:
        if image_dir is not None:
            shutil.rmtree(image_dir, ignore_errors=True)

    page_count = len(job.get("reports") or [])
    cap = 0 if caller == "local" else _page_cap()
    if cap and page_count > cap:
        raise ManagerError(
            f"{page_count}-page input exceeds the public {cap} page cap; "
            "the in-process local stream path is exempt by design")

    # ``process_bytes`` always returns the raw per-page frame plus the cleanup
    # candidate. Whether cleanup is applied is the caller's decision, taken
    # here exactly once, at write time.
    pages = pipeline.build_final_pages(job, bool(apply_cleanup))
    counts = job.get("counts") or {}
    try:
        pipeline.render_texts(str(out_path), pages, counts, name)
    except (OSError, ValueError, RuntimeError) as exc:
        raise ManagerError(f"could not write {out_path}: {exc}") from exc

    result = {
        "file": str(Path(out_path)),
        "from": kind,
        "to": out_format,
        "filename": name,
        "method": method,
        "caller": caller,
        "parserRuntime": "python",
        "pages": page_count,
        "counts": counts,
        "metadata": job.get("metadata") or {},
        "applyCleanup": bool(apply_cleanup),
        # 1-based PDF pages (or DOCX image ids) whose text came from OCR.
        "ocrPages": ocr_pages,
    }
    if include_text:
        result["text"] = pipeline.build_content(job, bool(apply_cleanup), kind)
    if include_preview:
        result["changes"] = job.get("changes") or []
    if job.get("encoding_path"):
        result["encodingPath"] = job["encoding_path"]
    return result


def dispatch_path(in_path, out_path, *, kind=None, filename=None, method=None,
                  apply_cleanup=True, include_text=True, include_preview=False,
                  source_encoding="auto", caller="site", text_layout=None,
                  log=None):
    """Convert one file, by this parser's own pipeline."""
    source = Path(in_path)
    if not source.is_file():
        raise ManagerError(f"Input not found: {source}")
    return _convert(source.read_bytes(), filename or source.name, out_path,
                    kind=kind, method=method, apply_cleanup=apply_cleanup,
                    include_text=include_text, include_preview=include_preview,
                    source_encoding=source_encoding, caller=caller,
                    text_layout=text_layout, log=log)


def dispatch_bytes(data, filename, out_path, *, kind, method=None,
                   apply_cleanup=True, include_text=True, include_preview=False,
                   source_encoding="auto", caller="site", text_layout=None,
                   log=None):
    """Convert in-memory bytes (the API upload path)."""
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError("data must be bytes")
    return _convert(data, filename, out_path, kind=kind, method=method,
                    apply_cleanup=apply_cleanup, include_text=include_text,
                    include_preview=include_preview,
                    source_encoding=source_encoding, caller=caller,
                    text_layout=text_layout, log=log)


def dispatch_stream(source, out_path, *, filename, kind=None, method=None,
                    apply_cleanup=True, include_text=False, include_preview=False,
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
                          kind=kind, method=method, apply_cleanup=apply_cleanup,
                          include_text=include_text,
                          include_preview=include_preview,
                          source_encoding=source_encoding, caller=caller, log=log)


def render_text(in_path, out_path):
    """Render an already-parsed ``.txt`` as ``.docx`` (no re-parsing)."""
    source = Path(in_path)
    if not source.is_file():
        raise ManagerError(f"Input not found: {source}")
    if Path(out_path).suffix.lower() != ".docx":
        raise ManagerError("render_text writes .docx only")
    text = source.read_text(encoding="utf-8")
    try:
        render.write_docx_plain(str(out_path), text)
    except (OSError, ValueError, RuntimeError) as exc:
        raise ManagerError(f"could not write {out_path}: {exc}") from exc
    return {"file": str(Path(out_path)), "from": "txt", "to": "docx",
            "pages": text.count("\n\n") + 1 if text else 0,
            "counts": {}, "metadata": {}, "text": text}
