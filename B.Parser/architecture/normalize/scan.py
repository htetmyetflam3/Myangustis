"""Scan decoded text for the damage a score cannot see.

Every defect found in the Ayar code page during this work was found the same
way, and never by the quality score: a wrong byte usually produces perfectly
legal Myanmar, so ``score_text`` stays flat while the words are nonsense. What
does move is *structure* -- a mark with no base, a pair Burmese cannot write,
a syllable printed three times.

The rules below are exactly the ones that caught real bugs:

``orphan``      a dependent mark with no base in front of it. This is the
                strongest signal in the set. It is what exposed ``0x4F``,
                which was decoding ``ှု`` as a comma: the comma is legal text,
                so nothing else complained, but it left the ``ိ`` of
                ``နှိုင်း`` with nothing to attach to. 210 ``မှု`` and 70
                ``ရှု`` were hiding behind that one byte.
``impossible``  pairs that cannot occur in one syllable. ``ံ``+``်`` exposed
                ``0x2E`` (anusvara written where dot-below belongs, 9,465
                occurrences) and later ``0x52``. ``ဲ``+``ာ`` exposed the
                ``0x58``/``0xB4`` swap -- ``သဲား`` for ``သွား``.
``stray``       a token made only of marks: the faux-bold shadow copies are
                collapsed and their marks survive alone.
``repeat``      the same syllable printed two or three times in a row
                (``ဆေးတစ်ဖုံ်ဖုံ်ဖုံ``) -- the same shadow-collapse artefact.
``digit``       a digit with Myanmar letters on both sides: ``၀``/``ဝ`` share
                a glyph, and a number does not sit inside a word.
``virama``      ``U+1039`` with nothing stacked after it.

Report the CLUSTER, never the bare character. A lone ``ိ`` tells you nothing;
``ိင်းယှဥ်ပြ`` tells you the word is ``နှိုင်းယှဉ်ပြ`` and that two code points
are missing in front of it.

    python3 modules/scan.py parsed.txt -o parsed.scan.txt
"""

import re
import sys
import argparse
import collections

from myangustis_parser.normalize.mm_score import is_mark
from myangustis_parser.resources import maps

__all__ = ["scan_text", "format_report", "impossible_hits", "RULES"]

# Token boundary: whitespace and the punctuation that cannot sit inside a word.
_SPLIT = re.compile(r'[\s\u104a\u104b()\[\]"\u2018\u2019\u201c\u201d,\.:;?!/=+_\u2014-]+')

_MYANMAR = lambda c: '\u1000' <= c <= '\u109f'          # noqa: E731
_DIGIT = lambda c: '\u1040' <= c <= '\u1049'            # noqa: E731
#: The scanner's whole vocabulary is one bundled map. ``damage-rules.json`` is
#: the file ``burmese-inventory.json`` was generated from -- its own header says
#: ``"marks": "map/mm-score.json marks + map/scan.json strayMarks"`` and
#: ``"consonants": "map/scan.json base + extraBases"``, quoted verbatim from the
#: map, which is why the file on disk kept the older name for as long as it did.
#: The lists are read from the map instead of restated here: a second copy of a
#: table is a second opinion, and the two were already drifting -- the module
#: held seven impossible pairs against the map's seven with nothing checking
#: that the pair agreed.
_SCAN = maps.load_map('damage-rules.json')

#: (pair regex, one-line title, why it cannot occur) -- the rules the file carries,
#: read from the map so the map is the only copy.
_IMPOSSIBLE = [(pat, title, why) for pat, title, why in _SCAN['impossible']]

#: A base or a mark: what must sit on either side of a digit for the digit to be
#: inside a word rather than standing alone.
_LETTER_OR_MARK = frozenset(_SCAN['letterOrMark']).__contains__

#: A token made of only these is a collapsed shadow copy, not a word: the
#: engine's marks, plus U+1039, which no syllable may start with.
_STRAY_MARKS = frozenset(_SCAN['strayMarks'])


