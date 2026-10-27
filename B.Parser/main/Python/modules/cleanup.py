"""Imposter cleanup + canonical mark reorder.

Runs AFTER detection, once per document decision (CLI: one y/N before
conversion; API: preview highlighted changes, then one apply/skip).

Two steps, with different reach:

``order_text``    normalize (NFC + glue strip) then mark reorder.  ALWAYS,
                  on every path -- Zawgyi (after Rabbit), Unicode, Unknown --
                  and not behind the apply/skip toggle.  There is one
                  canonical mark sequence and it is not a per-document
                  opinion.
``cleanup_text``  the imposter replacement on top of that.  The UNICODE
                  extraction branch ONLY, and only when applied: a Zawgyi
                  page is Rabbit's output, and re-reading its code points as
                  imposters would edit a conversion this module does not own.

The functions only touch characters in their defined sets; everything else
passes through.
"""

import unicodedata

from mm_score import MARK_ORDER as _PRIORITY, is_index

# _PRIORITY is the grammar engine's priority table, imported -- there is
# exactly ONE copy of it in this codebase and it lives in mm_score. Space
# (17) and newline (18) are in it, but they end a mark run rather than join
# one, so reorder_marks below never hoists them.

# Glue: invisible joiners, bidi controls, the dotted circle, the no-break
# space, the combining grapheme joiner, and the bridge tokens the engine uses
# as delimiters. Stripped on the way IN, before imposter cleanup and reorder.
_GLUE = frozenset(
    '\u200B\u200C\u200D\u2060\uFEFF\u180E\u200E\u200F\u202A\u202B\u25CC'
    '\u00A0\u034F'
    '#^{}\u221A'
)

def _is_index(ch: str) -> bool:
    """The engine's ``index()``: is this char a cluster base?

    U+1000..U+1021 plus U+1025 and U+1027, nothing else -- the same test
    ``mm_score.is_index`` makes, so the scorer and the reorder agree on what
    a base is. It is deliberately narrower than "any Myanmar letter": a digit
    or an independent vowel is not a base, so marks after one pass through
    untouched instead of being gathered and sorted onto it.
    """
    return is_index(ch)


