"""The lane judgement module, mirrored from ``prised/@rule/judgement.js``.

The top-level decision maker. Its whole job is distinguishing Burmese from
English and turning evidence into lane decisions: ``judge_page_lines``
gathers the evidence for a page, and the LANE piece below selects from it.
It loads no JSON and keeps no mark tables -- the strict low-level token
walking lives in ``mm_score.py`` beside it (``score_text``,
``mark_order_aligned``), which this module asks for evidence. Nothing here
rewrites text. The TEXT KEEPING section at the bottom is inherited
plumbing from the deleted normalize.js; it judges nothing and selects
nothing.

The JS module's ``LATIN_LIKE`` pattern is dead there (no reader) and is
not ported: an unused regex is not behaviour.

Returned dicts keep the JS key names (``hasSpaces``, ``violationRate``,
``rawScore``...) so a diff against the JS module reads line for line;
internal Python callers may of course read them with ``[]``.
"""

from __future__ import annotations

import re

from myangustis_parser.normalize import mm_score
from myangustis_parser.normalize.detector import contains_myanmar
from myangustis_parser.resources.font_names import is_legacy_font_name, is_unicode_font, normalise_font_name

__all__ = [
    "ZAWCODE_MIN_SLOTS",
    "PAGE_NUMBER",
    "PDF_PARSING_PATHS",
    "UNICODE_LANE_DECISIONS",
    "english_likeness",
    "only_page_numbers",
    "only_non_body_header",
    "correct_world_word",
    "judge_page_lines",
    "select_page_decision",
    "instruction_lane",
    "is_unicode_lane_decision",
    "normalize_page_lines",
    "normalize_output_text",
]

PAGE_NUMBER = re.compile(
    r"^(?:[0-9]{1,4}|(?:page\s*[|:#-]?\s*[0-9]{1,4}\s*)+)$", re.IGNORECASE)

# The two parsing paths a page can be parsed on (method/decoder.js).
PDF_PARSING_PATHS = {"FONT_CMAP": "font-cmap", "LEGACY": "legacy"}

_WORDS = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_VOWEL = re.compile(r"[aeiou]", re.IGNORECASE)
_CASE_SEAM = re.compile(r"[a-z][A-Z]")
_TRIPLE = re.compile(r"([A-Za-z])\1\1")
_CONSONANT_RUN = re.compile(r"[^aeiou\s]{4,}", re.IGNORECASE)
_DATE_HEADER = re.compile(
    r"^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|"
    r"dec(?:ember)?)\s+\d{1,2},?\s+\d{4}[\s\W]*$", re.IGNORECASE)
_TYPED_HEADER = re.compile(
    r"^(?:typing|typed\s+by|scanned\s+by|transcribed\s+by|prepared\s+by|"
    r"uploaded\s+by)\s*[-:|]\s*[a-z0-9_.-]{1,40}(?:\s+\d{1,4})*[\s\W]*$",
    re.IGNORECASE)
_ADDRESS = re.compile(
    r"\b(?:https?://)?(?:www\.)?(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,24}(?:/[^()]*)?",
    re.IGNORECASE)
_CAPITAL_WORD = re.compile(r"^[A-Z][a-z]{1,15}$")


