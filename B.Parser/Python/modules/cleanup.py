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

import importlib.util
import unicodedata
from functools import lru_cache
from pathlib import Path

from mm_score import MARK_ORDER as _PRIORITY, is_index

# Scoring and cleanup share the Python mark priority table from mm_score.

@lru_cache(maxsize=1)
def _master_data():
    """Load the Engine master in memory through the shared workspace chain."""
    workspace_path = Path(__file__).resolve().parents[4] / "index-path.py"
    spec = importlib.util.spec_from_file_location("myangustis_workspace", workspace_path)
    workspace = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(workspace)
    data = workspace.get_engine_data().read_master_json().get("mapData")
    if (not isinstance(data, dict) or not isinstance(data.get("Glue"), list)
            or not isinstance(data.get("IMPOSTER"), dict)):
        raise ValueError("Engine master is missing cleanup data")
    return data


@lru_cache(maxsize=1)
def _glue():
    return frozenset(_master_data()["Glue"])


def _is_index(ch: str) -> bool:
    """The engine's ``index()``: is this char a cluster base?

    U+1000..U+1021 plus U+1025 and U+1027, nothing else -- the same test
    ``mm_score.is_index`` makes, so the scorer and the reorder agree on what
    a base is. It is deliberately narrower than "any Myanmar letter": a digit
    or an independent vowel is not a base, so marks after one pass through
    untouched instead of being gathered and sorted onto it.
    """
    return is_index(ch)


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
                p = _PRIORITY.get(nxt)
                if p is None:
                    break
                if nxt == "\u102f" or p not in seen_priorities:
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
    return reorder_marks(normalize_text(t))


def cleanup_text(t: str) -> str:
    """The toggleable step: imposter cleanup, on top of normalize + reorder.

    Reorder runs again after the replacement, because an imposter expands
    into real marks (U+1088 -> U+103E U+102F) that then have to take their
    place in the run.
    """
    return reorder_marks(clean_imposters(normalize_text(t)))
