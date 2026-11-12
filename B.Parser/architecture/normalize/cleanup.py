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
from functools import lru_cache

from myangustis_parser.resources import engine
from myangustis_parser.resources import maps

# clean.js uses the Engine slot priorities, not the score walker's ordering.
_PRIORITY = dict(zip("ူေီဲဳဴဵံိာါန်ု့းမျြွှ",
                     (1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22)))

# Reordering inside one cluster follows the modern Burmese syllable order
# (consonant, medials ျ ြ ွ ှ, then ေ, then the vowels above/below, then
# ံ ့ း). MARK_ORDER is the Engine's own SLOT order -- a keyboard/code order
# in which ေ sits at 2 and the medials at 19-22 -- so sorting a cluster's
# marks by it turns ကြေ into ကေြ. Marks outside this table keep the Engine
# order. (Mirror of REORDER_PRIORITY in beautify/clean.js.)
REORDER_PRIORITY = {
    "\u103b": 1, "\u103c": 2, "\u103d": 3, "\u103e": 4,
    "\u1031": 5, "\u102d": 6, "\u102e": 6, "\u1032": 6,
    "\u102f": 7, "\u1030": 7,
    "\u102b": 8, "\u102c": 8,
    "\u1036": 9, "\u103a": 10, "\u1037": 11, "\u1038": 12,
}


def reorder_rank(ch):
    """Syllable rank for reordering: modern order first, Engine order after."""
    rank = REORDER_PRIORITY.get(ch)
    return _PRIORITY.get(ch) if rank is None else rank

# Scoring and cleanup share the Python mark priority table from mm_score.

@lru_cache(maxsize=1)
def _master_data():
    """Load ``mapData`` (Glue + imposter table) from the Python engine.
    """
    data = engine.read_master_json().get("mapData")
    if (not isinstance(data, dict) or not isinstance(data.get("Glue"), list)
            or not isinstance(data.get("IMPOSTER"), dict)):
        raise ValueError("Engine master is missing cleanup data")
    return data


@lru_cache(maxsize=1)
def _glue():
    return frozenset(_master_data()["Glue"])


def _is_index(ch: str) -> bool:
    """The broader Unicode base set used by JS cleanup, not scoreText's base."""
    if not ch:
        return False
    cp = ord(ch)
    return (0x1000 <= cp <= 0x1021 or 0x1023 <= cp <= 0x1027
            or cp in (0x1029, 0x102a, 0x103f, 0x104e))


_PREBASE = frozenset("ေြ")
_MEDIALS = frozenset("ျြွှ")
_PREBASE_RUN = _PREBASE | _MEDIALS
_MEDIAL_HOSTS = {
    "ျ": "ကခဂဃငစဇညဋဎဏတထဒဓနပဖဗဘမယလဝသဟ",
    "ြ": "ကခဂငစညတထဒနပဖဗမယ",
    "ွ": "ကခဂငစဆဇညဏတထဒဓနပဖဗဘမယရလဝသဟ",
    "ှ": "ငဉညဏနမယရလဝဠ",
}


def medial_follows(medial, consonant):
    return consonant in _MEDIAL_HOSTS.get(medial, "")


@lru_cache(maxsize=1)
def _syllable_inventory():
    try:
        return frozenset(maps.load_map("burmese-inventory.json").get("syllables", ()))
    except (OSError, ValueError):
        return frozenset()


def _starts_at_boundary(chars, i):
    if i == 0:
        return True
    previous = chars[i - 1]
    return previous in " \n\t\r" or (not _is_index(previous) and previous not in _PRIORITY)


def _prebase_end(chars, i):
    allowed = _PREBASE_RUN if _starts_at_boundary(chars, i) or chars[i] in _PREBASE else _PREBASE
    j = i
    while j < len(chars) and chars[j] in allowed:
        j += 1
    return j


