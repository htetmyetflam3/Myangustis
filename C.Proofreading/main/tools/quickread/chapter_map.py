#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Read the chapter map straight out of the merged bilingual DOCX.

The merged DOCX alternates a heading pair per PDF page:

    [ZH] 第一百九十三章:葉大人來了，青天就有了 — page 9/9
    [MY] အခန်း ၁၉၅ — page 9/9

so every Chinese chapter knows exactly which Burmese chapter (or chapters)
face it, without guessing an offset. This is the number the comparison and the
"what comes next" questions should use.

Measured from `content/merged/episodes.docx` (2026-10-21):

    Chinese 1..193 ↔ Burmese 1..195
    Chinese 61  → Burmese 61 + 62     (the Burmese edition split the chapter)
    Chinese 137 → Burmese 138 + 139   (same)
    Chinese 194..  no Burmese counterpart

OCR forms that are handled, because the DOCX contains all of them:

- `第六四意` (chapter character replaced), `第九十二章:…` and bare `92`
- `Chapter 1: …`, `အခန်း (၅)`, `အခန်း(၆)`, `အခန်း(ရ)` (letter ရ for ၇),
  `အခန်း94` (Arabic digits) and `အခန်း ၁၉၅`

    python3 mt/chapter_map.py                       # summary
    python3 mt/chapter_map.py --at 61 --at 193      # look one up
    python3 mt/chapter_map.py --json                # machine-readable map
    python3 mt/chapter_map.py --write content/merged/chapter-map.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from translate import chinese_number  # noqa: E402

DEFAULT_DOCX = ROOT / "content" / "merged" / "episodes.docx"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

_ZH_CHAPTER = re.compile(r"第([一二三四五六七八九十百千零〇ーハ]+)[章意]")
_ZH_BARE = re.compile(r"(\d{1,4})(?:\s*$|\s*[—–-])")
_MY_CHAPTER = re.compile(
    r"(?:Chapter|အခန်း|အပိုင်း)\s*[-–—:：]?\s*[\(（]?\s*([0-9၀-၉ရ]+)")
_PAGE = re.compile(r"—\s*page\s*(\d+)\s*/\s*(\d+)\s*$")

_CN_DIGIT = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
             "六": 6, "七": 7, "八": 8, "九": 9}
_MY_DIGIT = {chr(0x1040 + i): i for i in range(10)}


class ChapterMapError(Exception):
    """The DOCX does not contain the expected heading pairs."""


def chinese_label(text: str) -> int | None:
    """Chapter number of a `[ZH]` heading, including the damaged forms.

    `第六四意` is OCR for 64 and has no 十/百/千, so its numerals are read as
    concatenated digits. `92` is accepted as a bare heading.
    """
    match = _ZH_CHAPTER.search(text)
    if match:
        numerals = match.group(1).translate({ord("ー"): "一", ord("ハ"): "八"})
        if not any(unit in numerals for unit in "十百千"):
            total = 0
            for char in numerals:
                if char not in _CN_DIGIT:
                    return None
                total = total * 10 + _CN_DIGIT[char]
            return total
        return chinese_number(numerals)
    bare = _ZH_BARE.search(text.replace("[ZH]", " ", 1).strip())
    return int(bare.group(1)) if bare else None


def burmese_label(text: str) -> int | None:
    """Chapter number of a `[MY]` heading in Burmese or Arabic digits."""
    match = _MY_CHAPTER.search(text)
    if not match:
        return None
    digits = match.group(1).replace("ရ", str(7))
    total = 0
    for char in digits:
        value = _MY_DIGIT.get(char)
        if value is None:
            if not char.isdigit():
                return None
            value = int(char)
        total = total * 10 + value
    return total


def page_marker(text: str) -> tuple[int, int] | None:
    match = _PAGE.search(text)
    return (int(match.group(1)), int(match.group(2))) if match else None


