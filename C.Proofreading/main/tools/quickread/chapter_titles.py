#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Chapter titles, both languages, straight out of the merged DOCX.

The bilingual DOCX alternates two heading paragraphs per PDF page:

    [ZH] 第一百九十三章:葉大人來了，青天就有了 — page 9/9
    [MY] အခန်း ၁၉၅ — page 9/9

This reads only those, so it never touches the body text, and answers the two
questions that would otherwise mean scrolling a 673 KB review or a 4 MB crawl:
*what is chapter 194 called* and *which Burmese chapter faces it*.

    python3 tools/chapter_titles.py                    # every title, numbered
    python3 tools/chapter_titles.py --at 194 --at 195   # just these
    python3 tools/chapter_titles.py --from 190          # a range
    python3 tools/chapter_titles.py --json               # machine-readable
    python3 tools/chapter_titles.py --write content/merged/titles.json

The DOCX carries the human-translated span only (Chinese 1–193 ↔ Burmese 1–195),
so a chapter past the end reports `null`, not an invented title. For those, the
crawled source is the only witness — `tools/audit_source.py` reads it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "mt"))

from chapter_map import (  # noqa: E402
    ChapterMapError,
    burmese_label,
    chinese_label,
    page_marker,
    read_headings,
)

DEFAULT_DOCX = ROOT / "content" / "merged" / "episodes.docx"
_HEAD = ("第", "章", ":：", "—", "-", "–")


def clean_title(text: str) -> str:
    """`[ZH] 第一百九十三章:葉大人來了 — page 9/9` -> `葉大人來了`.

    The page marker is dropped: it describes the PDF, not the chapter, and it is
    wrong for a third of the rows because one Chinese chapter can start mid-page.
    """
    body = text
    if "—" in body:
        body = body.rsplit("—", 1)[0]
    for prefix in ("[ZH]", "[MY]"):
        body = body.replace(prefix, "")
    body = body.strip()
    for separator in (":", "："):
        if separator in body:
            body = body.split(separator, 1)[1]
            break
    else:
        # `အခန်း ၁၉၅` has no title; do not echo the number back as one.
        if body.startswith(("အခန်း", "第")):
            return ""
    return body.strip(" :：—-–")


def read_titles(docx: Path = DEFAULT_DOCX) -> dict:
    """`{chinese_number: {title, burmese, burmese_title, page}}`, in order."""
    rows = read_headings(Path(docx))
    chapters: dict[int, dict] = {}
    pending: int | None = None
    for kind, text in rows:
        if kind == "zh":
            number = chinese_label(text)
            if number is not None:
                pending = number
                page = page_marker(text)
                entry = chapters.setdefault(
                    number, {"chinese": number, "title": "", "burmese": None,
                             "burmese_title": "", "page": None})
                entry["title"] = clean_title(text) or entry["title"]
                entry["page"] = page[0] if page else entry["page"]
            continue
        number = burmese_label(text)
        if number is None or pending is None:
            continue
        entry = chapters.setdefault(
            pending, {"chinese": pending, "title": "", "burmese": None,
                      "burmese_title": "", "page": None})
        if entry["burmese"] is None:
            entry["burmese"] = number
            entry["burmese_title"] = clean_title(text)
    return dict(sorted(chapters.items()))


def summarise(chapters: dict, total: int | None = None) -> dict:
    last = max(chapters) if chapters else 0
    return {
        "docx": str(DEFAULT_DOCX.name),
        "chapters": len(chapters),
        "span": [min(chapters), last] if chapters else [],
        "with_title": sum(1 for row in chapters.values() if row["title"]),
        "with_burmese": sum(1 for row in chapters.values() if row["burmese"]),
        "missing_in_span": [n for n in range(1, last + 1) if n not in chapters],
        "after_the_human_translation": total,
    }


def _print_rows(chapters: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(list(chapters.values()), indent=2, ensure_ascii=False))
        return
    for row in chapters.values():
        burmese = (f"{row['burmese']:>4}" if row["burmese"] is not None
                   else "   -")
        print(f"{row['chinese']:>4}  {burmese}  {row['title'][:70]}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Chapter titles from the bilingual DOCX, both languages.")
    parser.add_argument("--docx", type=Path, default=DEFAULT_DOCX)
    parser.add_argument("--at", type=int, action="append", default=[],
                        metavar="N", help="one chapter number; repeatable")
    parser.add_argument("--from", dest="start", type=int, default=None,
                        metavar="N", help="first chapter of a range")
    parser.add_argument("--to", dest="stop", type=int, default=None, metavar="N",
                        help="last chapter of a range")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--summary", action="store_true",
                        help="counts and gaps instead of the rows")
    parser.add_argument("--write", type=Path, default=None, metavar="PATH",
                        help="save the whole table as JSON")
    args = parser.parse_args(argv)

    if not args.docx.is_file():
        print(f"[titles] no DOCX at {args.docx}", file=sys.stderr)
        return 4
    try:
        chapters = read_titles(args.docx)
    except (ChapterMapError, KeyError, OSError) as error:
        print(f"[titles] {error}", file=sys.stderr)
        return 4

    if args.summary:
        print(json.dumps(summarise(chapters), indent=2, ensure_ascii=False))
        return 0

    chosen = chapters
    if args.at:
        chosen = {n: chapters.get(n, {"chinese": n, "title": "", "burmese": None,
                                      "burmese_title": "", "page": None})
                  for n in args.at}
    elif args.start is not None or args.stop is not None:
        low = args.start if args.start is not None else min(chapters, default=1)
        high = args.stop if args.stop is not None else max(chapters, default=0)
        chosen = {n: row for n, row in chapters.items() if low <= n <= high}

    _print_rows(chosen, args.json)

    if args.write:
        args.write.parent.mkdir(parents=True, exist_ok=True)
        args.write.write_text(
            json.dumps(list(chapters.values()), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8")
        print(f"[titles] wrote {args.write}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