def english_likeness(text) -> dict:
    """One-sided English check over Latin text.

    It can confirm that text reads as English, and it can flag Latin layout
    junk (legacy keyboard bytes read as Latin), but with too little evidence
    it abstains (``verdict: None``). A "violation" is a word English does not
    produce: no vowel in a word of 3+ letters, a lower->Upper case seam inside
    a word, or a 3+ repeated letter. Real English prose violates rarely;
    WinInnwa byte junk violates constantly.
    """
    sample = str(text if text is not None else "")
    words = _WORDS.findall(sample)
    letters = sum(len(word.replace("'", "")) for word in words)
    has_spaces = bool(re.search(r"\s", sample.strip()))
    base = {"score": 0, "letters": letters, "runs": len(words),
            "hasSpaces": has_spaces, "violationRate": 0}
    if letters < 8 or not words:
        return {"verdict": None, **base}
    violations = 0
    for word in words:
        plain = word.replace("'", "")
        if len(plain) >= 3 and not _VOWEL.search(plain):
            violations += 1
        elif _CASE_SEAM.search(plain):
            violations += 1
        elif _TRIPLE.search(plain):
            violations += 1
        elif _CONSONANT_RUN.search(plain):
            violations += 1
    violation_rate = violations / len(words)
    score = 1 - violation_rate
    # English body text is spaced words. One unbroken Latin run -- however
    # dictionary-like -- is not body text and must not confirm English.
    if not has_spaces:
        return {"verdict": "not-english", "score": score, "letters": letters,
                "runs": len(words), "hasSpaces": has_spaces,
                "violationRate": violation_rate}
    # Two short words are not enough evidence either way.
    if len(words) < 3:
        return {"verdict": None, "score": score, "letters": letters,
                "runs": len(words), "hasSpaces": has_spaces,
                "violationRate": violation_rate}
    verdict = "english" if violation_rate <= 0.34 else "not-english"
    return {"verdict": verdict, "score": score, "letters": letters,
            "runs": len(words), "hasSpaces": has_spaces,
            "violationRate": violation_rate}


def only_page_numbers(text) -> bool:
    lines = [line.strip() for line in re.split(r"[\r\n]+", str(text))
             if line.strip()]
    return bool(lines) and all(PAGE_NUMBER.match(line) for line in lines)


def only_non_body_header(text) -> bool:
    """True when the page carries only a date, credit line or bare address."""
    compact = re.sub(r"\s+", " ", str(text)).strip()
    if _DATE_HEADER.match(compact):
        return True
    if _TYPED_HEADER.match(compact):
        return True
    found = []

    def _drop(match):
        found.append(match.group(0))
        return " "

    rest = _ADDRESS.sub(_drop, compact)
    if not found or any(ord(char) > 0x7F for char in rest) or re.search(r"[/\\]|\d{5}", rest):
        return False
    words = [word for word in re.findall(r"[a-z]+", rest, re.IGNORECASE)
             if len(word) > 1 and word.lower() != "page"]
    return not words or (len(words) <= 2 and all(
        _CAPITAL_WORD.match(word) and _VOWEL.search(word) for word in words))


def correct_world_word(text, zawgyi_evidence=False):
    """The ``ကမ္ဘာ`` (world) spelling restored only on Zawgyi evidence."""
    if not zawgyi_evidence:
        return text
    return re.sub(r"\u1000(?:\u101a\u103c\u103c|\u101a\u103c)", "\u1000\u101a\u103c", text)


# ===========================================================================
# PIECE 3 - DECISION
# The one who calls the judgement functions to answer for a whole page. It
# walks the page's lines once, asks the mm-score walker about the raw reading
# and about the ZawCode-swapped candidate, and returns the evidence pack. It
# selects nothing itself -- that is PIECE 4's job.
# ===========================================================================

