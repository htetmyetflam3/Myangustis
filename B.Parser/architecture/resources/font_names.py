"""The legacy font-name registry, mirrored from JS.

``prised/@core/pdf/method/legacy/codepage-names.js`` holds the curated sets of
known legacy faces, split by family, and answers: is this font name a
registered legacy face, which family does it belong to, and what layout does
that family parse with. ``prised/@rule/detect.js`` holds the small set of
modern Unicode faces. Name evidence only -- it converts no bytes.

The sets themselves are **data**, shared by both parsers through
``@jason-map/legacy-font-names.json`` (generated from the two JS sets, kept in
sync by that one file). The rules stay here, exactly as the JS module writes
them.
"""

from __future__ import annotations

import re
from functools import lru_cache

from myangustis_parser.resources import maps

__all__ = [
    "WININNWA_FONT_NAMES",
    "AYAR_FONT_NAMES",
    "LEGACY_FONT_NAMES",
    "UNICODE_FACES",
    "normalise_font_name",
    "is_unresolved_legacy_font",
    "is_legacy_font_name",
    "legacy_font_family",
    "legacy_layout_for_font",
    "is_unicode_font",
    "has_only_unicode_fonts",
]

# The two legacy code pages the name gate chooses between. The codepage
# registry itself (the byte tables) stays in pdf_fonts.LEGACY_CODE_PAGES.
AYAR_LEGACY_CODE_PAGE = "ayar"
WININNWA_LEGACY_CODE_PAGE = "wininnwa"

_HEX_ESCAPE = re.compile(r"#([0-9A-Fa-f]{2})")
_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")
_NON_ALNUM = re.compile(r"[^a-z0-9]")


@lru_cache(maxsize=1)
def _registry() -> dict:
    return maps.load_map("legacy-font-names.json")


@lru_cache(maxsize=1)
def _sets() -> tuple:
    data = _registry()
    return (frozenset(data.get("wininnwa") or ()),
            frozenset(data.get("ayar") or ()),
            frozenset(data.get("unicode") or ()))


WININNWA_FONT_NAMES, AYAR_FONT_NAMES, UNICODE_FACES = _sets()
LEGACY_FONT_NAMES = WININNWA_FONT_NAMES | AYAR_FONT_NAMES


def normalise_font_name(base_font) -> str:
    """Hex escapes expanded, subset prefix dropped, lowercased, alnum only."""
    text = str(base_font or "")
    text = _HEX_ESCAPE.sub(lambda m: chr(int(m.group(1), 16)), text)
    text = _SUBSET_PREFIX.sub("", text)
    return _NON_ALNUM.sub("", text.lower())


def is_unresolved_legacy_font(base_font) -> bool:
    """Legacy-looking faces no registered decoder verifies."""
    name = normalise_font_name(base_font)
    return (name.startswith("wwin") or name.startswith("msheavy")
            or name.startswith("msmoom"))


def _matches(set_, name: str) -> bool:
    if name in set_:
        return True
    for known in set_:
        if len(known) >= 6 and (name.startswith(known) or known.startswith(name)):
            return True
    return False


def is_legacy_font_name(base_font) -> bool:
    name = normalise_font_name(base_font)
    if not name:
        return False
    return _matches(LEGACY_FONT_NAMES, name)


def legacy_font_family(base_font):
    """``"wininnwa"``, ``"ayar"`` or ``None`` (the name says nothing)."""
    name = normalise_font_name(base_font)
    if not name:
        return None
    if name.startswith("wininnwa") or _matches(WININNWA_FONT_NAMES, name):
        return "wininnwa"
    if re.match(r"^(?:ayar|arlarwade|amyanmar)", name) or _matches(AYAR_FONT_NAMES, name):
        return "ayar"
    return None


def legacy_layout_for_font(base_font) -> dict:
    """Layout choice at the name gate; unknown faces stay on WinInnwa."""
    family = legacy_font_family(base_font)
    if family == "wininnwa":
        return {"layout": "wininnwa", "codePage": WININNWA_LEGACY_CODE_PAGE, "known": True}
    if family == "ayar":
        return {"layout": "ayar", "codePage": AYAR_LEGACY_CODE_PAGE, "known": True}
    return {"layout": "wininnwa", "codePage": WININNWA_LEGACY_CODE_PAGE, "known": False}


def is_unicode_font(name) -> bool:
    return normalise_font_name(name) in UNICODE_FACES


def has_only_unicode_fonts(font_names) -> bool:
    names = list(font_names or ())
    return bool(names) and all(is_unicode_font(name) for name in names)
