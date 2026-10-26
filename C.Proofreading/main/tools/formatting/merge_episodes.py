# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Merge the Chinese original and the Burmese version episode by episode.

Output shape:

    [episode 1]

    Chinese original
    ----------------
    這些人口，可都是大周的底子。

    Burmese version
    ---------------
    ဤလူများသည် မဟာကျိုးပြည်ထောင်၏ အေခြခံဖြစ်သည်။

Pairing modes (`--pair`):

    order     pair in file order: episode N is Chinese chapter N of the Chinese
              file and Burmese chapter N of the Burmese file (unverified).
    map       pair with an explicit JSON list [{"chinese": N, "burmese": M}],
              or an object {"caution": ..., "pairs": [...]}.
    verified  the hardcoded, content-checked alignment (recommended).

What the two supplied files contain, measured and manually verified:

    Chinese  content/source/chinese-0511241012-from-8011_1.txt   chapters 1 .. 408
    Burmese  content/source/ယဲ့နင်.txt                            native headings, chapters 1 .. 195

The Chinese crawl carries OCR-damaged chapter titles (第六四意 for 64;
第一百八十ー章 / 第一百ハ十一章 for 181), bare-number headers, inline titles glued
inside the previous section, and re-fetched duplicate fragments. The Burmese
edition split two long Chinese chapters: Chinese 61 -> Burmese 61+62 and
Chinese 137 -> Burmese 138+139. Opening-paragraph comparison therefore gives:

    Burmese 1..61    = Chinese 1..61     (1:1)
    Burmese 62       = Chinese 61        (split)
    Burmese 63..138  = Chinese 62..137   (offset -1)
    Burmese 139      = Chinese 137       (split)
    Burmese 140..195 = Chinese 138..193  (offset -2)

Anchor: Burmese 195 = Chinese 193 (`這些人口，可都是大周的底子` /
`ဤလူများသည် မဟာကျိုးပြည်ထောင်၏ အေခြခံဖြစ်သည်`). Evidence per pair is recorded
in content/merged/pairs-verified.json.

    # full merge incl. Chinese chapters without a Burmese counterpart
    python3 format/merge_episodes.py --pair verified -o content/merged/episodes.txt
    # one-to-one rows only, capped at the Burmese-covered range (Chinese <= 194)
    python3 format/merge_episodes.py --pair verified --only-matched --max-chinese 194 \
        -o content/merged/episodes.txt --report content/merged/pairs.json
    python3 format/merge_episodes.py --pair map --map pairs.json

Machine columns (`--with`, repeatable). They are read from `content/mtranslate/<route>/`:

    zh-en   machine English of the Chinese chapter -- the intermediate the
            translator actually used before restyling into Burmese
    my-en   back-translation of the published Burmese into English -- a drift
            check, not a source
    my-zh   back-translation of the published Burmese into Chinese -- drift check

A column whose output does not exist is printed as `(not run: ...)`; nothing is
invented and no column changes the pairing.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CHINESE = ROOT / "content" / "source" / "chinese-0511241012-from-8011_1.txt"
BURMESE = ROOT / "content" / "source" / "ယဲ့နင်.txt"
OUTPUT = ROOT / "content" / "merged"
MT = ROOT / "content" / "mtranslate"
COLUMNS = {
    "zh-en": ("Chinese to English (machine)", "ch{:04d}.en.txt", None),
    "en-zh": ("English to Chinese (machine back-translation)", "ch{:04d}.zh.txt", None),
    "zh-my": ("Chinese to Burmese (dictionary gloss, not MT)", "ch{:04d}.my.txt",
              "CC-CEDICT glosses mapped through the English-Myanmar dictionary; "
              "no Chinese-Burmese translation model exists offline"),
    "my-en": ("Burmese to English back-translation (drift check)", "m{:04d}.en.txt", None),
    "my-zh": ("Burmese to Chinese back-translation (drift check)", "m{:04d}.zh.txt", None),
}

_DIGITS = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
_BURMESE_DIGITS = {chr(0x1040 + index): str(index) for index in range(10)}


def chinese_number(text: str) -> int:
    total = digit = 0
    for char in text:
        if char in _DIGITS:
            digit = _DIGITS[char]
        elif char == "十":
            total, digit = total + (digit or 1) * 10, 0
        elif char == "百":
            total, digit = total + (digit or 1) * 100, 0
        elif char == "千":
            total, digit = total + (digit or 1) * 1000, 0
    return total + digit


def burmese_number(text: str) -> int | None:
    digits = "".join(_BURMESE_DIGITS.get(char, char) for char in text)
    match = re.search(r"\d+", digits)
    return int(match.group(0)) if match else None