def _candidate_is_real(chars, j):
    inventory = _syllable_inventory()
    if not inventory:
        return True
    parts = [chars[j], "ေ"]
    seen = False
    for ch in chars[j + 1:]:
        if ch in " \n":
            break
        if _is_index(ch):
            if seen:
                break
            seen = True
        parts.append(ch)
    return reorder_marks(''.join(parts)) in inventory


def _opens_cluster(chars, i):
    end = _prebase_end(chars, i)
    if end >= len(chars) or not _is_index(chars[end]):
        return False
    if _starts_at_boundary(chars, i):
        return True
    prev = chars[i - 1]
    if _is_index(prev) and chars[i] in _MEDIALS and not medial_follows(chars[i], prev):
        return True
    if _is_index(prev) and chars[i] == "ေ":
        if not _candidate_is_real(chars, end):
            return False
        rank = _PRIORITY.get(prev)
        return rank is None or _PRIORITY[chars[i]] < rank
    if _is_index(prev):
        return False
    rank = reorder_rank(prev)
    return rank is None or reorder_rank(chars[i]) < rank


def move_prebase_marks(text):
    if not text or not isinstance(text, str):
        return ""
    chars = list(text)
    out = []
    i = 0
    while i < len(chars):
        if chars[i] in _PREBASE_RUN and _opens_cluster(chars, i):
            end = _prebase_end(chars, i)
            out.append(chars[end])
            out.extend(chars[i:end])
            i = end + 1
        else:
            out.append(chars[i])
            i += 1
    return ''.join(out)


def drop_impossible_marks(text):
    if not text or not isinstance(text, str):
        return ""
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        out.append(ch)
        i += 1
        if ch != "ေ":
            continue
        j = i
        while j < len(text) and text[j] in "ိုူံ":
            j += 1
        following = text[i:j]
        if following.count("ု") >= 2:
            out.append(following)
        i = j
    return ''.join(out)


# Imposter trie, built on first use, exactly like the engine's: one node per
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


@lru_cache(maxsize=1)
def _imposter_matcher():
    reps = [(imposter, entry["correct"])
            for entry in _master_data()["IMPOSTER"].values()
            for imposter in entry["imposters"]]
    trie = _build_imposter_trie(reps)
    table = (str.maketrans({ord(frm): to for frm, to in reps})
             if all(len(frm) == 1 for frm, _ in reps) else None)
    return trie, table


def clean_imposters(t: str) -> str:
    """Replace Engine imposter sequences with their correct Unicode forms.

    Longest match wins, and a replacement is never re-scanned: the walk
    resumes after what it just emitted, so one imposter cannot cascade into
    another. (``str.translate`` has the same one-pass property, which is why
    the fast path above is equivalent.)
    """
    if not t:
        return t
    trie, table = _imposter_matcher()
    if table is not None:
        return t.translate(table)

    chars = list(t)
    n = len(chars)
    out = []
    i = 0
    while i < n:
        node = trie
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

            # Whitespace is a boundary, not a dependent mark. Keep every
            # original space/newline and the deliberately doubled short-u
            # emitted by some keyboard workflows.
            marks = []
            seen_priorities = set()
            while i < n:
                nxt = chars[i]
                if _is_index(nxt) or nxt in (" ", "\n"):
                    break
                p = reorder_rank(nxt)
                if p is None:
                    break
                if nxt == "\u102f" or p not in seen_priorities:
                    seen_priorities.add(p)
                    marks.append(nxt)
                i += 1

            if marks:
                marks.sort(key=reorder_rank)
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
    glue = _glue()
    return "".join(ch for ch in unicodedata.normalize("NFC", t)
                   if ch not in glue)


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
    return drop_impossible_marks(reorder_marks(move_prebase_marks(normalize_text(t))))


def cleanup_text(t: str) -> str:
    """The toggleable step: imposter cleanup, on top of normalize + reorder.

    Reorder runs again after the replacement, because an imposter expands
    into real marks (U+1088 -> U+103E U+102F) that then have to take their
    place in the run.
    """
    return drop_impossible_marks(reorder_marks(clean_imposters(normalize_text(t))))
