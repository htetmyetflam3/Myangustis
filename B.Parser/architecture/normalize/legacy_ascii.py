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
    Aံ့Oချီးကျူး       should read  အံ့ဩချီးကျူး
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
``A``, ``U``, ``O`` and ``E`` are proven, so only they are mapped; ``V`` and
the rest of the layout stay visible as evidence until witnessed.
"""
from __future__ import annotations

import re

#: slot -> Myanmar text. Only witnessed readings; see the module docstring.
RESIDUE_SLOTS = {
    'A': '\u1021',   # အ
    'U': '\u1025',   # ဥ
    'O': '\u1029',   # ဩ
    'E': '\u1027',   # ဧ
}

_LATIN_RUN = re.compile(r'[A-Za-z]+')


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
