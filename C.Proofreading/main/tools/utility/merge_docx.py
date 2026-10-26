# /// script
# requires-python = ">=3.10"
# dependencies = ["python-docx"]
# ///
"""Build a facing-page bilingual DOCX from the verified chapter alignment.

Layout, one physical page per slot:

    page 1  Chinese  chapter 1, page 1
    page 2  Burmese  chapter 1, page 1
    page 3  Chinese  chapter 1, page 2
    page 4  Burmese  chapter 1, page 2
    ...

Both sides of a chapter are balanced onto the same number of pages (character-
weighted, paragraph-aware), so every facing page exists in both languages and
there are no blank pages. Pagination is a character-budget approximation
because DOCX has no rendered page geometry; adjust granularity with
--chars-zh / --chars-my.

The chapter pairing is the hardcoded content-verified table in
merge_episodes.py (--pair verified there). Pure python-docx output: no
LibreOffice or any office suite is involved.

    python3 format/merge_docx.py -o content/merged/episodes.docx
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from merge_episodes import (  # noqa: E402
    BURMESE,
    CHINESE,
    OUTPUT,
    burmese_episodes,
    chinese_episodes,
    verified_pairs,
)

MYANMAR_FONT = "Noto Sans Myanmar"
CJK_FONT = "SimSun"


def page_chunks(body: str, target: int) -> list[list[str]]:
    """Greedy paragraph fill up to roughly `target` characters per page."""
    paragraphs = [line.strip() for line in body.split("\n") if line.strip()]
    chunks: list[list[str]] = []
    current: list[str] = []
    size = 0
    for paragraph in paragraphs:
        if current and size + len(paragraph) > target:
            chunks.append(current)
            current, size = [], 0
        current.append(paragraph)
        size += len(paragraph)
    if current:
        chunks.append(current)
    return chunks or [[]]


def balanced_chunks(body: str, count: int) -> list[list[str]]:
    """Split into exactly `count` contiguous, character-balanced page chunks."""
    paragraphs = [line.strip() for line in body.split("\n") if line.strip()]
    if count >= len(paragraphs):
        chunks = [[p] for p in paragraphs]
        chunks += [[] for _ in range(count - len(chunks))]
        return chunks
    total = sum(len(p) for p in paragraphs)
    chunks: list[list[str]] = [[] for _ in range(count)]
    cumulative = 0
    index = 0
    for paragraph in paragraphs:
        while index < count - 1 and cumulative >= (index + 1) * total / count:
            index += 1
        chunks[index].append(paragraph)
        cumulative += len(paragraph)
    return chunks


def configure_fonts(document: Document) -> None:
    normal = document.styles["Normal"]
    normal.font.name = MYANMAR_FONT
    normal.font.size = Pt(11)
    rfonts = normal.element.get_or_add_rPr().get_or_add_rFonts()
    rfonts.set(qn("w:eastAsia"), CJK_FONT)
    rfonts.set(qn("w:ascii"), MYANMAR_FONT)
    rfonts.set(qn("w:hAnsi"), MYANMAR_FONT)


def add_page(document: Document, page_count: int, page_index: int,
             language: str, title: str, paragraphs: list[str], first_page: bool) -> None:
    tag = document.add_paragraph()
    tag.paragraph_format.space_after = Pt(2)
    if not first_page:
        tag.paragraph_format.page_break_before = True
    run = tag.add_run(f"[{language}] {title} — page {page_index + 1}/{page_count}")
    run.bold = True
    run.font.size = Pt(10)
    if page_index == 0:
        heading = document.add_paragraph()
        heading.paragraph_format.space_after = Pt(6)
        heading_run = heading.add_run(title)
        heading_run.bold = True
        heading_run.font.size = Pt(14)
    if paragraphs:
        for text in paragraphs:
            document.add_paragraph(text)
    else:
        note = document.add_paragraph()
        note.alignment = WD_ALIGN_PARAGRAPH.CENTER
        note_run = note.add_run(f"({language} chapter ends)")
        note_run.italic = True
        note_run.font.size = Pt(10)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--chinese", type=Path, default=CHINESE)
    parser.add_argument("--burmese", type=Path, default=BURMESE)
    parser.add_argument("-o", "--output", type=Path, default=OUTPUT / "episodes.docx")
    parser.add_argument("--chars-zh", type=int, default=450,
                        help="Chinese page-size budget; sets page granularity (default 450)")
    parser.add_argument("--chars-my", type=int, default=1500,
                        help="Burmese page-size budget; sets page granularity (default 1500)")
    parser.add_argument("--limit", type=int, default=None,
                        help="only the first N paired chapters (pilot run)")
    args = parser.parse_args(argv)

    chinese = chinese_episodes(args.chinese)
    burmese = burmese_episodes(args.burmese)
    fullest: dict[int, object] = {}
    for episode in chinese:
        if episode.label is None:
            continue
        if episode.label not in fullest or len(episode.body) > len(fullest[episode.label].body):
            fullest[episode.label] = episode
    by_burmese = {episode.label: episode for episode in burmese}

    pairs = verified_pairs()
    if args.limit:
        pairs = pairs[:args.limit]

    document = Document()
    configure_fonts(document)
    first_page = True
    for pair in pairs:
        zh = fullest[pair["chinese"]]
        my = by_burmese[pair["burmese"]]
        natural_zh = len(page_chunks(zh.body, args.chars_zh))
        natural_my = len(page_chunks(my.body, args.chars_my))
        page_count = max(natural_zh, natural_my)
        # Same page count on both sides: no blank facing pages.
        zh_pages = balanced_chunks(zh.body, page_count)
        my_pages = balanced_chunks(my.body, page_count)
        for index in range(page_count):
            add_page(document, page_count, index, "ZH", zh.title, zh_pages[index], first_page)
            first_page = False
            add_page(document, page_count, index, "MY", my.title, my_pages[index], first_page)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    document.save(args.output)
    breaks = sum(1 for p in document.paragraphs if p.paragraph_format.page_break_before)
    print(f"[docx] {len(pairs)} chapter pairs, {breaks + 1} pages -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