def read_headings(docx: Path) -> list[tuple[str, str]]:
    """The `[ZH]`/`[MY]` heading paragraphs, in document order."""
    rows: list[tuple[str, str]] = []
    with ZipFile(docx) as archive, archive.open("word/document.xml") as xml:
        for _, element in ET.iterparse(xml, events=("end",)):
            if element.tag != W + "p":
                continue
            text = "".join(node.text or "" for node in element.iter(W + "t")).strip()
            element.clear()
            if text.startswith("[ZH]"):
                rows.append(("zh", text))
            elif text.startswith("[MY]"):
                rows.append(("my", text))
    return rows


@dataclass
class ChapterMap:
    pairs: list[tuple[int, int]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.by_chinese: dict[int, list[int]] = {}
        self.by_burmese: dict[int, int] = {}
        for chinese, burmese in self.pairs:
            self.by_chinese.setdefault(chinese, []).append(burmese)
            self.by_burmese[burmese] = chinese

    # -- questions ----------------------------------------------------

    @property
    def chinese_covered(self) -> list[int]:
        return sorted(self.by_chinese)

    @property
    def burmese_chapters(self) -> list[int]:
        return sorted(self.by_burmese)

    @property
    def last_chinese(self) -> int | None:
        covered = self.chinese_covered
        return covered[-1] if covered else None

    @property
    def last_burmese(self) -> int | None:
        chapters = self.burmese_chapters
        return chapters[-1] if chapters else None

    @property
    def next_chinese(self) -> int | None:
        """First Chinese chapter after the covered range."""
        last = self.last_chinese
        return last + 1 if last is not None else None

    def splits(self) -> dict[int, list[int]]:
        return {chinese: numbers for chinese, numbers in self.by_chinese.items()
                if len(numbers) > 1}

    def summary(self) -> dict:
        covered = self.chinese_covered
        return {
            "chinese_covered": [covered[0], covered[-1]] if covered else None,
            "burmese_covered": ([self.burmese_chapters[0], self.burmese_chapters[-1]]
                                if self.burmese_chapters else None),
            "chinese_chapters": len(covered),
            "burmese_chapters": len(self.burmese_chapters),
            "last_existing": {
                "chinese": self.last_chinese,
                "burmese": self.by_chinese.get(self.last_chinese, []) if covered else [],
            },
            "next_without_reference": self.next_chinese,
            "splits": self.splits(),
            "warnings": self.warnings,
        }

    def as_dict(self) -> dict:
        return {
            "docx": None,
            "pairs": [{"chinese": chinese, "burmese": burmese}
                      for chinese, burmese in self.pairs],
            **self.summary(),
        }


def build_map(rows: list[tuple[str, str]]) -> ChapterMap:
    """Pair each `[MY]` heading with the `[ZH]` heading it faces."""
    chapter_map = ChapterMap()
    seen: set[tuple[int, int]] = set()
    chinese: int | None = None
    chinese_page: tuple[int, int] | None = None
    previous_burmese: int | None = None
    for kind, text in rows:
        if kind == "zh":
            number = chinese_label(text)
            if number is not None:
                chinese, chinese_page = number, page_marker(text)
            continue
        number = burmese_label(text)
        if number is None:
            chapter_map.warnings.append(f"unreadable Burmese heading: {text[:80]}")
            continue
        if chinese is None:
            chapter_map.warnings.append(f"Burmese heading without a Chinese one: {text[:80]}")
            continue
        page = page_marker(text)
        if chinese_page and page and page[0] != chinese_page[0]:
            chapter_map.warnings.append(
                f"page mismatch for Chinese {chinese} / Burmese {number}: "
                f"ZH page {chinese_page[0]}, MY page {page[0]}")
            continue
        if previous_burmese is not None and number == previous_burmese:
            continue
        if (chinese, number) in seen:
            continue
        seen.add((chinese, number))
        chapter_map.pairs.append((chinese, number))
        previous_burmese = number
    chapter_map.__post_init__()
    _check_contiguous(chapter_map)
    return chapter_map


def _check_contiguous(chapter_map: ChapterMap) -> None:
    chinese = chapter_map.chinese_covered
    if chinese:
        missing = sorted(set(range(chinese[0], chinese[-1] + 1)) - set(chinese))
        if missing:
            chapter_map.warnings.append(f"Chinese chapters missing a heading: {missing[:10]}")
    burmese = chapter_map.burmese_chapters
    if burmese:
        missing = sorted(set(range(burmese[0], burmese[-1] + 1)) - set(burmese))
        if missing:
            chapter_map.warnings.append(f"Burmese chapters missing a heading: {missing[:10]}")
    ordered = chapter_map.pairs
    for (left_zh, left_my), (right_zh, right_my) in zip(ordered, ordered[1:]):
        if right_zh < left_zh or right_my < left_my:
            chapter_map.warnings.append(
                f"order goes backwards at Chinese {left_zh}→{right_zh} "
                f"(Burmese {left_my}→{right_my})")
            break


def load_map(docx: Path = DEFAULT_DOCX) -> ChapterMap:
    if not Path(docx).is_file():
        raise ChapterMapError(f"no DOCX at {docx}")
    chapter_map = build_map(read_headings(Path(docx)))
    if not chapter_map.pairs:
        raise ChapterMapError(f"no [ZH]/[MY] heading pairs found in {docx}")
    return chapter_map


def load_or_derive(map_path: Path | None, docx: Path = DEFAULT_DOCX) -> ChapterMap:
    """Use a saved map when present, otherwise read the DOCX."""
    if map_path and Path(map_path).is_file():
        data = json.loads(Path(map_path).read_text(encoding="utf-8"))
        pairs = [(int(row["chinese"]), int(row["burmese"])) for row in data["pairs"]]
        return ChapterMap(pairs, list(data.get("warnings") or []))
    return load_map(docx)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--docx", type=Path, default=DEFAULT_DOCX)
    parser.add_argument("--at", type=int, action="append", default=[],
                        help="look up Chinese chapter N (repeatable)")
    parser.add_argument("--burmese", type=int, action="append", default=[],
                        help="look up Burmese chapter N (repeatable)")
    parser.add_argument("--json", action="store_true", help="print the whole map")
    parser.add_argument("--write", type=Path, default=None,
                        help="save the map as JSON and print the path")
    args = parser.parse_args(argv)

    try:
        chapter_map = load_map(args.docx)
    except (ChapterMapError, OSError, KeyError) as error:
        print(f"[map] {error}", file=sys.stderr)
        return 2

    if args.json or args.write:
        payload = chapter_map.as_dict()
        payload["docx"] = str(args.docx)
        text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        if args.write:
            args.write.parent.mkdir(parents=True, exist_ok=True)
            args.write.write_text(text, encoding="utf-8")
            print(args.write)
        if args.json:
            sys.stdout.write(text)
        return 0

    summary = chapter_map.summary()
    if args.at or args.burmese:
        for number in args.at:
            found = chapter_map.by_chinese.get(number)
            print(f"Chinese {number}: Burmese {', '.join(map(str, found))}"
                  if found else f"Chinese {number}: no existing Burmese")
        for number in args.burmese:
            found = chapter_map.by_burmese.get(number)
            print(f"Burmese {number}: Chinese {found}"
                  if found else f"Burmese {number}: no Chinese counterpart")
        if summary["warnings"]:
            for warning in summary["warnings"]:
                print(f"warning: {warning}", file=sys.stderr)
        return 0

    span = summary["chinese_covered"]
    bspan = summary["burmese_covered"]
    print(f"docx: {args.docx}")
    print(f"Chinese chapters with a Burmese counterpart: {span[0]}–{span[1]} "
          f"({summary['chinese_chapters']})")
    print(f"Burmese chapters present: {bspan[0]}–{bspan[1]} "
          f"({summary['burmese_chapters']})")
    for chinese, numbers in summary["splits"].items():
        print(f"split: Chinese {chinese} → Burmese "
              f"{' + '.join(map(str, numbers))}")
    last = summary["last_existing"]
    print(f"last existing Burmese chapter: {' + '.join(map(str, last['burmese']))} "
          f"↔ Chinese {last['chinese']}")
    print(f"next Chinese chapter without a Burmese counterpart: "
          f"{summary['next_without_reference']}")
    for warning in summary["warnings"]:
        print(f"warning: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
