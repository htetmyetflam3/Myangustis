"""Quantified profile of a Burmese chapter, using the Engine's own views.

Everything here is read-only: master.json is only read (for dictionary and
syllable lookups), and tagging happens through mt/quality/tag.py in a scratch
directory.

What the numbers mean
---------------------
word tokens   what the tagger emitted — one token per matched dictionary entry
units         the segmentor's smallest units (syllables)
fragments     tokens that start with a combining mark (`ာ`, `်`, `း`, `့`,
              `္ဘ`). A word cannot start with a mark, so every fragment is a
              split — either the segmentor does not know that cluster, or the
              text is not orthographically valid. `profile` separates the two
              cases by rejoining the fragment with the preceding token(s) and
              asking the dictionary and the syllable inventory.

Usage
-----
    python3 mt/quality/profile.py --chapter 1 --chapter 2 --json out.json
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parents[1]
MASTER_ENC = REPO / "master.json.enc"
SECURE_JS = REPO / "secure.js"
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / "mt"))


def _load_master() -> dict:
    """Sealed repo-root master through secure.js (node door; secure.js owns
    the .env key and the sealed cache — Python holds neither)."""
    script = ("import {readMasterJson} from %s;"
              "process.stdout.write(JSON.stringify(readMasterJson()));"
              % json.dumps(str(SECURE_JS)))
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, check=True, text=True).stdout
    return json.loads(out)

from tag import chapter_text, tag_text  # noqa: E402

FULLSTOP = "။"
COMMA = "၊"

FORMAL_FINALS = [
    "ပါသည်", "သည်ဟု", "လိမ့်မည်", "ရမည်", "ဖြစ်သည်", "ရှိသည်", "သည်",
    "မည်", "ခဲ့", "ပြီ", "နိုင်", "ခြင်း", "သော", "လော", "ပေ", "တည်း", "၏",
]
SPOKEN_FINALS = [
    "ပါတယ်", "ပေါ့", "တယ်", "မယ်", "လား", "ဘူး", "ရဲ့", "နော်", "ဟေ့", "ကွ", "ပါ့",
]
CONNECTIVES = [
    "သို့သော်", "ထို့ကြောင့်", "ထို့ကြောင့်", "သို့ဖြစ်ရာ", "ထိုအခါ", "ပြီးနောက်",
    "သို့ရာတွင်", "ထို့နောက်", "အကြောင်းမှာ", "သို့သော်လည်း", "ထိုကြောင့်",
]


def is_mark(ch: str) -> bool:
    return unicodedata.category(ch).startswith("M")


def is_letter(ch: str) -> bool:
    return unicodedata.category(ch).startswith("L")


def has_myanmar_letter(text: str) -> bool:
    return any(is_letter(ch) and 0x1000 <= ord(ch) <= 0x109F for ch in text)


def norm(text: str) -> str:
    return re.sub(r"\s+", "", text)


class Dictionary:
    """Read-only view of master.json: entries are units joined by two spaces.

    `reachable` mirrors what the POS tree can actually use: an entry whose
    units are not all in the syllable inventory is dropped by buildPosTree,
    so it can never match. Keeping that split is what makes lookups honest —
    `ဧကရာဇ်` is in the file but unreachable, because `ဧ` is not a unit.
    """

    def __init__(self) -> None:
        data = _load_master()
        self.syllables = load_units()
        self.words: dict[str, set[str]] = defaultdict(set)
        self.unreachable: dict[str, set[str]] = defaultdict(set)
        self.entries = 0
        for family, entries in data["dictionary"].items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, str):
                    continue
                self.entries += 1
                units = [unit for unit in re.split(r"\s{2,}", entry.strip()) if unit]
                target = self.words if all(unit in self.syllables for unit in units) else self.unreachable
                target[norm(entry)].add(family)

    def families_of(self, word: str) -> set[str]:
        return self.words.get(norm(word), set())


def load_units() -> set[str]:
    """The unit inventory the POS tree is actually built from.

    buildPosTree reads `syllable.mapped.txt` (via loadMappedRows), not
    master.json["syllables"]. The mapped file is the authority: it is what
    says whether an entry can be reached at all.
    """
    path = ROOT / "Engine/.cache-tree/syllable.mapped.txt"
    units = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r'^"(.+?)"\s*:\s*"(.+?)"\s*:\s*"(.+?)"\s*$', line)
        if match:
            units.add(match.group(1))
    return units


def sentence_units(tokens: list[dict]) -> int:
    return sum(len(token.get("syllables") or []) for token in tokens)


def is_fragment(surface: str) -> bool:
    return bool(surface) and is_mark(surface[0])


def fragment_shape(tokens: list[dict], index: int) -> str:
    run_end = index
    while run_end + 1 < len(tokens) and is_fragment(tokens[run_end + 1]["surface"]):
        run_end += 1
    tail = "".join(token["surface"] for token in tokens[index:run_end + 1])
    if "္" in tail:
        return "virama"
    if "့" in tail:
        return "dot-below"
    if tail == "း":
        return "visarga"
    return "mark"


def classify_fragment(tokens: list[dict], index: int, dictionary: Dictionary) -> tuple[str, str]:
    """Rejoin the fragment run at `index` with 1–2 tokens back.

    Returns (bucket, rejoined) where bucket is one of:
      entry     the rejoined string is a dictionary word  -> the split broke a word
      syllable  the rejoined string is a known unit       -> the split broke a unit
      unknown   neither                                   -> suspect orthography
    """
    run_end = index
    while run_end + 1 < len(tokens) and is_fragment(tokens[run_end + 1]["surface"]):
        run_end += 1
    tail = "".join(token["surface"] for token in tokens[index:run_end + 1])
    for back in (1, 2, 3):
        if index - back < 0:
            break
        head = "".join(token["surface"] for token in tokens[index - back:index])
        candidate = head + tail
        if dictionary.families_of(candidate):
            return "entry", candidate
        if norm(candidate) in dictionary.unreachable:
            return "unreachable", candidate
        if norm(candidate) in dictionary.syllables:
            return "unit", candidate
    return "unknown", "".join(token["surface"] for token in tokens[max(0, index - 1):run_end + 1])


MEDIAL_RANK = {"\u103b": 1, "\u103c": 2, "\u103d": 3, "\u103e": 4}


def encoding_facts(body: str) -> dict:
    """Order-based damage signatures, independent of the dictionary.

    Three classes are safe to assert without guessing:

    zawgyi_e_prefix  U+1031 immediately before a consonant. Unicode stores the
                     vowel sign after its consonant (and after all medials), so
                     `အေခြ` can only come from Zawgyi-order storage. Renders as
                     `အခြေ`, the correct spelling of "situation".
    digit_for_letter  a Myanmar digit glued to a letter (`ဘ၀` for `ဘဝ`).
    medial_order     medials stored in the wrong order (ှ before ြ/ျ, ြ before ျ).
    """
    def contexts(pattern: str, limit: int = 8) -> tuple[int, list[str]]:
        hits = [m.start() for m in re.finditer(pattern, body)]
        seen, examples = set(), []
        for start in hits:
            window = re.sub(r"\s+", " ", body[max(0, start - 6): start + 8])
            if window not in seen:
                seen.add(window)
                examples.append(window)
            if len(examples) >= limit:
                break
        return len(hits), examples

    e_count, e_examples = contexts("\u1031[\u1000-\u102a]")
    digit_count, digit_examples = contexts("[\u1000-\u102a][\u1040-\u1049]|[\u1040-\u1049][\u1000-\u102a]")
    bad_medial = 0
    medial_examples: list[str] = []
    for first, second in zip(body, body[1:]):
        if first in MEDIAL_RANK and second in MEDIAL_RANK:
            if MEDIAL_RANK[first] > MEDIAL_RANK[second]:
                bad_medial += 1
                if len(medial_examples) < 8:
                    medial_examples.append(re.sub(r"\s+", " ", body[max(0, body.find(first) - 6): body.find(first) + 8]))
    return {
        "zawgyi_e_prefix": e_count,
        "zawgyi_e_examples": e_examples,
        "digit_for_letter": digit_count,
        "digit_examples": digit_examples,
        "medial_order": bad_medial,
        "medial_examples": medial_examples,
    }


def layout_facts(raw_body: str) -> dict:
    lines = [line for line in raw_body.splitlines()]
    non_empty = [line for line in lines if line.strip()]
    page_markers = sum(1 for line in lines if "--- Page" in line)
    trailing_space = sum(1 for line in lines if line != line.rstrip() and line.strip())
    blank = sum(1 for line in lines if not line.strip())
    wrapped = sum(1 for line in non_empty if not line.rstrip().endswith((FULLSTOP, COMMA)) and "Page" not in line)
    return {
        "lines": len(lines),
        "lines_non_empty": len(non_empty),
        "lines_blank": blank,
        "lines_page_marker": page_markers,
        "lines_trailing_space": trailing_space,
        "lines_ending_mid_sentence": wrapped,
        "max_line_chars": max((len(line) for line in non_empty), default=0),
    }


def profile_chapter(number: int, dictionary: Dictionary, top: int = 15) -> dict:
    title, body = chapter_text(number)
    sentences = tag_text(body)

    tokens = [token for sentence in sentences for token in sentence["tokens"]]
    word_count = len(tokens)
    unit_count = sum(sentence_units(sentence["tokens"]) for sentence in sentences)

    pos = Counter()
    for token in tokens:
        tags = [tag for tag in token["tags"] if tag]
        pos[tags[0] if tags else "?"] += 1

    fragments: list[tuple[str, str, str]] = []
    letter_unknown: Counter = Counter()
    symbol_unknown = 0
    for sentence in sentences:
        for index, token in enumerate(sentence["tokens"]):
            surface = token["surface"]
            if is_fragment(surface):
                bucket, rejoined = classify_fragment(sentence["tokens"], index, dictionary)
                fragments.append((bucket, rejoined, fragment_shape(sentence["tokens"], index)))
            elif "?" in token["tags"]:
                if has_myanmar_letter(surface):
                    letter_unknown[surface] += 1
                else:
                    symbol_unknown += 1

    fragment_buckets = Counter(bucket for bucket, _, _ in fragments)
    fragment_shapes = Counter(shape for _, _, shape in fragments)
    fragment_examples = Counter(joined for _, joined, _ in fragments)

    register = Counter()
    finals: Counter = Counter()
    for sentence in sentences:
        content = [token for token in sentence["tokens"] if token["surface"] not in {"“", "”"}]
        if not content:
            continue
        final = next(
            (token["surface"] for token in reversed(content) if not is_fragment(token["surface"])),
            content[-1]["surface"],
        )
        finals[final] += 1
        quoted = any("“" in token["surface"] or "”" in token["surface"] for token in sentence["tokens"])
        tail = "".join(token["surface"] for token in content[-3:])
        if quoted:
            register["dialogue"] += 1
        elif any(tail.endswith(marker) for marker in FORMAL_FINALS):
            register["formal_written"] += 1
        elif any(tail.endswith(marker) for marker in SPOKEN_FINALS):
            register["spoken"] += 1
        else:
            register["other"] += 1

    function = sum(pos[tag] for tag in ("w", "p", "cn"))
    content_words = sum(pos[tag] for tag in ("n", "v", "aj", "av", "pn"))

    # Spurious space: A B are separate tokens but A+B is one dictionary word.
    spurious = Counter()
    for sentence in sentences:
        for first, second in zip(sentence["tokens"], sentence["tokens"][1:]):
            joined = first["surface"] + second["surface"]
            if dictionary.families_of(joined) and not is_fragment(second["surface"]):
                spurious[joined] += 1

    source_spaces = body.count(" ") + body.count("\n")

    lengths = sorted(len(sentence["tokens"]) for sentence in sentences)
    def percentile(values: list[int], q: float) -> int:
        if not values:
            return 0
        return values[min(len(values) - 1, int(round(q * (len(values) - 1))))]
    glued_sentences = len(re.findall(r"။(?=[\u1000-\u102a])", body))
    glued_commas = len(re.findall(r"၊(?=[\u1000-\u102a])", body))
    word_freq = Counter(token["surface"] for token in tokens)
    content_freq = Counter(
        token["surface"] for token in tokens if "n" in token["tags"] or "v" in token["tags"]
    )

    return {
        "chapter": number,
        "title": title,
        "title_defect": title.rstrip().endswith(":"),
        "sentences": len(sentences),
        "words": word_count,
        "units": unit_count,
        "words_per_sentence": round(word_count / len(sentences), 2) if sentences else 0,
        "sentence_lengths": {
            "min": lengths[0] if lengths else 0,
            "median": percentile(lengths, 0.5),
            "p90": percentile(lengths, 0.9),
            "max": lengths[-1] if lengths else 0,
        },
        "top_words": word_freq.most_common(top),
        "top_content_words": content_freq.most_common(top),
        "units_per_word": round(unit_count / word_count, 2) if word_count else 0,
        "chars": len(norm(body)),
        "pos": dict(pos.most_common()),
        "function_words": function,
        "content_words": content_words,
        "function_ratio": round(function / word_count, 3) if word_count else 0,
        "fragments": len(fragments),
        "fragment_rate": round(len(fragments) / word_count, 4) if word_count else 0,
        "fragment_buckets": dict(fragment_buckets),
        "fragment_examples": fragment_examples.most_common(top),
        "letter_unknown": sum(letter_unknown.values()),
        "letter_unknown_examples": letter_unknown.most_common(top),
        "symbol_unknown": symbol_unknown,
        "register": dict(register),
        "register_ratio": {
            key: round(value / len(sentences), 3) for key, value in register.items()
        },
        "sentence_finals": finals.most_common(top),
        "connectives": {word: body.count(word) for word in CONNECTIVES if word in body},
        "spurious_spaces": sum(spurious.values()),
        "spurious_space_examples": spurious.most_common(top),
        "fragment_shapes": dict(fragment_shapes),
        "source_spaces": source_spaces,
        "space_coverage": round(source_spaces / word_count, 3) if word_count else 0,
        "encoding": encoding_facts(body),
        "spacing": {
            "glued_sentences": glued_sentences,
            "glued_commas": glued_commas,
            "trailing_space_lines": layout_facts(body)["lines_trailing_space"],
        },
        "layout": layout_facts(body),
    }


def profile_chinese(number: int) -> dict:
    from translate import chinese_chapters  # noqa: WPS433

    chapter = chinese_chapters()[number - 1]
    body = re.sub(r"[ \t]+", "", chapter.body)
    sentences = [piece for piece in re.split(r"(?<=[。！？])", body) if piece.strip()]
    chars = len(re.sub(r"\s+", "", body))
    return {
        "chapter": number,
        "title": chapter.title.strip(),
        "sentences": len(sentences),
        "chars": chars,
        "chars_per_sentence": round(chars / len(sentences), 2) if sentences else 0,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Profile Burmese chapters with the Engine")
    parser.add_argument("--chapter", type=int, action="append", required=True)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--top", type=int, default=15)
    args = parser.parse_args(argv)

    dictionary = Dictionary()
    result = {
        "dictionary": {
            "entries": dictionary.entries,
            "reachable": len(dictionary.words),
            "unreachable": len(dictionary.unreachable),
            "syllables": len(dictionary.syllables),
        },
        "chapters": [],
    }
    for number in args.chapter:
        burmese = profile_chapter(number, dictionary, top=args.top)
        chinese = profile_chinese(number)
        burmese["chinese"] = chinese
        burmese["expansion"] = round(burmese["chars"] / chinese["chars"], 2) if chinese["chars"] else 0
        result["chapters"].append(burmese)
        print(
            f"ch{number}: {burmese['sentences']} sentences, {burmese['words']} words, "
            f"{burmese['units']} units, fragments {burmese['fragments']} "
            f"({burmese['fragment_rate']:.2%}), letter-unknown {burmese['letter_unknown']}, "
            f"expansion {burmese['expansion']}× vs Chinese",
            file=sys.stderr,
        )

    payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(payload, encoding="utf-8")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
