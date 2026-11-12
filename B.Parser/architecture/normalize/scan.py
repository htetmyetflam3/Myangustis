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

from myangustis_parser.normalize.mm_score import is_index, is_mark

__all__ = ["scan_text", "format_report", "RULES"]

# Token boundary: whitespace and the punctuation that cannot sit inside a word.
_SPLIT = re.compile(r'[\s\u104a\u104b()\[\]"\u2018\u2019\u201c\u201d,\.:;?!/=+_\u2014-]+')

_MYANMAR = lambda c: '\u1000' <= c <= '\u109f'          # noqa: E731
_DIGIT = lambda c: '\u1040' <= c <= '\u1049'            # noqa: E731
_LETTER_OR_MARK = lambda c: (is_index(c) or is_mark(c)  # noqa: E731
                             or c == '\u1039' or c in '\u1023\u1024\u1026\u1028\u1029')

# (key, one-line title, pair regex) for the sequences Burmese cannot write
_IMPOSSIBLE = [
    ("\u1036\u103a", "\u1036 + \u103a", "anusvara before asat -- the second is dot below"),
    ("\u1032[\u102c\u102b]", "\u1032 + \u102c/\u102b", "ai vowel cannot share a syllable with aa"),
    ("\u1032[\u102f\u1030]", "\u1032 + \u102f/\u1030", "ai vowel cannot share a syllable with u"),
    ("[\u102d\u102e][\u102c\u102b]", "\u102d/\u102e + \u102c/\u102b", "i and aa cannot combine"),
    ("[\u102c\u102b][\u102c\u102b]", "doubled \u102c/\u102b", "two aa vowels in one syllable"),
    ("\u103a[\u103b\u103c\u103d\u103e]", "\u103a + medial", "a medial cannot follow asat"),
    # Kinzi with no consonant after it. Worth a rule of its own because the
    # renderer HIDES it: \u101e\u1001\u103b\u1004\u103a\u1039\u102c and \u101e\u1004\u103a\u1039\u1001\u103b\u102c draw the same shape, so the
    # damage is invisible on screen and only the code points show it.
    ("\u1004\u103a\u1039(?![\u1000-\u1021])", "kinzi with nothing to sit on",
     "a kinzi must be followed by the consonant it belongs to"),
]


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
# Anything a dependent mark may legally sit on, for SCANNING only --
# deliberately wider than the engine's ``index()``, which governs reordering
# and stops at U+1021 (+U+1025/U+1027).
#   U+1023 U+1024 U+1026 U+1028 U+1029 U+102A  independent vowels
#   U+103F  great sa is a LETTER and takes marks
#   U+1022  rare, included for completeness
_EXTRA_BASES = '\u1023\u1024\u1026\u1028\u1029\u102a\u103f\u1022'

# In this kind of book a dash or a blank rule stands in for 'any consonant':
# the vowel charts print  U+2014 + vowel  ( ---a  ---i  ---u ) and the
# exercises print a rule to fill in. Marks hanging off those are correctly
# placed on a placeholder, not orphaned, and counting them as damage buries
# the real cases -- they were 258 of 478.
_PLACEHOLDER_BASES = '\u2014\u2013-_'


def _is_base(ch):
    """Base for SCANNING, deliberately wider than the engine's ``index()``.

    ``index()`` governs reordering and stops at U+1021 (+U+1025/U+1027). The
    independent vowels DO carry marks in real text -- ``\u1026\u1038`` is ordinary --
    so counting them as bases here removes false orphans without touching
    the reorder rule.
    """
    return is_index(ch) or ch in _EXTRA_BASES or ch in _PLACEHOLDER_BASES


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


def _find_stray(text, words):
    for tok, i in words:
        if len(tok) >= 1 and all(is_mark(c) or c == '\u1039' for c in tok):
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