def judge_page_lines(lines, swap_candidate) -> dict:
    """Mm-score evidence over the output as emitted, and after the slot swap.

    ``lines`` is an iterable of line strings. ``swap_candidate`` is handed in
    by the caller (the finisher owns the ZawCode order function); this module
    never imports it.
    """
    original_has_text = False
    has_myanmar = False
    aligned = True
    candidate_changed = False
    candidate_aligned = True
    candidate_slots = 0
    count = 0
    raw_score_total = 0.0
    raw_marks = 0
    candidate_score_total = 0.0
    candidate_marks = 0
    for text in lines:
        count += 1
        inspected = str(text if text is not None else "")
        original_has_text = original_has_text or bool(inspected.strip())
        has_myanmar = has_myanmar or contains_myanmar(inspected)
        aligned = aligned and mm_score.mark_order_aligned(inspected)
        candidate = swap_candidate(inspected)
        candidate_changed = candidate_changed or candidate != inspected
        if candidate != inspected:
            # Slots the swapping rule touched on this line, counted as the
            # character positions it rearranged (one slot touches at most
            # five). The ZawCode call needs more than one slot -- see
            # ZAWCODE_MIN_SLOTS below.
            before = list(inspected)
            after = list(candidate)
            for i in range(max(len(before), len(after))):
                if (before[i] if i < len(before) else None) != \
                        (after[i] if i < len(after) else None):
                    candidate_slots += 1
        candidate_aligned = candidate_aligned and mm_score.mark_order_aligned(candidate)
        if inspected:
            # Mm-score judges the readings exactly as emitted -- no reordering
            # first, or a crossed page would score as if already fixed.
            raw_reading = mm_score.score_text(inspected)
            raw_score_total += raw_reading["score"] * raw_reading["marks"]
            raw_marks += raw_reading["marks"]
            candidate_reading = mm_score.score_text(candidate)
            candidate_score_total += candidate_reading["score"] * candidate_reading["marks"]
            candidate_marks += candidate_reading["marks"]
    return {
        "originalHasText": original_has_text,
        "hasMyanmar": has_myanmar,
        "aligned": aligned,
        "candidateChanged": candidate_changed,
        "candidateAligned": candidate_aligned,
        "candidateSlots": candidate_slots,
        "count": count,
        "rawScore": raw_score_total / raw_marks if raw_marks else 0,
        "candidateScore": candidate_score_total / candidate_marks if candidate_marks else 0,
    }


# ===========================================================================
# PIECE 4 - LANE
# The ones who actually select the lane, from the judgement. Given the
# evidence pack from PIECE 3 (or the font evidence off the instructions),
# these pick; they do not judge text themselves.
# ===========================================================================

# One swapped slot is not enough for the ZawCode call: Zawgyi shares some of
# the same characters, so a single slot can collide with a Zawgyi (or stray)
# reading. The call needs more than one slot's worth of matches on the page
# (one slot touches at most five character positions).
ZAWCODE_MIN_SLOTS = 6


def select_page_decision(judgment, parsing_path, zawgyi_codepage=False) -> str:
    """The lane call: ``legacy`` / ``zawcode`` / ``rabbit`` / ``aligned``.

    1. ZawCode: the swapping rule is offered as a candidate in BOTH lanes, and
       matching more than one slot (``ZAWCODE_MIN_SLOTS``) is the ZawCode
       call. Never offered on a Zawgyi codepage page.
    2. Mark order violated -> Rabbit. The mark-order rule alone makes this
       call; no score margin second-guesses it.
    3. Neither -> aligned (nothing but the Normalize behind every finish).
    """
    if not judgment["hasMyanmar"]:
        return "legacy" if parsing_path == PDF_PARSING_PATHS["LEGACY"] else "aligned"
    if not zawgyi_codepage and judgment["candidateSlots"] >= ZAWCODE_MIN_SLOTS:
        return "zawcode"
    if parsing_path == PDF_PARSING_PATHS["LEGACY"]:
        return "legacy"
    if not judgment["aligned"]:
        return "rabbit"
    return "aligned"


def _font_field(font, *names):
    for name in names:
        if isinstance(font, dict):
            if name in font:
                return font[name]
        else:
            value = getattr(font, name, None)
            if value is not None:
                return value
    return None


