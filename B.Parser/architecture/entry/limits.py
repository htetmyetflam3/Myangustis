"""Safety limits for image and archive decoding, shared by all callers.

There are no caller tiers or input, page, or extracted-text quotas. These
remaining limits protect against decompression bombs and oversized images.
"""
import os


def positive_limit(name, fallback, maximum):
    raw = os.environ.get(name, str(fallback))
    if not raw.isdigit() or not 1 <= int(raw) <= maximum:
        raise ValueError(f"{name} must be a positive integer between 1 and {maximum}")
    return int(raw)


MAX_OCR_PIXELS = positive_limit("LOCAL_MAX_OCR_PIXELS", 25_000_000, 200_000_000)
MAX_DOCX_ENTRIES = positive_limit("PRASER_MAX_DOCX_ENTRIES", 4096, 20000)
MAX_DOCX_MEMBER_MB = positive_limit("PRASER_MAX_MEMBER_MB", 64, 256)
MAX_DOCX_TOTAL_MB = positive_limit("PRASER_MAX_DOCX_TOTAL_MB", 128, 512)
MAX_DOCX_RATIO = 200