def _words(text):
    """(token, start index) for every non-empty token."""
    out, pos = [], 0
    for tok in _SPLIT.split(text):
        if not tok:
            continue
        i = text.find(tok, pos)
        if i < 0:
            i = pos
        out.append((tok, i))
        pos = i + len(tok)
    return out


def _cluster_at(text, i, span=9):
    """The word containing position `i` (clusters read; bare marks do not)."""
    a = i
    while a > 0 and not _SPLIT.match(text[a - 1]):
        a -= 1
    b = i
    while b < len(text) and not _SPLIT.match(text[b]):
        b += 1
    return text[a:b][:span * 3] or text[i]


def _line_of(text, i, newlines):
    """1-based line number for a character offset."""
    lo, hi = 0, len(newlines)
    while lo < hi:
        mid = (lo + hi) // 2
        if newlines[mid] < i:
            lo = mid + 1
        else:
            hi = mid
    return lo + 1


# ── the rules ─────────────────────────────────────────────────────────────
#: The map is called ``damage-rules.json`` because every entry in it describes
#: text a Burmese page cannot produce -- it is not a "scan" of anything, and the
#: scan of this repo is the repair circle below. The scanner reports all six
#: kinds; ``impossible`` is the only one a DECISION may consult, and only
#: through :func:`impossible_hits` -- see ``extract/legacy_judgement.py``.
#: Anything a dependent mark may legally sit on, for SCANNING only -- the map's
#: ``base`` list, deliberately wider than the engine's ``index()`` (which governs
#: reordering and stops at U+1021 +U+1025/U+1027) because the independent vowels
#: U+1023/4/6/8/9/A, U+103F great sa and the rare U+1022 DO carry marks in real
#: text (``\u1026\u1038`` is ordinary), and because a dash or a blank rule stands in for
#: "any consonant" in these books: the vowel charts print U+2014 + vowel
#: ( ---a  ---i  ---u ) and the exercises print a rule to fill in. Marks hanging
#: off those are correctly placed on a placeholder, and counting them as damage
#: buries the real cases -- they were 258 of 478.
_BASES = frozenset(_SCAN['base'])


def _is_base(ch):
    """Base for SCANNING -- see ``_BASES`` for what the set adds and why."""
    return ch in _BASES


def _find_orphans(text, words):
    attached = False
    for i, ch in enumerate(text):
        if _is_base(ch):
            attached = True
        elif is_mark(ch):
            if not attached:
                yield i
        else:
            attached = False


def _find_impossible(text, words):
    for pat, _title, _why in _IMPOSSIBLE:
        for m in re.finditer(pat, text):
            yield m.start()


def impossible_hits(text):
    """The ``(offset, pattern, title)`` of every pair Burmese cannot write.

    The scanner's ``impossible`` kind is a report; this is the same seven rules
    as an answer a decision can act on. It exists because each of the seven was
    found by reading a wrong byte -- a pair that cannot occur in one syllable is
    not a style problem, it is proof that the text came through the wrong table.
    That is why the rule belongs to the Ayar-or-WinInnwa choice
    (``extract/legacy_judgement.py``) and to nothing else in the parser: inside
    the lane, one reading of a page has these pairs and the other does not.
    """
    if not text:
        return []
    hits = []
    for pat, title, _why in _IMPOSSIBLE:
        for m in re.finditer(pat, text):
            hits.append((m.start(), pat, title))
    hits.sort()
    return hits


def _find_stray(text, words):
    for tok, i in words:
        if len(tok) >= 1 and all(c in _STRAY_MARKS for c in tok):
            yield i


def _find_repeat(text, words):
    # THREE or more in a row. Two is ordinary Burmese reduplication
    # (\u1019\u103c\u1014\u103a\u1019\u103c\u1014\u103a, \u1021\u101e\u102e\u1038\u101e\u102e\u1038); three is the shadow-collapse signature.
    for m in re.finditer(r'([\u1000-\u109f]{2,4})\1{2,}', text):
        yield m.start()