def instruction_lane(page_instruction, source_encoding) -> dict:
    """Lane decision from the outside-stream instructions alone.

    A page takes the legacy lane iff one of its fonts is a registered legacy
    face (``is_legacy_font_name`` -- the curated registry, not the layout
    prefix guess, which would also bless the modern Unicode font named
    "Ayar") and that face plausibly carries the page's text. Inside the
    legacy lane a font whose own map marks it Unicode or Zawgyi is still read
    through that map, not the codepage.

    Guards: a CID Unicode face (Type0 + isUnicodeFont) means the page's
    Burmese is Unicode-typeset even when a legacy-named resource is also
    declared; and a two/three-letter base name is not evidence.
    """
    if source_encoding in ("unicode", "zawgyi-one"):
        return {"parser": PDF_PARSING_PATHS["FONT_CMAP"], "reason": "source-encoding"}
    fonts = (page_instruction or {}).get("fonts") or []
    cid_unicode = any(
        _font_field(font, "subtype") == "Type0"
        and (is_unicode_font(_font_field(font, "baseFont", "base_font"))
             or re.match(r"^myanmar[0-9]",
                         normalise_font_name(_font_field(font, "baseFont", "base_font"))))
        for font in fonts)
    if cid_unicode:
        return {"parser": PDF_PARSING_PATHS["FONT_CMAP"], "reason": "unicode-font"}
    # A CID-keyed Zawgyi face is the modern Zawgyi toolchain: the page is read
    # through its own maps even when a legacy-named resource is present.
    if any(_font_field(font, "subtype") == "Type0"
           and normalise_font_name(_font_field(font, "baseFont", "base_font")).startswith("zawgyi")
           for font in fonts):
        return {"parser": PDF_PARSING_PATHS["FONT_CMAP"], "reason": "cid-zawgyi-font"}
    legacy_fonts = [font for font in fonts
                    if len(normalise_font_name(_font_field(font, "baseFont", "base_font"))) >= 4
                    and is_legacy_font_name(_font_field(font, "baseFont", "base_font"))]
    # A legacy-named font that ships no ToUnicode while a mapped font on the
    # page does is not the page's text carrier (it typesets headers/Latin);
    # the legacy reading only applies when the legacy font carries its own
    # map, or no mapped non-Zawgyi font is present. A mapped Zawgyi companion
    # does not count: legacy books mix both.
    legacy_applies = any(_font_field(font, "toUnicode", "to_unicode") for font in legacy_fonts) \
        or not any(_font_field(font, "toUnicode", "to_unicode")
                   and not normalise_font_name(
                       _font_field(font, "baseFont", "base_font")).startswith("zawgyi")
                   for font in fonts)
    if legacy_fonts and legacy_applies:
        return {
            "parser": PDF_PARSING_PATHS["LEGACY"],
            "reason": "legacy-font",
            "fonts": [_font_field(font, "baseFont", "base_font") for font in legacy_fonts],
        }
    return {
        "parser": PDF_PARSING_PATHS["FONT_CMAP"],
        "reason": "no-legacy-evidence" if fonts else "no-fonts",
    }


# The Unicode-lane decisions, for consumers eligibility checks (the PDF
# stream's beautify gate asks this instead of keeping its own copy).
UNICODE_LANE_DECISIONS = frozenset(("aligned", "zawcode", "unaligned-unicode"))


def is_unicode_lane_decision(decision, category=None) -> bool:
    return decision in UNICODE_LANE_DECISIONS or category == "UNICODE"


# ===========================================================================
# TEXT KEEPING (not lane machinery)
# Inherited from the deleted normalize.js: the line-by-line Engine-normalize
# plumbing. It judges nothing and selects nothing. There is no
# protected/preserved character set: characters the chain does not itself
# handle flow through transforms naturally.
# ===========================================================================

def normalize_page_lines(text, normalize):
    """Yield ``normalize(line)`` per line, keeping the trailing empty line."""
    if not callable(normalize):
        raise TypeError("Expected Engine normalize function")
    source = str(text if text is not None else "")
    start = 0
    while True:
        end = source.find("\n", start)
        if end < 0:
            yield normalize(source[start:])
            return
        yield normalize(source[start:end])
        start = end + 1


def normalize_output_text(text, normalize) -> str:
    return "\n".join(normalize_page_lines(text, normalize))
