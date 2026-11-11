"""Input-stage caps, mirrored from ``@entry/helper/limit.js``.

The caps every stage in this tree lands by: how big an input may be, how
far a collector may write before it must stop. Env-tunable with hard
maximums.

Owner workers in the JS tree (``parserOwner`` stamped by the Manager) are
uncapped. Python has no worker threads: the parser runs in one process, so
"owner" is a property of the *call*, not the thread. The Manager stamps it
by setting ``PRASER_PARSER_OWNER=1`` in the environment of the process it
spawns, and ``owner_parser_worker()`` reads that -- the same meaning (the
owner already checked the input) without inventing an in-process flag that
the JS workerData equivalent does not have.

Names, fallbacks, maximums and error messages are byte-for-byte the JS
ones. ``positive_limit`` raises ``ValueError`` like the JS ``ValueError``.
"""

from __future__ import annotations

import math
import os

__all__ = [
    "OWNER_PARSER_WORKER",
    "MAX_INPUT_MB",
    "MAX_INPUT_BYTES",
    "MAX_PAGES",
    "MAX_OCR_PIXELS",
    "MAX_TEXT_CHARS",
    "MAX_DOCX_ENTRIES",
    "MAX_DOCX_MEMBER_MB",
    "MAX_DOCX_TOTAL_MB",
    "MAX_DOCX_RATIO",
    "positive_limit",
    "resource_limit",
    "limit_values",
]


def _is_truthy(value) -> bool:
    return str(value if value is not None else "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def owner_parser_worker() -> bool:
    """True when the Manager stamped this call as the owner's."""
    return _is_truthy(os.environ.get("PRASER_PARSER_OWNER"))


OWNER_PARSER_WORKER = owner_parser_worker()


def positive_limit(name: str, fallback: int, maximum: int) -> int:
    """Read one env cap, enforcing the same bounds as the JS module."""
    raw = os.environ.get(name)
    if raw is None:
        raw = str(fallback)
    raw = str(raw)
    if not raw.isdigit():
        raise ValueError(name + " must be a positive integer")
    value = int(raw)
    if value < 1 or value > maximum:
        raise ValueError(name + " must be between 1 and " + str(maximum))
    return value


def resource_limit(name: str, fallback: int, maximum: int) -> float:
    """A cap that the owner's own parse is exempt from."""
    return math.inf if OWNER_PARSER_WORKER else positive_limit(name, fallback, maximum)


MAX_INPUT_MB = resource_limit("LOCAL_UPLOAD_MAX_MB", 128, 4096)
MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024
MAX_PAGES = resource_limit("LOCAL_MAX_PAGES", 20_000, 1_000_000)
MAX_OCR_PIXELS = resource_limit("LOCAL_MAX_OCR_PIXELS", 25_000_000, 200_000_000)
MAX_TEXT_CHARS = resource_limit("LOCAL_MAX_TEXT_CHARS", 50_000_000, 2_000_000_000)
MAX_DOCX_ENTRIES = resource_limit("PRASER_MAX_DOCX_ENTRIES", 4096, 20000)
MAX_DOCX_MEMBER_MB = resource_limit("PRASER_MAX_MEMBER_MB", 64, 256)
MAX_DOCX_TOTAL_MB = resource_limit("PRASER_MAX_DOCX_TOTAL_MB", 128, 512)
MAX_DOCX_RATIO = math.inf if OWNER_PARSER_WORKER else 200


def limit_values() -> dict:
    """The module's caps as a plain dict (logs, reports, tests)."""
    return {
        "maxInputMb": MAX_INPUT_MB,
        "maxInputBytes": MAX_INPUT_BYTES,
        "maxPages": MAX_PAGES,
        "maxOcrPixels": MAX_OCR_PIXELS,
        "maxTextChars": MAX_TEXT_CHARS,
        "maxDocxEntries": MAX_DOCX_ENTRIES,
        "maxDocxMemberMb": MAX_DOCX_MEMBER_MB,
        "maxDocxTotalMb": MAX_DOCX_TOTAL_MB,
        "maxDocxRatio": MAX_DOCX_RATIO,
        "ownerParserWorker": OWNER_PARSER_WORKER,
    }
