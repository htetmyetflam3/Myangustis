"""Regional-run protection, mirrored from ``@rule/unicode-evidence.js``.

Valid regional Unicode Myanmar runs (Mon and extension signs) occupy code
points that Zawgyi fonts used for other glyphs. Burmese-only cleanup and
ordering must never rewrite them, so the whole run is left intact --
including contextual marks and joiners -- while unrelated spans still take
the caller's transform.
"""

from __future__ import annotations

import re

__all__ = ["REGIONAL", "MYANMAR_RUN", "preserve_regional_runs"]

REGIONAL = re.compile(r"[\u1033-\u1035\u1050-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]")
MYANMAR_RUN = re.compile(
    r"[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F\u200B-\u200D]+")


def preserve_regional_runs(text, transform):
    """Apply ``transform`` to ``text`` except inside regional Myanmar runs."""
    if not isinstance(text, str) or not REGIONAL.search(text):
        return transform(text)
    result = ""
    cursor = 0
    for match in MYANMAR_RUN.finditer(text):
        if not REGIONAL.search(match.group(0)):
            continue
        if match.start() > cursor:
            result += transform(text[cursor:match.start()])
        result += match.group(0)
        cursor = match.end()
    return result + transform(text[cursor:]) if cursor < len(text) else result