# Map of Zawgyi imposters -> correct Unicode codepoints.
# Sorted longest-first so multi-char imposters match before single-char.
_IMPOSTER_REPS = sorted([
    # ---- ya pin family ----
    ('\u107E', '\u103B'),   # ya pin tall
    ('\u107F', '\u103B'),   # ya pin
    ('\u1080', '\u103B'),   # ya pin + kinzi-ish
    ('\u1081', '\u103B'),   # ya pin
    ('\u1082', '\u103B'),   # ya pin
    ('\u1083', '\u103B'),   # ya pin
    ('\u1084', '\u103B'),   # ya pin

    # ---- ya yit family ----
    ('\u1087', '\u103C'),   # ya yit (often fused with ha hto)

    # ---- wa hswe / ha hto ----
    ('\u1088', '\u103E\u102F'),  # ha hto + u
    ('\u1089', '\u103E\u1030'),  # ha hto + uu
    ('\u108A', '\u103D\u103E'),  # wa + ha

    # ---- kinzi / stacked forms ----
    ('\u1064', '\u1004\u103A\u1039'),  # kinzi
    ('\u108B', '\u1004\u103A\u1039\u102D'),
    ('\u108C', '\u1004\u103A\u1039\u102E'),
    ('\u108D', '\u1004\u103A\u1039\u1036'),
    ('\u108E', '\u102D\u1036'),

    # ---- consonant stackers ----
    ('\u1060', '\u1039\u1000'), ('\u1061', '\u1039\u1001'),
    ('\u1062', '\u1039\u1002'), ('\u1063', '\u1039\u1003'),
    ('\u1065', '\u1039\u1005'),
    ('\u1066', '\u1039\u1006'), ('\u1067', '\u1039\u1006'),
    ('\u1068', '\u1039\u1007'), ('\u1069', '\u1039\u1008'),
    ('\u106A', '\u1009'),       ('\u106B', '\u100A'),
    ('\u106C', '\u1039\u100B'), ('\u106D', '\u1039\u100C'),
    ('\u106E', '\u100D\u1039\u100D'), ('\u106F', '\u100D\u1039\u100E'),
    ('\u1070', '\u1039\u100F'),
    ('\u1071', '\u1039\u1010'), ('\u1072', '\u1039\u1010'),
    ('\u1073', '\u1039\u1011'), ('\u1074', '\u1039\u1011'),
    ('\u1075', '\u1039\u1012'), ('\u1076', '\u1039\u1013'),
    ('\u1077', '\u1039\u1014'), ('\u1078', '\u1039\u1015'),
    ('\u1079', '\u1039\u1016'), ('\u107A', '\u1039\u1017'),
    ('\u107B', '\u1039\u1018'), ('\u107C', '\u1039\u1019'),
    ('\u1085', '\u1039\u101C'),

    # ---- misc ----
    ('\u1086', '\u103F'),       # great sa
    ('\u108F', '\u1014'),       # na
    ('\u1090', '\u101B'),       # ra
    ('\u1091', '\u100F\u1039\u100D'),
    ('\u1092', '\u100B\u1039\u100C'),
    ('\u1093', '\u1039\u1018'),
    ('\u1094', '\u1037'),      ('\u1095', '\u1037'),
    ('\u1096', '\u1039\u1010\u103D'),
    ('\u1097', '\u100B\u1039\u100B'),

    # ---- tall aa / asat variants ----
    ('\u105A', '\u102B\u103A'),

    # ---- u / uu vowel variants ----
    ('\u1033', '\u102F'),       ('\u1034', '\u1030'),

    # ---- remaining asat-like mappings ----
    ('\u107D', '\u103B'),       # ya pin (asat context)

    # ---- one addition, same shape as the engine's ဥ/ဉ entries ----------
    # The sealed map resolves ဥ vs ဉ by what FOLLOWS: ဥာဋ် -> ဉာဋ်,
    # ဉုံ -> ဥုံ, ဉမ် -> ဥမ်. The asat case is missing, and the book settles
    # it: ဥ် occurs 0 times there and ဉ် 227 times, while this extraction
    # produced 408 ဥ်. ဥ cannot carry an asat; ဉ can.
    # မျဉ်းသား, အကျဉ်း, ယှဉ်, စီစဉ်, အမှတ်စဉ်.
    ('\u1025\u103a', '\u1009\u103a'),           # ဥ် -> ဉ်
    # ...and the same pair as NFC leaves it. U+1037 has combining class 7
    # and U+103A has 9, so normalize_text -- which runs BEFORE this table --
    # canonically reorders ့် into ့်. Without this second spelling the
    # entry above silently misses every စဉ့်ကွင်း / ညဉ့် / အဉ့်.
    ('\u1025\u1037\u103a', '\u1009\u1037\u103a'),

    # ---- lookalikes, from the engine's own sealed map -----------------
    # repo-root master.json.enc -> mapData.IMPOSTER, read through the
    # repo-root secure.js loader (the one .env key, the one sealed cache).
    # A DIFFERENT kind of entry from the
    # Zawgyi code points above: these are multi-character spellings that
    # RENDER identically to the correct form, which is why the matcher
    # has to be longest-match rather than a per-character table.
    ('\u101e\u103c\u1031\u103a', '\u102a'),   # သြေ် -> ဪ
    ('\u1029\u103c\u1031\u103a', '\u102a'),   # ဩြေ် -> ဪ
    ('\u1044\u1004\u103a\u1038', '\u104e\u1004\u103a\u1038'),   # ၄င်း -> ၎င်း
    ('\u1025\u102c\u100b\u103a', '\u1009\u102c\u100b\u103a'),   # ဥာဋ် -> ဉာဋ်
    ('\u1025\u102d\u102e\u1038', '\u1026\u1038'),   # ဥိီး -> ဦး
    ('\u1009\u102d\u102e\u1038', '\u1026\u1038'),   # ဉိီး -> ဦး
    ('\u1000\u1039\u1000', '\u1023'),   # က္က -> ဣ
    ('\u102e\u102d\u1038', '\u102e\u1038'),   # ီိး -> ီး
    ('\u102d\u102e\u1038', '\u102e\u1038'),   # ိီး -> ီး
    ('\u101e\u1039\u101e', '\u103f'),   # သ္သ -> ဿ
    ('\u1025\u102e\u1038', '\u1026\u1038'),   # ဦး -> ဦး
    ('\u1009\u102e\u1038', '\u1026\u1038'),   # ဉီး -> ဦး
    ('\u1009\u102f\u1036', '\u1025\u102f\u1036'),   # ဉုံ -> ဥုံ
    ('\u1009\u1019\u103a', '\u1025\u1019\u103a'),   # ဉမ် -> ဥမ်
    ('\u101e\u103c', '\u1029'),   # သြ -> ဩ
], key=lambda pair: len(pair[0]), reverse=True)

# Imposter trie, built once at import, exactly like the engine's: one node per
# character, the replacement hanging off the last node of each key. Matching is
# LONGEST-first, so a multi-character imposter wins over a shorter one that
# starts the same way -- which a flat per-character table cannot express.
_REPLACEMENT = "\0"          # key that cannot collide with a character