@dataclass
class Episode:
    order: int
    label: int | None
    title: str
    body: str


# Crawler OCR damage seen in the source: katakana ー for 一, ハ for 八, and
# 意 for 章 (第六四意). Inline titles inside an unsplit section use the same
# shapes, so the numeral class and an 意-variant are accepted everywhere.
_CN_NUMERALS = "一二三四五六七八九十百千零〇ーハ"
_CN_TITLE = re.compile(r"第([" + _CN_NUMERALS + r"]+)[章意]")
_CN_BARE = re.compile(r"^===== (\d+) =====$")
_GARBLED_GLYPH = str.maketrans({"ー": "一", "ハ": "八"})
_CN_DIGIT = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
             "六": 6, "七": 7, "八": 8, "九": 9}


def _cn_label(numerals: str) -> int:
    """Chapter number from a title numeral run, tolerating OCR-garbled titles."""
    numerals = numerals.translate(_GARBLED_GLYPH)
    if not any(unit in numerals for unit in "十百千"):
        # Garbled form with the unit dropped, e.g. 六四 for 六十四.
        total = 0
        for char in numerals:
            total = total * 10 + _CN_DIGIT[char]
        return total
    return chinese_number(numerals)


def _chinese_boundaries(lines: list[str]) -> list[tuple[int, int, int, int, str]]:
    """All chapter starts: (line index, title start cut, title end cut, label, title)."""
    bounds: list[tuple[int, int, int, int, str]] = []
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("===== "):
            title = stripped.strip("= ").strip()
            match = _CN_TITLE.match(title)
            bare = re.fullmatch(r"\d+", title)
            if match:
                bounds.append((index, 0, len(line), _cn_label(match.group(1)), title))
            elif bare:
                bounds.append((index, 0, len(line), int(bare.group()), title))
        elif not stripped.startswith("[[KMTCRAWLER"):
            for match in _CN_TITLE.finditer(line):
                bounds.append((index, match.start(), match.end(),
                               _cn_label(match.group(1)), match.group(0).strip()))
    return bounds


def chinese_episodes(path: Path = CHINESE) -> list[Episode]:
    lines = path.read_text(encoding="utf-8").split("\n")
    bounds = _chinese_boundaries(lines)
    episodes: list[Episode] = []
    for order, (index, start_cut, end_cut, label, title) in enumerate(bounds, 1):
        if order < len(bounds):
            end_line, end_start = bounds[order][0], bounds[order][1]
        else:
            end_line, end_start = len(lines), 0
        if start_cut or end_cut:
            segment = [lines[index][end_cut:]] + lines[index + 1:end_line]  # inline title
        else:
            segment = lines[index + 1:end_line]                             # ===== header line
        if end_start and segment:
            segment[-1] = segment[-1][:end_start]
        episodes.append(Episode(order, label, title, "\n".join(segment).strip()))
    return episodes


# Content-verified chapter alignment, established by reading one opening
# paragraph per chapter on both sides (evidence in pairs-verified.json).
# Segments: (Burmese label range, Chinese label range), 1:1 inside each.
VERIFIED_SEGMENTS = [
    ((1, 61), (1, 61)),
    ((62, 62), (61, 61)),    # ZH61 split across Burmese 61 + 62
    ((63, 138), (62, 137)),
    ((139, 139), (137, 137)),  # ZH137 split across Burmese 138 + 139
    ((140, 195), (138, 193)),
]


def verified_pairs() -> list[dict[int, int]]:
    pairs: list[dict[int, int]] = []
    for (b_lo, b_hi), (c_lo, c_hi) in VERIFIED_SEGMENTS:
        for burmese, chinese in zip(range(b_lo, b_hi + 1), range(c_lo, c_hi + 1)):
            pairs.append({"chinese": chinese, "burmese": burmese})
    return pairs


# Native PDF-extracted headings: "Chapter 1:", "Chapter - 124 (subtitle)",
# "အခန်း (၅)", "အခန်း ၁၈", "အခန်း - 84", "အပိုင်း ၅၁", plus split parts
# "အခန်း (၅၉) ၁ / ၂". The digit slot also admits ရ, an OCR misread of ၇,
# repaired by chapter-sequence inference below.
_BURMESE_HEADING = re.compile(
    r"^Chapter\s*[\-\u2013:]?\s*(?P<cn>\d+)\b"
    r"|^(?:အခန်း|အပိုင်း)\s*[\-\u2013（(]?\s*"
    r"(?P<bn>[၀-၉0-9ရ]+)\s*[）)]?(?:\s*(?P<part>[၁၂]))?\s*$"
)