def _find_digit(text, words):
    for i, ch in enumerate(text):
        if not _DIGIT(ch):
            continue
        before = text[i - 1] if i else ''
        after = text[i + 1] if i + 1 < len(text) else ''
        if before and after and _LETTER_OR_MARK(before) and _LETTER_OR_MARK(after):
            yield i


def _find_virama(text, words):
    for m in re.finditer(r'\u1039(?![\u1000-\u1021])', text):
        yield m.start()


RULES = [
    ("orphan", "a dependent mark with no base in front of it", _find_orphans),
    ("impossible", "a pair Burmese cannot write in one syllable", _find_impossible),
    ("stray", "a token made only of marks (shadow-collapse debris)", _find_stray),
    ("repeat", "the same syllable printed 3+ times back to back", _find_repeat),
    ("digit", "a digit with Myanmar letters on both sides (\u1040 vs \u101d)", _find_digit),
    ("virama", "U+1039 with nothing stacked after it", _find_virama),
]


def scan_text(text, per_rule=25):
    """Return ``{rule: {"total", "clusters"}}``; clusters are (word, n, line, context).

    Word verdicts are exclusively the Engine POS scan's responsibility.
    """
    tokens = _words(text)
    newlines = [i for i, c in enumerate(text) if c == '\n']
    report = {}
    for key, _title, finder in RULES:
        hits = list(finder(text, tokens))
        grouped = collections.Counter()
        first = {}
        for i in hits:
            w = _cluster_at(text, i)
            grouped[w] += 1
            first.setdefault(w, i)
        clusters = []
        for w, n in grouped.most_common(per_rule):
            i = first[w]
            ln = _line_of(text, i, newlines)
            a = text.rfind('\n', 0, i) + 1
            b = text.find('\n', i)
            ctx = text[a:b if b > 0 else len(text)].strip()
            clusters.append((w, n, ln, ctx[:110]))
        report[key] = {"total": len(hits), "distinct": len(grouped),
                       "clusters": clusters}
    return report


def format_report(report, source="", total_chars=0):
    out = []
    w = 78
    out.append("=" * w)
    out.append(f"praser scan{('  ' + source) if source else ''}")
    if total_chars:
        out.append(f"{total_chars:,} characters")
    out.append("=" * w)
    out.append("")
    out.append(f"{'rule':<12}{'hits':>8}{'distinct':>10}   what it means")
    for key, title, _ in RULES:
        r = report[key]
        out.append(f"{key:<12}{r['total']:>8}{r['distinct']:>10}   {title}")
    out.append("")
    sections = [(k, t) for k, t, _ in RULES]
    for key, title in sections:
        r = report[key]
        if not r["total"]:
            continue
        out.append("")
        out.append("-" * w)
        out.append(f"{key.upper()}  --  {title}")
        out.append(f"{r['total']} hits in {r['distinct']} distinct clusters")
        out.append("-" * w)
        for word, n, line, ctx in r["clusters"]:
            out.append(f"  {n:>5}  {word}")
            out.append(f"         line {line}: {ctx}")
    out.append("")
    return "\n".join(out)


def scan_file(path, out_path=None, per_rule=25):
    text = open(path, encoding="utf-8").read()
    report = scan_text(text, per_rule)
    body = format_report(report, source=path, total_chars=len(text))
    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(body)
    return report, body


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("file", help="a parsed .txt produced by the praser")
    ap.add_argument("-o", "--out", default="", help="write the log here (default: <file>.scan.txt)")
    ap.add_argument("-n", "--per-rule", type=int, default=25,
                    help="how many distinct clusters to list per rule")
    args = ap.parse_args()
    out = args.out or (args.file.rsplit(".", 1)[0] + ".scan.txt")
    _report, body = scan_file(args.file, out, args.per_rule)
    print(body[:body.index("\n\n\n")] if "\n\n\n" in body else body)
    print(f"[+] full log written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