def _build_imposter_trie(reps):
    trie = {}
    for frm, to in reps:
        node = trie
        for ch in frm:
            node = node.setdefault(ch, {})
        node[_REPLACEMENT] = to
    return trie


_IMPOSTER_TRIE = _build_imposter_trie(_IMPOSTER_REPS)

# Every key in the table above happens to be a single codepoint today, so the
# whole trie collapses to one ``str.translate`` pass -- and that matters: the
# character-by-character walk is ~20x slower on a 7000-page run. The fast path
# is taken only while that stays true; add a multi-character imposter and the
# trie walk below takes over automatically, with the same result.
_SINGLE_CHAR_ONLY = all(len(frm) == 1 for frm, _ in _IMPOSTER_REPS)
_IMPOSTER_TABLE = (str.maketrans({ord(frm): to for frm, to in _IMPOSTER_REPS})
                   if _SINGLE_CHAR_ONLY else None)


def clean_imposters(t: str) -> str:
    """Replace any lingering Zawgyi imposter sequences with correct Unicode.

    Longest match wins, and a replacement is never re-scanned: the walk
    resumes after what it just emitted, so one imposter cannot cascade into
    another. (``str.translate`` has the same one-pass property, which is why
    the fast path above is equivalent.)
    """
    if not t:
        return t
    if _IMPOSTER_TABLE is not None:
        return t.translate(_IMPOSTER_TABLE)

    chars = list(t)
    n = len(chars)
    out = []
    i = 0
    while i < n:
        node = _IMPOSTER_TRIE
        j = i
        last_match = -1
        replacement = None
        while j < n and chars[j] in node:
            node = node[chars[j]]
            j += 1
            if _REPLACEMENT in node:
                last_match = j
                replacement = node[_REPLACEMENT]
        if replacement is not None:
            out.append(replacement)
            i = last_match
        else:
            out.append(chars[i])
            i += 1
    return "".join(out)


def reorder_marks(t: str) -> str:
    """Reorder Myanmar dependent marks into canonical Unicode order."""
    if not t or not isinstance(t, str):
        return ""

    chars = list(t)
    out = []
    i = 0
    n = len(chars)

    # One loop, no leading-prefix phase: the engine has none either, and it
    # needs none -- a leading space or any other non-base falls through to
    # the pass-through branch at the bottom.
    while i < n:
        ch = chars[i]
        if _is_index(ch):
            out.append(ch)
            i += 1

            # Collect the run. It ends at the next base, or at the first
            # character the priority table does not list (U+1039 virama is
            # the common one) -- that character passes through below. A space
            # (17) and a newline (18) ARE in the table, so they join the run
            # and sort to the end of the cluster, and a second one is dropped
            # by the dedup, exactly as the engine does it.
            marks = []
            seen_priorities = set()
            while i < n:
                nxt = chars[i]
                if _is_index(nxt):
                    break
                p = _PRIORITY.get(nxt)
                if p is None:
                    break
                if p not in seen_priorities:
                    seen_priorities.add(p)
                    marks.append(nxt)
                i += 1

            if marks:
                marks.sort(key=lambda c: _PRIORITY[c])
                out.extend(marks)
        else:
            out.append(ch)
            i += 1

    return "".join(out)


def normalize_text(t: str) -> str:
    """NFC, then drop every glue codepoint.

    The engine's first step. Zero-width joiners, bidi controls, a dotted
    circle placeholder or a stray no-break space sit BETWEEN a base and its
    marks and would otherwise split a cluster in two, so they go before
    anything else looks at the text.
    """
    if not t or not isinstance(t, str):
        return ""
    return "".join(ch for ch in unicodedata.normalize("NFC", t)
                   if ch not in _GLUE)


def order_text(t: str) -> str:
    """Normalize + reorder: the part that runs on EVERY path, always.

    Ordering marks by priority is not an opinion about a document, it is the
    one canonical sequence, so it is not behind the cleanup toggle and not
    tied to a category: Zawgyi (after Rabbit), Unicode and Unknown all get
    it. The glue strip comes with it because a zero-width joiner sitting
    between a base and its marks would otherwise split the cluster and hide
    the very run that needs ordering.

    Imposter replacement is NOT here -- that is the toggleable step, and the
    Unicode path's alone.
    """
    return reorder_marks(normalize_text(t))


def cleanup_text(t: str) -> str:
    """The toggleable step: imposter cleanup, on top of normalize + reorder.

    Reorder runs again after the replacement, because an imposter expands
    into real marks (U+1088 -> U+103E U+102F) that then have to take their
    place in the run.
    """
    return reorder_marks(clean_imposters(normalize_text(t)))