def _burmese_native_heads(lines: list[str]) -> list[tuple[int, int | None, str]]:
    """(line index, chapter label or None pending inference, heading title)."""
    heads: list[tuple[int, int | None, str]] = []
    for index, line in enumerate(lines):
        match = _BURMESE_HEADING.match(line.strip())
        if not match:
            continue
        if match.group("cn"):
            label: int | None = int(match.group("cn"))
        else:
            label = burmese_number(match.group("bn"))
        heads.append((index, label, line.strip()))
    for order, (index, label, title) in enumerate(heads):
        if label is None:
            previous = heads[order - 1][1] if order else None
            upcoming = next((item[1] for item in heads[order + 1:] if item[1] is not None), None)
            if previous is not None and upcoming == previous + 2:
                heads[order] = (index, previous + 1, title)
    return heads


def burmese_episodes(path: Path = BURMESE) -> list[Episode]:
    lines = path.read_text(encoding="utf-8").split("\n")
    marks = [index for index, line in enumerate(lines) if line.startswith("[[HCRAWLER MARKER")]
    if marks:
        episodes = []
        for order, index in enumerate(marks, 1):
            end = marks[order] if order < len(marks) else len(lines)
            title = lines[index + 1].strip() if index + 1 < len(lines) else ""
            episodes.append(Episode(order, burmese_number(title), title,
                                    "\n".join(lines[index + 2:end]).strip()))
        return episodes
    # No crawler markers: split on the native headings of the PDF text.
    heads = _burmese_native_heads(lines)
    episodes: list[Episode] = []
    for order, (index, label, title) in enumerate(heads):
        end = heads[order + 1][0] if order + 1 < len(heads) else len(lines)
        body = "\n".join(lines[index + 1:end]).strip()
        if episodes and episodes[-1].label == label:
            # Split chapter (e.g. 59 part 1 / part 2): join into one episode.
            episodes[-1] = Episode(episodes[-1].order, label, episodes[-1].title,
                                   episodes[-1].body + "\n\n" + body)
        else:
            episodes.append(Episode(len(episodes) + 1, label, title, body))
    return episodes


def mt_text(route: str, number: int | None) -> tuple[str | None, str]:
    """Text of one MT column for one chapter, or (None, reason)."""
    if number is None:
        return None, "no chapter on this side"
    label, pattern, _note = COLUMNS[route]
    path = MT / route / "chapters" / pattern.format(number)
    if path.is_file():
        body = path.read_text(encoding="utf-8").split("\n")
        if len(body) > 1 and body[1] and set(body[1]) == {"="}:
            body = body[2:]          # chapter title and its underline
        else:
            body = body[1:]
        return "\n".join(body).strip(), str(path.relative_to(ROOT))
    return None, f"{path.relative_to(ROOT)} not produced yet"


