"""Legacy ASCII layout residue: Latin letters standing in for Myanmar letters.

A legacy Myanmar face can be encoded in an ASCII layout (the Win Myanmar /
Myanmar1 family) where ``A`` is အ, ``U`` is ဥ, ``O`` is ဩ and ``E`` is ဧ.
When a PDF
subset carries such a face, its /ToUnicode table is *not* Unicode: it is a
faithful bridge back to the original font's slots. The bridge is correct, but
nothing in the file says which legacy layout the slots belong to, so the
slots arrive as Latin-1 characters and stay Latin all the way into the txt
output:

    Aနိမ့်Aမြင့်      should read  အနိမ့်အမြင့်
    AကျU်းAကျယ်      should read  အကျဥ်းအကျယ်
    Eကန်Eက           should read  ဧကန်ဧက

(Zawgyi-One subsets of ``part-5.pdf``, 85 pages, 400 ``A`` / 28 ``U`` / 7
``O`` / 2 ``E``.)  ``PDFDIAG`` names this ``legacy-ascii-residue``; the mapping below
converts the slots whose reading is *witnessed*. A slot that is not in the
table is left alone and reported, never guessed -- a wrong guess is worse
than a visible artifact, because a visible artifact can still be found by
grep.

The guard is what makes this safe to run on every page of every document:
a slot is only rewritten when it sits *in Myanmar context* and is not part of
a real Latin word, so English text, numbers and Latin labels survive. Only
``A``, ``U`` and ``E`` are proven, and each agrees with the repository's own
Ayar code page (``AYAR_LEGACY_CODE_PAGE``: 0x41, 0x55, 0x45) -- so the layout
family is identified, not guessed. ``O`` does NOT agree: the witnessed word is
``အံ့ဩ`` while Ayar maps 0x4F to ``ှု``, so O stays unrepaired and visible until
there is evidence for it. ``V`` is not in the table at all.
"""
from __future__ import annotations

import re

#: slot -> Myanmar text. Only witnessed readings; see the module docstring.
RESIDUE_SLOTS = {
    'A': '\u1021',   # အ
    'U': '\u1025',   # ဥ
    'E': '\u1027',   # ဧ
}

_LATIN_RUN = re.compile(r'[A-Za-z]+')

#: A Latin letter with Myanmar text on one side of it - the cheap test that
#: decides whether a page needs the layout read at all (one scan, no scoring).
_SLOT_NEAR_MMYANMAR = re.compile(
    r'[\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff][A-Za-z]'
    r'|[A-Za-z][\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff]')


def is_myanmar(char):
    """True for a Myanmar-script code point (letters, marks, digits)."""
    return bool(char) and ('\u1000' <= char <= '\u109f' or
                           '\uaa60' <= char <= '\uaa7f' or
                           '\ua9e0' <= char <= '\ua9ff')


def _contextual_runs(text):
    """Yield ``(start, run)`` for Latin runs that touch Myanmar text.

    A run with no Myanmar neighbour is real Latin (an English word, a page
    label, ``A4``) and is never a legacy slot.
    """
    for match in _LATIN_RUN.finditer(text):
        start, run = match.start(), match.group()
        before = text[start - 1] if start else ''
        after = text[match.end()] if match.end() < len(text) else ''
        if is_myanmar(before) or is_myanmar(after):
            yield start, run


#: The layouts share most slots and disagree on the rest, so the shared layout
#: is one path with a second reading where they differ. One path is the default
#: (Ayar, the wider of the two on the printed slot range); a line whose reading
#: through the other path scores better is the only thing that can override it.
def _code_pages():
    # Lazy: the registry lives in the extract layer, which imports this module.
    from myangustis_parser.extract.pdf_fonts import LEGACY_CODE_PAGES
    return LEGACY_CODE_PAGES['ayar'], LEGACY_CODE_PAGES['wininnwa']


def _apply_page(text, page):
    """Read a line's ASCII slots through one layout, Myanmar context only."""
    pieces, cursor, changed = [], 0, False
    for start, run in _contextual_runs(text):
        if len(run) != 1:
            continue                      # a Latin word is text, not a slot
        mapped = page.get(ord(run))
        if mapped is None or mapped == run:
            continue
        pieces.append(text[cursor:start])
        pieces.append(mapped)
        cursor = start + 1
        changed = True
    if not changed:
        return text
    pieces.append(text[cursor:])
    return ''.join(pieces)


def resolve(text):
    """Read a page's slots through the shared layout, deciding per page.

    Cost is bounded on purpose: lines with no slot next to Myanmar text are
    returned untouched after one regex scan, and the layout is chosen with two
    ``mm_score`` calls for the whole page - not two per line. ``mm_score`` is a
    character-level measure, so it runs here, before the finish chain; it is
    evidence only, so a page keeps the default path unless the alternative
    reading of that same page measurably reads better.
    """
    if _SLOT_NEAR_MMYANMAR.search(text) is None:
        return text                       # nothing to read: no work at all
    from myangustis_parser.normalize import mm_score
    default, alternative = _code_pages()
    preferred, other = [], []
    for line in text.split('\n'):
        if _SLOT_NEAR_MMYANMAR.search(line) is None:
            preferred.append(line)
            other.append(line)
            continue
        preferred.append(_apply_page(line, default))
        other.append(_apply_page(line, alternative))
    preferred_text, other_text = '\n'.join(preferred), '\n'.join(other)
    if other_text != preferred_text and mm_score.score_text(other_text)['score'] > mm_score.score_text(preferred_text)['score']:
        return other_text
    return preferred_text


def scan(text):
    """Count every Latin letter sitting in Myanmar context, by letter.

    This is the diagnostic view: it reports the residue whether or not the
    slot is in :data:`RESIDUE_SLOTS`, so an unknown layout is still visible
    in the log instead of silently vanishing.
    """
    counts = {}
    for _start, run in _contextual_runs(text):
        for char in run:
            counts[char] = counts.get(char, 0) + 1
    return counts


def map_residue(text):
    """Return ``(text, counts)`` with proven legacy slots converted.

    ``counts`` holds only what was actually converted, keyed by the original
    Latin letter. Unproven letters are left in place (see :func:`scan`).
    """
    counts = {}
    pieces, cursor = [], 0
    for start, run in _contextual_runs(text):
        if any(char not in RESIDUE_SLOTS for char in run):
            continue                      # a real Latin word: leave it intact
        pieces.append(text[cursor:start])
        pieces.append(''.join(RESIDUE_SLOTS[char] for char in run))
        cursor = start + len(run)
        for char in run:
            counts[char] = counts.get(char, 0) + 1
    if not counts:
        return text, {}
    pieces.append(text[cursor:])
    return ''.join(pieces), counts
