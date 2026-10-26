"""Read-only dictionary and segmentation helpers for the agent tools.

Two questions a proofreading agent needs answered, both without touching the
engine's files:

  lookup(word)  is this spelling an entry, in which POS family, and is it
                reachable by the POS tree at all?
  segment(text) how does the engine cut this sentence, and which cuts are
                splits rather than words?

The split verdict is the useful half. A unit that starts with a combining mark
is never a word on its own, so it is always a split. What the agent must know
is *why*:

  word       the joined form is a dictionary entry           -> fine
  unit       the joined form is a known syllable             -> fine
  loan       a virama stack the unit table cannot name       -> rare, report it
  unknown    neither                                         -> suspect text

Only `unknown` justifies a repair, and only together with a dictionary hit for
the proposed spelling. Since the tree carries both syllable lists, Pali stacks
such as `ဒ္ဓ` and `န္ဓာ` are ordinary units: `ဗုဒ္ဓ` and `ခန္ဓာ` come back as one
token each, not three fragments.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
MASTER_ENC = REPO / "master.json.enc"
SECURE_JS = REPO / "secure.js"
MAPPED = ROOT / "Engine/.cache-tree/syllable.mapped.txt"


def _load_master() -> dict:
    """Read the sealed repo-root master through secure.js (node door).

    secure.js itself owns the .env key and the sealed on-disk cache; Python
    never handles the key and never writes a plaintext copy.
    """
    script = ("import {readMasterJson} from %s;"
              "process.stdout.write(JSON.stringify(readMasterJson()));"
              % json.dumps(str(SECURE_JS)))
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, check=True, text=True).stdout
    return json.loads(out)

# The engine writes asat (U+103A) before dot-below (U+1037); NFC writes the
# reverse. Compare both spellings under one key.
_DOT_ASAT = re.compile("\u1037\u103a")


def canonical(text: str) -> str:
    return _DOT_ASAT.sub("\u103a\u1037", text)


def _squash(text: str) -> str:
    return re.sub(r"\s+", "", text)


def is_mark(ch: str) -> bool:
    return unicodedata.category(ch).startswith("M")


@lru_cache(maxsize=1)
def _tables() -> tuple[dict[str, set[str]], dict[str, set[str]], set[str]]:
    """(reachable entries, unreachable entries, syllable inventory)."""
    data = _load_master()
    units = set()
    if MAPPED.exists():
        for line in MAPPED.read_text(encoding="utf-8").splitlines():
            match = re.match(r'^"(.+?)"\s*:\s*"(.+?)"\s*:\s*"(.+?)"\s*$', line)
            if match:
                units.add(match.group(1))
    reachable: dict[str, set[str]] = defaultdict(set)
    unreachable: dict[str, set[str]] = defaultdict(set)
    for family, entries in data["dictionary"].items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, str):
                continue
            parts = [p for p in re.split(r"\s{2,}", entry.strip()) if p]
            target = reachable if all(p in units for p in parts) else unreachable
            target[canonical(_squash(entry))].add(family)
    return dict(reachable), dict(unreachable), units


def lookup(word: str) -> dict:
    """Dictionary facts for one spelling."""
    reachable, unreachable, units = _tables()
    key = canonical(_squash(word))
    families = sorted(reachable.get(key, ()))
    blocked = sorted(unreachable.get(key, ()))
    result = {
        "word": word,
        "in_dictionary": bool(families or blocked),
        "families": families,
        "reachable": bool(families),
        "blocked_families": blocked,
        "blocked_reason": None,
        "is_unit": key in units,
    }
    if blocked and not families:
        parts = [p for p in re.split(r"\s{2,}", word.strip()) if p]
        missing = [p for p in parts if p not in units]
        result["blocked_reason"] = (
            "contains units absent from syllable.mapped.txt: " + ", ".join(missing)
            if missing
            else "entry pruned at build time"
        )
    return result


def _classify(tokens: list[dict], index: int, units: set[str],
              reachable: dict[str, set[str]]) -> tuple[str, str]:
    run_end = index
    while run_end + 1 < len(tokens) and is_mark(tokens[run_end + 1]["surface"][:1] or "x"):
        run_end += 1
    tail = "".join(t["surface"] for t in tokens[index:run_end + 1])
    for back in (1, 2, 3):
        if index - back < 0:
            break
        head = "".join(t["surface"] for t in tokens[index - back:index])
        candidate = head + tail
        key = canonical(candidate)
        if key in reachable:
            return "word", candidate
        if key in units:
            return "unit", candidate
        if "\u1039" in candidate:
            return "loan", candidate
    return "unknown", "".join(t["surface"] for t in tokens[max(0, index - 1):run_end + 1])


def segment(text: str, with_tags: bool = True) -> dict:
    """Segment text with the repo engine and explain every split."""
    sys.path.insert(0, str(ROOT / "mt/quality"))
    from tag import tag_text  # noqa: PLC0415  (imports node at call time)

    sentences = tag_text(text)
    reachable, _unreachable, units = _tables()

    out_sentences = []
    tally = {"word": 0, "unit": 0, "loan": 0, "unknown": 0}
    for sentence in sentences:
        tokens = sentence["tokens"]
        rendered = []
        for index, token in enumerate(tokens):
            surface = token["surface"]
            item = {
                "token": surface,
                "units": token.get("syllables") or [],
                "tags": token.get("tags") or [],
            }
            if surface and is_mark(surface[0]):
                bucket, joined = _classify(tokens, index, units, reachable)
                tally[bucket] += 1
                item["split"] = bucket
                item["joined"] = joined
            rendered.append(item)
        out_sentences.append({"sentence": sentence["sentence"], "tokens": rendered})

    return {
        "sentences": out_sentences,
        "unit_count": sum(len(t["units"]) for s in out_sentences for t in s["tokens"]),
        "token_count": sum(len(s["tokens"]) for s in out_sentences),
        "splits": tally,
        "coverage": coverage(text),
        "with_tags": with_tags,
    }


@lru_cache(maxsize=1)
def _known() -> tuple[frozenset[str], int]:
    """Every string the engine can name: reachable entries plus units."""
    reachable, _unreachable, units = _tables()
    known = set(reachable) | set(units)
    return frozenset(known), max((len(k) for k in known), default=1)


def coverage(text: str, min_span: int = 1) -> dict:
    """How much of the text can some entry or unit explain?

    Only catches text that no entry or unit can name — genuinely unknown
    characters. It CANNOT see a same-inventory misassembly such as
    `အေခြ` for `အခြေ`, because `အေ` and `ခြ` are both valid units; use
    suggest() for that class.

    The parse maximises the number of covered characters, per position, rather
    than taking the longest match at each stop. Greedy longest-match used to
    jump word boundaries — `ဗုဒ္ဓကိုကြည်ညို` matched `ကိုက` across `ကို` + `က`
    and left the `ြ` and the `်` orphaned — so clean text was reported at 0.89
    and the agent chased characters that were never damaged.
    """
    known, longest = _known()
    # Punctuation is not a word; counting it as uncovered would drown the signal.
    skip = set("\u104a\u104b\u104c\u104d.,;:!?\u201c\u201d\u2018\u2019()[]-\u2026")
    chars = [c for c in text if not c.isspace() and c not in skip]
    n = len(chars)
    flat = canonical("".join(chars))

    # best[i] = most characters explainable from i onward; take[i] = span used.
    best = [0] * (n + 1)
    take = [0] * (n + 1)
    for i in range(n - 1, -1, -1):
        best[i] = best[i + 1]            # leaving chars[i] uncovered is legal
        for size in range(1, min(longest, n - i) + 1):
            if flat[i:i + size] in known:
                score = size + best[i + size]
                if score > best[i]:
                    best[i], take[i] = score, size

    covered = [False] * n
    i = 0
    while i < n:
        size = take[i]
        if size:
            for j in range(i, i + size):
                covered[j] = True
        i += size or 1

    spans = []
    i = 0
    while i < n:
        if covered[i]:
            i += 1
            continue
        start = i
        while i < n and not covered[i]:
            i += 1
        if i - start >= min_span:
            spans.append({
                "text": "".join(chars[start:i]),
                "context": "".join(chars[max(0, start - 8):i + 8]),
            })

    total = n or 1
    return {
        "characters": n,
        "covered": sum(covered),
        "coverage": round(sum(covered) / total, 4),
        "uncovered_spans": spans,
        "uncovered_count": len(spans),
    }


_MEDIALS = "\u103b\u103c\u103d\u103e"


def suggest(span: str, limit: int = 8) -> dict:
    """Dictionary-proved repairs for one span.

    Only variants that turn a non-word into an entry are proposed, so every
    suggestion carries its own evidence. Covers the storage-order class:
    `ေ` placed before a consonant that carries a medial (Zawgyi order), and a
    Myanmar digit used where a letter belongs.
    """
    reachable, unreachable, units = _tables()
    known = set(reachable) | set(units)
    original = canonical(_squash(span))

    def families(text: str) -> list[str]:
        return sorted(reachable.get(canonical(_squash(text)), ()))

    candidates: list[dict] = []
    seen = {original}

    # ေ base medial -> base medial ေ, applied at every site (a span can hold
    # more than one damaged cluster: အေခြအေန -> အခြေအနေ needs two).
    def swaps_once(text: str) -> set[str]:
        out = set()
        index = 0
        while index < len(text) - 1:
            # ေ C [medials]  ->  C [medials] ေ
            if (text[index] == "\u1031"
                    and 0x1000 <= ord(text[index + 1]) <= 0x102A):
                end = index + 2
                while end < len(text) and text[end] in _MEDIALS:
                    end += 1
                out.add(text[:index] + text[index + 1:end] + "\u1031" + text[end:])
            index += 1
        return out

    frontier = [original]
    for _depth in range(3):
        nxt: list[str] = []
        for text in frontier:
            for variant in swaps_once(text):
                if variant in seen:
                    continue
                seen.add(variant)
                nxt.append(variant)
                found = families(variant)
                if found:
                    candidates.append({"text": variant, "families": found,
                                       "rule": "storage-order: ေ moved after base"})
        if not nxt:
            break
        frontier = nxt

    # digit used where a letter belongs
    for digit, letter in (("\u1040", "\u101d"),):
        if digit in original:
            variant = original.replace(digit, letter)
            if variant not in seen:
                seen.add(variant)
                found = families(variant)
                if found:
                    candidates.append({"text": variant, "families": found,
                                       "rule": f"letter class: U+{ord(digit):04X} -> U+{ord(letter):04X}"})

    return {
        "span": span,
        "as_written_in_dictionary": families(original),
        "as_written_is_unit": canonical(_squash(span)) in units,
        "suggestions": candidates[:limit],
        "verdict": ("already a word" if families(original)
                    else "repair available" if candidates
                    else "no proved repair"),
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(__doc__.strip())
        return 2
    if args[0] == "--lookup":
        print(json.dumps(lookup(args[1]), ensure_ascii=False, indent=2))
        return 0
    if args[0] == "--coverage":
        print(json.dumps(coverage(args[1]), ensure_ascii=False, indent=2))
        return 0
    if args[0] == "--suggest":
        print(json.dumps(suggest(args[1]), ensure_ascii=False, indent=2))
        return 0
    if args[0] == "--segment":
        result = segment(args[1])
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    print(__doc__.strip())
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
