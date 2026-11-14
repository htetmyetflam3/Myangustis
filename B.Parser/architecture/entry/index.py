"""The public front door of the **Python** parser.

Mirror of ``B.Parser/index.js`` for this language. Wiring only — no parsing
logic lives here. The JavaScript front door and this one are peers:

    # JavaScript                        # Python
    import { convert } from "./index.js"  from index import convert
    await convert("in.pdf", "out.docx")   convert("in.pdf", "out.docx")

The three stages are exposed separately for callers that want to parse many
files and write later:

    parse_decoding   prepared input -> per-page text + layout (stage 2)
    write_output_file page texts     -> .txt / .docx / .pdf  (stage 3)

Stage 1 (``InitInput`` in JavaScript) is the temp-file/validation step; in
Python :func:`convert` accepts a path or ``bytes`` and does it inline.

Nothing here imports or executes JavaScript. The only share with the JS
parser is data: ``@jason-map/*.json`` (see :mod:`maps`) and the optional
JSON job contract (:mod:`interop`).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from myangustis_parser.workflow import pipeline
from myangustis_parser.entry.manager import (ManagerError, dispatch_bytes, dispatch_ocr,
                                             dispatch_path, ocr_pdf_job, prepare_job,
                                             render_text)

_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".tif", ".tiff",
                   ".webp", ".gif", ".bmp")

__all__ = [
    "convert",
    "dispatch_ocr",
    "ocr_pdf_job",
    "parse_decoding",
    "write_output_file",
    "ManagerError",
    "render_text",
]


def convert(source, out_path, *, kind=None, filename=None, method=None,
            include_text=False, source_encoding="auto",
            text_layout=None, log=None):
    """Convert one document through Python's parser and writer.

    ``source`` is a path or raw ``bytes``. Returns the result dict documented
    in :mod:`manager` (``file``, ``from``, ``to``, ``pages``, ``counts``,
    ``ocrPages``...). An image path (``.png``/``.jpg``/``.tif``/``.webp``...)
    is the OCR lane: one page of recognised text.
    """
    if isinstance(source, (bytes, bytearray, memoryview)):
        name = filename or ("input.pdf" if kind in (None, "pdf") else "input.docx")
        return dispatch_bytes(source, name, out_path, kind=kind, method=method,
                              include_text=include_text,
                              source_encoding=source_encoding,
                              text_layout=text_layout, log=log)
    path = Path(source)
    if not path.is_file():
        raise ManagerError(f"Input not found: {path}")
    return dispatch_path(path, out_path, kind=kind, filename=filename,
                         method=method, include_text=include_text,
                         source_encoding=source_encoding,
                         text_layout=text_layout, log=log)


def parse_decoding(source, *, kind=None, filename=None,
                   source_encoding="auto", text_layout=None, log=None):
    """Stage 2: input -> ``{"pages": [...], "counts": {...}, ...}``.

    Each page carries ``text`` and, for PDF input, the exact layout
    (``lines``/``wh``/``has_img``) the DOCX writer reproduces. The returned
    dict can be handed to :func:`write_output_file` later or elsewhere.
    """
    if isinstance(source, (bytes, bytearray, memoryview)):
        data = bytes(source)
        name = filename or "input.pdf"
    else:
        path = Path(source)
        if not path.is_file():
            raise ManagerError(f"Input not found: {path}")
        data = path.read_bytes()
        name = filename or path.name
    lowered = name.lower()
    kind = kind or ("docx" if lowered.endswith((".docx", ".doc"))
                    else "ocr" if lowered.endswith(_IMAGE_SUFFIXES) else "pdf")
    job = prepare_job(data, os.path.basename(name), kind=kind,
                      source_encoding=source_encoding, text_layout=text_layout, log=log)
    job["sourceEncoding"] = source_encoding
    return job


def write_output_file(out_path, job):
    """Stage 3: write a parsed job to ``.txt`` / ``.docx`` / ``.pdf``.

    Never re-opens the source document and never re-runs detection, so the
    same parse can be written several times without paying for the parse again.
    """
    pages = pipeline.build_final_pages(job, True)
    written, job["posScan"] = pipeline.render_and_scan(
        out_path, pages, job.get("counts") or {}, job.get("filename") or "")
    return written