def render(pairs: list[tuple[int | None, int | None]], chinese: list[Episode],
           burmese: list[Episode], mode: str, caution: str,
           columns: list[str] | None = None) -> str:
    chunks = [f"# Bilingual episode merge\n# pairing: {mode}\n# {caution}\n"]
    for number, (c_index, b_index) in enumerate(pairs, 1):
        c_episode = chinese[c_index] if c_index is not None else None
        b_episode = burmese[b_index] if b_index is not None else None
        bits = []
        if c_episode:
            bits.append(f"Chinese {c_episode.title}")
        if b_episode:
            bits.append(f"Burmese {b_episode.title}")
        chunks.append(f"\n[episode {number}]\n")
        if bits:
            chunks.append("(" + " | ".join(bits) + ")\n")
        chunks.append("\nChinese original\n----------------\n")
        chunks.append((c_episode.body if c_episode else "(no counterpart)") + "\n")
        for route in columns or []:
            heading, _pattern, caveat = COLUMNS[route]
            number = c_episode.label if route in ("zh-en", "zh-my") else (
                b_episode.label if route.startswith("my-") else c_episode.label)
            text, note = mt_text(route, number)
            chunks.append(f"\n{heading}\n{'-' * len(heading)}\n")
            if caveat:
                chunks.append(f"({caveat})\n\n")
            chunks.append((text if text else f"(not run: {note})") + "\n")
        chunks.append("\nBurmese version\n---------------\n")
        chunks.append((b_episode.body if b_episode else "(no counterpart)") + "\n")
    return "".join(chunks)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pair", choices=["order", "map", "verified"], default="order")
    parser.add_argument("--map", type=Path, help="JSON list of {chinese, burmese} chapter numbers")
    parser.add_argument("--chinese", type=Path, default=CHINESE)
    parser.add_argument("--burmese", type=Path, default=BURMESE)
    parser.add_argument("-o", "--output", type=Path, default=OUTPUT / "episodes.txt")
    parser.add_argument("--report", type=Path, default=OUTPUT / "pairs.json")
    parser.add_argument("--first", type=int, default=None, help="write only the first N episodes")
    parser.add_argument("--only-matched", action="store_true",
                        help="omit chapters that have no counterpart")
    parser.add_argument("--max-chinese", type=int, default=None,
                        help="drop pairs whose Chinese chapter number is above N (e.g. 194 keeps the Burmese-covered range)")
    parser.add_argument("--with", dest="columns", action="append", choices=sorted(COLUMNS),
                        default=[], help="add an MT column; repeatable")
    args = parser.parse_args(argv)

    chinese = chinese_episodes(args.chinese)
    burmese = burmese_episodes(args.burmese)
    print(f"[merge] Chinese chapters: {len(chinese)} ({chinese[0].label}..{chinese[-1].label})")
    print(f"[merge] Burmese chapters: {len(burmese)} ({burmese[0].label}..{burmese[-1].label})")

    if args.pair == "order":
        count = min(len(chinese), len(burmese))
        pairs: list[tuple[int | None, int | None]] = [(index, index) for index in range(count)]
        pairs += [(index, None) for index in range(count, len(chinese))]
        pairs += [(None, index) for index in range(count, len(burmese))]
        caution = ("positional pairing: episode N is Chinese chapter N of the Chinese file and "
                   "Burmese chapter N of the Burmese file -- not verified as a translation pair")
    else:
        if args.pair == "verified":
            mapping = verified_pairs()
            map_caution = (
                "content-verified alignment by opening-paragraph comparison: "
                "Burmese 1..61 = Chinese 1..61; Chinese 61 split across Burmese 61+62; "
                "Burmese 63..138 = Chinese 62..137; Chinese 137 split across Burmese 138+139; "
                "Burmese 140..195 = Chinese 138..193. Anchor: Burmese 195 = Chinese 193 "
                "(這些人口，可都是大周的底子). Chinese 194..408 have no Burmese counterpart."
            )
        else:
            if not args.map:
                parser.error("--pair map needs --map")
            map_doc = json.loads(args.map.read_text(encoding="utf-8"))
            if isinstance(map_doc, dict):
                mapping, map_caution = map_doc.get("pairs", []), map_doc.get("caution")
            else:
                mapping, map_caution = map_doc, None
        # Garbled re-fetches repeat a label; the fullest episode is the real chapter.
        by_chinese: dict[int, int] = {}
        for index, episode in enumerate(chinese):
            if episode.label is None:
                continue
            current = by_chinese.get(episode.label)
            if current is None or len(episode.body) > len(chinese[current].body):
                by_chinese[episode.label] = index
        by_burmese = {episode.label: index for index, episode in enumerate(burmese)}
        pairs = []
        for item in mapping:
            c_index = by_chinese.get(item["chinese"])
            b_index = by_burmese.get(item["burmese"])
            if c_index is None or b_index is None:
                print(f"[merge] skipped {item}: chapter not found", file=sys.stderr)
                continue
            pairs.append((c_index, b_index))
        used_c = {index for index, _ in pairs}
        used_b = {index for _, index in pairs}
        pairs += [(index, None) for index in range(len(chinese)) if index not in used_c]
        pairs += [(None, index) for index in range(len(burmese)) if index not in used_b]
        pairs.sort(key=lambda pair: (pair[0] if pair[0] is not None else 10 ** 6,
                                     pair[1] if pair[1] is not None else 10 ** 6))
        caution = map_caution or "explicit map supplied by --map"

    if args.only_matched:
        pairs = [(c, b) for c, b in pairs if c is not None and b is not None]
    if args.max_chinese is not None:
        pairs = [(c, b) for c, b in pairs
                 if c is None or chinese[c].label <= args.max_chinese]
    if args.first:
        pairs = pairs[:args.first]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render(pairs, chinese, burmese, args.pair, caution, args.columns),
                           encoding="utf-8")

    matched = sum(1 for c, b in pairs if c is not None and b is not None)
    report = {
        "pairing": args.pair,
        "caution": caution,
        "output": str(args.output),
        "chinese_chapters": len(chinese),
        "burmese_chapters": len(burmese),
        "episodes_written": len(pairs),
        "matched_pairs": matched,
        "unmatched_chinese": sum(1 for c, b in pairs if b is None),
        "unmatched_burmese": sum(1 for c, b in pairs if c is None),
        "mt_columns": args.columns,
        "mt_present": {route: sum(1 for _ in (MT / route / "chapters").glob("*"))
                       if (MT / route / "chapters").is_dir() else 0
                       for route in args.columns},
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[merge] {len(pairs)} episodes written, {matched} paired -> {args.output}")
    print(f"[merge] report -> {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
