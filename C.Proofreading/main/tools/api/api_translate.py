#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Translate Chinese chapters with the RapidAPI translator and compare them with
the existing human Burmese.

    python3 mt/api_translate.py --chapters 1-2 --plan     # offline plan, no key
    RAPIDAPI_KEY=... python3 mt/api_translate.py --chapters 1-2 --run

Default is the plan: it reads the source, counts paragraphs and predicts the
number of billed requests, and makes no network call. `--run` is required to
spend quota.

Units are paragraphs, not sentences: a web-novel paragraph is one line in the
crawled source, and a paragraph keeps the context the translator needs. Crawler
markers, `--- Page N ---` lines, site promo lines, author `PS:` notes, dotted
rules and the PDF watermark are dropped before translation (`--keep-notes`
keeps the notes). Nothing else in the source is changed.

Outputs go to `content/mtranslate/rapidapi/` by default:

    ch0001.my.jsonl          one record per paragraph: zh, my, cache flag
    ch0001.my.txt            the chapter in Burmese
    book.my.txt              every selected chapter
    compare-ch001-ch002.md   Chinese and new Burmese side by side, plus the
                             existing human Burmese chapter as a reference
    report.json              counts, detected language, request count, files

`--one-file [PATH]` replaces all of that with a single text file: no cache, no
jsonl, no per-chapter txt, no comparison and no report. It is the mode for
translating a range to English for reading, and it is resumable because the
chapter headings in the file are the cursor:

    python3 mt/api_translate.py --chapters 194-408 --one-file --target en
    python3 mt/api_translate.py --chapters 194-408 --one-file --target en --run

Any range is accepted here; the two-chapter rule belongs to `mt/apicaller.py`
and the MCP tool `translate_chapters`, which spend quota from a cursor.

The comparison does not claim paragraph-level alignment with the human
translation: that alignment has never been verified, and the human text comes
from a PDF with its own line wrapping.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from rapidapi_translator import (  # noqa: E402
    MAX_REQUEST_CHARS,
    MAX_REQUEST_ITEMS,
    CachedTranslator,
    TranslatorError,
    chunk_texts,
    load_env_file,
    parse_chapters,
    split_text,
)
from chapter_map import ChapterMap, ChapterMapError, load_or_derive  # noqa: E402
from translate import BurmeseChapter, Chapter, burmese_chapters, chinese_chapters  # noqa: E402

CHINESE = ROOT / "content" / "source" / "chinese-0511241012-from-8011_1.txt"
BURMESE = ROOT / "content" / "source" / "ယဲ့နင်.txt"
OUTPUT = ROOT / "content" / "mtranslate" / "rapidapi"
DOCX = ROOT / "content" / "merged" / "episodes.docx"
# Display only: the API takes a code, this just labels the common ones so the
# target is never invisible. An unknown code is shown as-is and not rejected.
TARGET_NOTES = {
    "my": "Burmese / Myanmar",
    "en": "English",
    "zh": "Chinese",
    "zh-Hant": "Chinese (Traditional)",
    "zh-Hans": "Chinese (Simplified)",
    "th": "Thai",
    "ja": "Japanese",
    "ko": "Korean",
}
MYANMAR = re.compile(r"[\u1000-\u109f\uAA60-\uAA7F\uA9E0-\uA9FF]")
CHAPTER_WORDS = ("next", "last", "existing")

_MARKER = re.compile(r"^\[\[[A-Z]*CRAWLER[^\]]*\]\]$")
_PAGE = re.compile(r"^---\s*Page\s+\d+\s*---$")
_PROMO = re.compile(r"^\(?\s*(?:活動時間|活动时间|活動期間|活动期间)\s*[:：].*$")
_NOTE = re.compile(r"^PS\s*[:：].*$", re.IGNORECASE)
_RULE = re.compile(r"^[.·•…\-—_=*~\s]{6,}$")
_WATERMARK = re.compile(r"^(?:wunzinnosp|https?://\S+|www\.\S+)$", re.IGNORECASE)


def chapter_paragraphs(chapter: Chapter, *, keep_notes: bool = False) -> list[str]:
    """Translatable paragraphs, in source order, with crawler junk removed."""
    paragraphs: list[str] = []
    for raw in chapter.body.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if _MARKER.match(line) or _PAGE.match(line) or _WATERMARK.match(line):
            continue
        if not keep_notes and (_PROMO.match(line) or _NOTE.match(line) or _RULE.match(line)):
            continue
        paragraphs.append(line)
    return paragraphs


def reference_lines(chapter: BurmeseChapter) -> list[str]:
    """The existing human chapter with PDF furniture removed, lines kept as-is."""
    lines: list[str] = []
    for raw in chapter.body.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if _MARKER.match(line) or _PAGE.match(line) or _WATERMARK.match(line) or _RULE.match(line):
            continue
        lines.append(line)
    return lines


def select(chapters: list[Chapter], wanted: list[int]) -> list[Chapter]:
    """The chapter for each wanted number, preferring the longest body.

    A web crawl sometimes promotes a running page header to a chapter start, so
    one number can be parsed several times: chapter 61 arrives four times in this
    source, three of them stubs cut out of the middle of the real chapter. The
    real one is the long one, so a plain last-wins dictionary would hand a
    request a 213-character fragment in place of a 1,652-character chapter.
    """
    by_number: dict[int, Chapter] = {}
    for chapter in chapters:
        current = by_number.get(chapter.number)
        if current is None or len(chapter.body) > len(current.body):
            by_number[chapter.number] = chapter
    return [by_number[number] for number in wanted if number in by_number]


def target_label(code: str) -> str:
    note = TARGET_NOTES.get(code)
    return f"{code} ({note})" if note else code


def script_check(pairs: list[tuple[str, str]], target: str) -> dict:
    """Did the output actually come back in the target language?

    The API answers `status: true` even when it hands the input back, e.g. when
    the target code is wrong for the account. This flags that: identical text,
    empty text, and (for `my`) paragraphs without any Myanmar character.
    """
    total = len(pairs)
    unchanged = sum(1 for source, translated in pairs
                    if translated.strip() == source.strip() and source.strip())
    empty = sum(1 for _, translated in pairs if not translated.strip())
    script = {
        "total": total,
        "unchanged": unchanged,
        "empty": empty,
        "warnings": [],
    }
    if target == "my":
        myanmar = sum(1 for _, translated in pairs if MYANMAR.search(translated or ""))
        script["with_myanmar_script"] = myanmar
        if total and myanmar / total < 0.5:
            script["warnings"].append(
                f"only {myanmar}/{total} paragraphs contain Myanmar script; "
                "check that --target is my and that the account is subscribed")
    if total and unchanged / total > 0.2:
        script["warnings"].append(
            f"{unchanged}/{total} paragraphs came back identical to the source; "
            "the API may not have translated them")
    if total and empty:
        script["warnings"].append(f"{empty}/{total} paragraphs came back empty")
    return script


def _pieces(paragraphs: list[str], max_chars: int) -> list[str]:
    return [piece for paragraph in dict.fromkeys(paragraphs)
            for piece in split_text(paragraph, max_chars)]


def build_plan(chapters: list[Chapter], *, target: str, source: str,
               max_chars: int, max_items: int, keep_notes: bool = False) -> dict:
    rows = []
    total = {"paragraphs": 0, "characters": 0, "requests": 0}
    for chapter in chapters:
        paragraphs = chapter_paragraphs(chapter, keep_notes=keep_notes)
        requests = sum(1 for _ in chunk_texts(_pieces(paragraphs, max_chars),
                                              max_chars, max_items))
        row = {
            "chapter": chapter.number,
            "title": chapter.title,
            "paragraphs": len(paragraphs),
            "characters": sum(len(p) for p in paragraphs),
            "requests": requests,
        }
        rows.append(row)
        for name in total:
            total[name] += row[name]
    return {
        "mode": "plan",
        "target": target,
        "source": source,
        "max_chars": max_chars,
        "max_items": max_items,
        "chapters": rows,
        "totals": total,
        "note": "Upper bound measured on this source; retries and rate-limit "
                "responses can add requests.",
    }


def _relative(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _existing_chapters(path: Path) -> dict[int, BurmeseChapter]:
    try:
        return {chapter.number: chapter for chapter in burmese_chapters(path)}
    except Exception:
        return {}


def reference_numbers(chapter_map: ChapterMap | None, chinese: int) -> list[int]:
    """Burmese chapter numbers behind a Chinese chapter, from the DOCX map."""
    if chapter_map is None:
        return [chinese]
    return chapter_map.by_chinese.get(chinese) or []


def reference_text(chapter_map: ChapterMap | None, existing: dict[int, BurmeseChapter],
                   chinese: int) -> tuple[list[int], list[str]]:
    """The existing Burmese lines for a Chinese chapter, and which chapters they came from."""
    numbers = reference_numbers(chapter_map, chinese)
    if numbers:
        parts = [existing[number] for number in numbers if number in existing]
    else:
        parts = [existing[chinese]] if chinese in existing else []
    lines: list[str] = []
    for part in parts:
        lines.extend(reference_lines(part))
    return [part.number for part in parts], lines


def write_compare(path: Path, chapters: list[Chapter], results: dict,
                  report: dict, existing: dict[int, BurmeseChapter],
                  chapter_map: ChapterMap | None = None) -> None:
    lines: list[str] = [
        f"# {report['source_requested']} → {report['target']} — chapter "
        f"{chapters[0].number}–{chapters[-1].number}",
        "",
        "| field | value |",
        "|---|---|",
        f"| API | `{report['host']}` (RapidAPI) |",
        f"| target | `{report['target']}` |",
        f"| requested source | `{report['source_requested']}` |",
        f"| detected source | {report['detected'] or '—'} |",
        f"| chapters | {len(chapters)} |",
        f"| paragraphs | {report['totals']['paragraphs']} |",
        f"| characters | {report['totals']['characters']} |",
        f"| requests (this run) | {report['totals']['requests']} |",
        f"| cache hits | {report['totals']['cached']} / {report['totals']['paragraphs']} |",
        f"| existing Burmese (DOCX) | {_reference_span(chapter_map)} |",
        f"| generated | {report['generated']} |",
        "",
        "Each numbered paragraph below is one source line and its translation, in "
        "the order the API returned them. The human Burmese under *reference* is "
        "the existing translation of the same chapter; it is **not** paragraph-"
        "aligned with the Chinese, because that alignment has never been verified.",
        "",
    ]
    if chapter_map is None:
        lines.extend([
            "_Reference chapters were matched by number because no DOCX map was read; "
            "beyond the first split that is wrong — run without `--no-map`._",
            "",
        ])
    for chapter in chapters:
        result = results[chapter.number]
        numbers, reference = reference_text(chapter_map, existing, chapter.number)
        lines.append(f"## Chapter {chapter.number} — {chapter.title}")
        lines.append("")
        lines.append(f"{len(result['source'])} paragraphs · "
                     f"{sum(len(p) for p in result['source'])} characters · "
                     f"{result['requests']} request(s) · "
                     f"detected `{result['source_language'] or '—'}`")
        lines.append("")
        for index, (source, translated) in enumerate(
                zip(result["source"], result["target"]), 1):
            lines.append(f"**{index}.** {source}")
            lines.append("")
            lines.append(f"> {translated}" if translated else "> _(empty)_")
            lines.append("")
        if numbers:
            label = " + ".join(str(number) for number in numbers)
            lines.extend([
                "<details>",
                f"<summary>Existing human Burmese — chapter {label} "
                f"({len(reference)} lines, reference only)</summary>",
                "",
                "\n".join(reference),
                "",
                "</details>",
                "",
            ])
        else:
            lines.extend(["_No existing human Burmese chapter for this number._", ""])
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _reference_span(chapter_map: ChapterMap | None) -> str:
    if chapter_map is None or not chapter_map.pairs:
        return "not read (no DOCX map)"
    covered = chapter_map.chinese_covered
    burmese = chapter_map.burmese_chapters
    return (f"Chinese {covered[0]}–{covered[-1]} ↔ Burmese "
            f"{burmese[0]}–{burmese[-1]}; next without one: {chapter_map.next_chinese}")


def run(chapters: list[Chapter], *, target: str = "my", source: str = "auto",
        out_dir: Path | str = OUTPUT, cache_path: Path | str | None = None,
        enabled_cache: bool = True, keep_notes: bool = False,
        max_chars: int = MAX_REQUEST_CHARS, max_items: int = MAX_REQUEST_ITEMS,
        timeout: float = 60.0, max_attempts: int = 3, compare: bool = True,
        existing_path: Path | str | None = BURMESE,
        chapter_map: ChapterMap | None = None, log=None,
        book_name: str | None = None) -> dict:
    """Translate the given chapters and write the files described in the module doc."""
    out_dir = Path(out_dir)
    started = time.time()
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    report: dict = {
        "provider": "RapidAPI multi-format AI translator",
        "host": "",
        "target": target,
        "source_requested": source,
        "detected": "",
        "generated": generated,
        "chapters": [],
        "reference": {
            "docx_map": bool(chapter_map and chapter_map.pairs),
            "span": _reference_span(chapter_map),
            "splits": {str(k): v for k, v in (chapter_map.splits() if chapter_map else {}).items()},
        },
        "totals": {"chapters": 0, "paragraphs": 0, "characters": 0,
                   "requests": 0, "cached": 0},
        "elapsed_seconds": 0.0,
        "files": [],
    }
    results: dict[int, dict] = {}
    book: list[str] = []
    seen_pairs: list[tuple[str, str]] = []

    with CachedTranslator(cache_path=cache_path, enabled=enabled_cache,
                          timeout=timeout, max_attempts=max_attempts,
                          max_chars=max_chars, max_items=max_items) as translator:
        out_dir.mkdir(parents=True, exist_ok=True)
        report["host"] = translator.host
        report["cache"] = str(translator.cache.path) if translator.cache.enabled else None
        for chapter in chapters:
            paragraphs = chapter_paragraphs(chapter, keep_notes=keep_notes)
            if not paragraphs:
                continue
            result = translator.translate_batch(paragraphs, target, source)
            stem = f"ch{chapter.number:04d}.{target}"
            jsonl_path = out_dir / f"{stem}.jsonl"
            with jsonl_path.open("w", encoding="utf-8") as handle:
                for index, (zh, translated, hit) in enumerate(
                        zip(paragraphs, result.texts, result.cache_hits), 1):
                    handle.write(json.dumps({
                        "chapter": chapter.number,
                        "title": chapter.title,
                        "index": index,
                        "source": zh,
                        "target": translated,
                        "cached": hit,
                    }, ensure_ascii=False) + "\n")
            text_path = out_dir / f"{stem}.txt"
            text_path.write_text(
                f"{chapter.title}\n{'=' * len(chapter.title)}\n\n"
                + "\n\n".join(result.texts) + "\n", encoding="utf-8")
            book.append(f"===== {chapter.title} =====\n\n" + "\n\n".join(result.texts))
            seen_pairs.extend(zip(paragraphs, result.texts))
            results[chapter.number] = {
                "source": paragraphs,
                "target": result.texts,
                "source_language": result.source_language,
                "requests": result.requests,
            }
            row = {
                "chapter": chapter.number,
                "title": chapter.title,
                "paragraphs": len(paragraphs),
                "characters": sum(len(p) for p in paragraphs),
                "requests": result.requests,
                "cached": result.cached,
                "source_language": result.source_language,
                "source_language_name": result.source_language_name,
                "reference_chapters": reference_numbers(chapter_map, chapter.number),
                "files": [_relative(jsonl_path), _relative(text_path)],
            }
            report["chapters"].append(row)
            report["totals"]["chapters"] += 1
            for name in ("paragraphs", "characters", "requests", "cached"):
                report["totals"][name] += row[name]
            if result.source_language:
                report["detected"] = result.source_language
            if log is not None:
                log(f"[rapidapi] chapter {chapter.number}: {row['paragraphs']} "
                    f"paragraphs, {row['requests']} request(s), {row['cached']} cached")

    report["target_check"] = script_check(seen_pairs, target)
    if book:
        # A caller that translates one pair per run must not overwrite the
        # previous pair, so it passes its own name; the batch caller keeps the
        # historical `book.<target>.txt`.
        book_path = out_dir / (book_name or f"book.{target}.txt")
        book_path.write_text("\n\n".join(book) + "\n", encoding="utf-8")
        report["files"].append(_relative(book_path))

    if compare and chapters and results:
        existing = _existing_chapters(Path(existing_path)) if existing_path else {}
        compare_path = out_dir / (
            f"compare-ch{chapters[0].number:03d}-ch{chapters[-1].number:03d}.md")
        write_compare(compare_path, [c for c in chapters if c.number in results],
                      results, report, existing, chapter_map)
        report["files"].append(_relative(compare_path))

    report["elapsed_seconds"] = round(time.time() - started, 1)
    report_path = out_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                           encoding="utf-8")
    report["files"].append(_relative(report_path))
    return report


# ---------------------------------------------------------------- one file

# One chapter's heading inside the single text file, and the pattern that reads
# it back on the next run: the heading is the resume cursor, so no database and
# no sidecar exist to get out of step with the text.
CHAPTER_MARK = "===== Chapter {number} — {title} ====="
_CHAPTER_MARK = re.compile(r"^===== Chapter (\d+)(?: — .*)? =====$", re.MULTILINE)
DEFAULT_ONE_FILE = ROOT / "content" / "mtranslate" / "english.txt"


def chapter_block(chapter: Chapter, texts: list[str]) -> str:
    """The chapter exactly as it is written into the single text file."""
    heading = CHAPTER_MARK.format(number=chapter.number, title=chapter.title)
    body = "\n\n".join(text for text in texts if text.strip())
    return f"{heading}\n\n{body}\n\n"


def scan_block(text: str) -> tuple[list[int], int]:
    """Chapters present in `text`, and the offset a resumed run may append at.

    A chapter counts only when its heading is followed by text: a block is
    written in one call and fsynced, so an empty body or a tail that does not
    end on a blank line means that chapter was cut off mid-write. The offset
    then points at its heading, and the resumed run rewrites it instead of
    leaving a stump in the middle of the file.
    """
    marks = [(match.start(), int(match.group(1)))
             for match in _CHAPTER_MARK.finditer(text)]
    if not marks:
        if text.strip():
            raise ValueError(
                "the file has text but no '===== Chapter N =====' heading, so "
                "it was not written by this mode; move it aside or pass a "
                "different --one-file")
        return [], 0
    done: list[int] = []
    for position, (start, number) in enumerate(marks):
        end = marks[position + 1][0] if position + 1 < len(marks) else len(text)
        body = text[start:end].split("\n", 1)[-1]
        if not body.strip():
            return done, start
        done.append(number)
    if not text.endswith("\n\n"):
        return done[:-1], marks[-1][0]
    return done, len(text)


class SingleTextFile:
    """Append chapters to exactly one `.txt`, resuming from what is already in it.

    No database, no sidecar, no per-chapter file: the text is the state. A run
    that dies at chapter 300 is resumed by pasting the same command again.
    """

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        original = (self.path.read_text(encoding="utf-8")
                    if self.path.is_file() else "")
        self.done, cut = scan_block(original)
        if cut < len(original):
            self.path.write_text(original[:cut], encoding="utf-8")
        self.handle = self.path.open("a", encoding="utf-8")

    def add(self, chapter: Chapter, texts: list[str]) -> None:
        self.handle.write(chapter_block(chapter, texts))
        self.handle.flush()
        os.fsync(self.handle.fileno())
        self.done.append(chapter.number)

    def close(self) -> None:
        if not self.handle.closed:
            self.handle.close()

    def __enter__(self) -> "SingleTextFile":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def translate_into_one_file(chapters: list[Chapter], *, path: Path | str,
                            target: str = "en", source: str = "auto",
                            keep_notes: bool = False,
                            max_chars: int = MAX_REQUEST_CHARS,
                            max_items: int = MAX_REQUEST_ITEMS,
                            timeout: float = 60.0, max_attempts: int = 3,
                            pause: float = 0.0, translator=None,
                            log=None) -> dict:
    """Translate chapters into a single `.txt`; nothing else is written.

    The cache is off by construction, so no SQLite file appears; and there is no
    jsonl, no per-chapter txt, no comparison and no report. Chapters already in
    the file are skipped, which is what makes an interrupted run resumable.

    The translator is built **before** the file is opened, so a missing key
    fails without leaving an empty `.txt` behind.
    """
    emit = log or (lambda text: None)
    started = time.time()
    owner = translator is None
    active = translator if translator is not None else CachedTranslator(
        cache_path=None, enabled=False, timeout=timeout,
        max_attempts=max_attempts, max_chars=max_chars, max_items=max_items)
    totals = {"target": target, "chapters": 0, "paragraphs": 0,
              "characters": 0, "requests": 0, "skipped": 0,
              "path": _relative(Path(path))}
    try:
        with SingleTextFile(path) as sink:
            already = set(sink.done)
            wanted = [chapter for chapter in chapters
                      if chapter.number not in already]
            totals["skipped"] = len(chapters) - len(wanted)
            emit(f"[one-file] {len(chapters)} chapter(s) asked, "
                 f"{totals['skipped']} already in {sink.path}, "
                 f"{len(wanted)} to translate")
            for position, chapter in enumerate(wanted, 1):
                paragraphs = chapter_paragraphs(chapter, keep_notes=keep_notes)
                if not paragraphs:
                    emit(f"[one-file] chapter {chapter.number} has no "
                         "translatable paragraphs; skipped")
                    continue
                result = active.translate_batch(paragraphs, target, source)
                sink.add(chapter, result.texts)
                totals["chapters"] += 1
                totals["paragraphs"] += len(paragraphs)
                totals["characters"] += sum(len(p) for p in paragraphs)
                totals["requests"] += result.requests
                emit(f"[one-file] {position}/{len(wanted)} chapter "
                     f"{chapter.number}: {len(paragraphs)} paragraphs, "
                     f"{result.requests} request(s)")
                if pause and position < len(wanted):
                    time.sleep(pause)
            totals["chapters_in_file"] = len(sink.done)
    finally:
        if owner:
            active.close()
    totals["elapsed_seconds"] = round(time.time() - started, 1)
    return totals



def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Translate Chinese chapters via RapidAPI and compare with the "
                    "existing Burmese.")
    parser.add_argument("--chapters", default="1-2",
                        help="chapters to translate: 1-2, 1,3-4, all, or one of "
                             "next (first Chinese chapter after the existing "
                             "Burmese, 194), last (the Chinese chapter behind the "
                             "last existing Burmese, 193) or existing (every "
                             "Chinese chapter that has one). Default: 1-2")
    parser.add_argument("--target", default=None,
                        help="target language (default: my, or en with --one-file)")
    parser.add_argument("--source", default="auto",
                        help="source language or auto (default: auto)")
    parser.add_argument("--source-file", type=Path, default=CHINESE,
                        help="Chinese text with ===== 第N章 ===== headings")
    parser.add_argument("--existing", type=Path, default=BURMESE,
                        help="existing human Burmese text, for the comparison reference")
    parser.add_argument("--docx", type=Path, default=DOCX,
                        help="bilingual DOCX the chapter numbers come from "
                             "(default: content/merged/episodes.docx)")
    parser.add_argument("--map", dest="map_path", type=Path, default=None,
                        help="saved chapter map JSON; skips reading the DOCX")
    parser.add_argument("--no-map", action="store_true",
                        help="ignore the DOCX map and assume Chinese N = Burmese N")
    parser.add_argument("--out-dir", type=Path, default=OUTPUT)
    parser.add_argument("--cache", type=Path, default=None, help="SQLite cache path")
    parser.add_argument("--no-cache", action="store_true", help="ignore the cache")
    parser.add_argument("--keep-notes", action="store_true",
                        help="keep author notes and promo lines")
    parser.add_argument("--no-compare", action="store_true",
                        help="do not write the comparison file")
    parser.add_argument("--max-chars", type=int, default=MAX_REQUEST_CHARS)
    parser.add_argument("--max-items", type=int, default=MAX_REQUEST_ITEMS)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    parser.add_argument("--env-file", type=Path, default=None, metavar="PATH",
                        help="read KEY=VALUE lines from PATH before running; the "
                             "shell environment wins. Not loaded implicitly.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--plan", action="store_true",
                      help="offline: count work and requests (default)")
    mode.add_argument("--run", action="store_true",
                      help="actually call the API; needs RAPIDAPI_KEY")
    parser.add_argument("--one-file", nargs="?", const="", default=None,
                        metavar="PATH",
                        help="write every chapter into this one .txt and nothing "
                             "else: no cache, no jsonl, no per-chapter file, no "
                             "report (default with the flag alone: "
                             "content/mtranslate/english.txt). Chapters already "
                             "in the file are skipped, so a killed run resumes")
    parser.add_argument("--skip-missing", action="store_true",
                        help="translate the chapters that exist when a range has "
                             "holes; on by default with --one-file")
    parser.add_argument("--pause", type=float, default=0.5,
                        help="seconds between chapters (default: 0.5; 0 for none)")
    args = parser.parse_args(argv)

    try:
        loaded = load_env_file(args.env_file)
    except TranslatorError as error:
        print(f"[rapidapi] {error}", file=sys.stderr)
        return 2
    if loaded:
        print(f"[rapidapi] loaded {', '.join(loaded)} from {args.env_file}",
              file=sys.stderr)

    if not args.source_file.is_file():
        print(f"[rapidapi] no source file at {args.source_file}", file=sys.stderr)
        return 4
    chapters = chinese_chapters(args.source_file)
    if not chapters:
        print("[rapidapi] no chapters found in the source file", file=sys.stderr)
        return 4

    chapter_map: ChapterMap | None = None
    word = args.chapters.strip().lower()
    explicit = word in CHAPTER_WORDS or args.map_path is not None or args.docx != DOCX
    if not args.no_map:
        try:
            chapter_map = load_or_derive(args.map_path, args.docx)
        except (ChapterMapError, OSError, KeyError) as error:
            if explicit:
                print(f"[rapidapi] chapter map unavailable: {error}", file=sys.stderr)
            if word in CHAPTER_WORDS:
                return 2
    if word in CHAPTER_WORDS:
        if chapter_map is None:
            print(f"[rapidapi] --chapters {word} needs the DOCX map", file=sys.stderr)
            return 2
        if word == "next":
            wanted = [chapter_map.next_chinese] if chapter_map.next_chinese else []
        elif word == "last":
            wanted = [chapter_map.last_chinese] if chapter_map.last_chinese else []
        else:
            wanted = chapter_map.chinese_covered
        if not wanted:
            print(f"[rapidapi] --chapters {word}: nothing to select", file=sys.stderr)
            return 2
        print(f"[rapidapi] --chapters {word} -> Chinese "
              f"{', '.join(str(number) for number in wanted[:5])}"
              f"{' …' if len(wanted) > 5 else ''} (from {args.docx.name})",
              file=sys.stderr)
    elif word == "all":
        wanted = [chapter.number for chapter in chapters]
    else:
        try:
            wanted = parse_chapters(args.chapters)
        except ValueError as error:
            print(f"[rapidapi] bad --chapters: {error}", file=sys.stderr)
            return 2
    selected = select(chapters, wanted)
    missing = sorted(set(wanted) - {chapter.number for chapter in selected})
    if missing and (args.skip_missing or args.one_file is not None):
        print(f"[rapidapi] the source has no chapter(s) "
              f"{', '.join(str(number) for number in missing)}; translating the "
              f"{len(selected)} that exist", file=sys.stderr)
    elif missing:
        known = ", ".join(str(number) for number in wanted if number not in missing)
        print(f"[rapidapi] no chapter(s) {missing} in {args.source_file.name}; "
              f"found {known or 'nothing'}. Add --skip-missing to translate the "
              "rest", file=sys.stderr)
        return 2
    if not selected:
        print("[rapidapi] nothing selected", file=sys.stderr)
        return 2

    target = args.target or ("en" if args.one_file is not None else "my")
    one_file = (Path(args.one_file) if args.one_file else DEFAULT_ONE_FILE
                if args.one_file is not None else None)

    if not args.run:
        plan = build_plan(selected, target=target, source=args.source,
                          max_chars=args.max_chars, max_items=args.max_items,
                          keep_notes=args.keep_notes)
        plan["source_file"] = _relative(args.source_file)
        plan["existing"] = {
            "docx": _relative(args.docx) if args.docx and args.docx.is_file() else None,
            "span": _reference_span(chapter_map),
            "next_without_reference": chapter_map.next_chinese if chapter_map else None,
            "last_with_reference": chapter_map.last_chinese if chapter_map else None,
        }
        if args.json:
            print(json.dumps(plan, indent=2, ensure_ascii=False))
        else:
            print("[rapidapi] plan only — no request made, key not needed")
            print(f"[rapidapi] language: {args.source} → "
                  f"{target_label(target)} "
                  f"(query source={args.source}&target={target})")
            print(f"{'chapter':>7}  {'paragraphs':>10}  {'characters':>10}  {'requests':>8}  title")
            for row in plan["chapters"]:
                print(f"{row['chapter']:>7}  {row['paragraphs']:>10}  "
                      f"{row['characters']:>10}  {row['requests']:>8}  {row['title']}")
            totals = plan["totals"]
            print(f"{'total':>7}  {totals['paragraphs']:>10}  "
                  f"{totals['characters']:>10}  {totals['requests']:>8}")
            if chapter_map is not None:
                covered = chapter_map.chinese_covered
                burmese = chapter_map.burmese_chapters
                print(f"\nexisting Burmese (from {args.docx.name}): Chinese "
                      f"{covered[0]}–{covered[-1]} ↔ Burmese {burmese[0]}–{burmese[-1]}")
                for chinese, numbers in chapter_map.splits().items():
                    print(f"  split: Chinese {chinese} → Burmese "
                          f"{' + '.join(str(number) for number in numbers)}")
                print(f"  last chapter behind the existing Burmese: Chinese "
                      f"{chapter_map.last_chinese}")
                print(f"  next without a counterpart: Chinese {chapter_map.next_chinese}")
            if one_file is not None:
                present = (scan_block(one_file.read_text(encoding="utf-8"))[0]
                           if one_file.is_file() else [])
                reuse = [row["chapter"] for row in plan["chapters"]
                         if row["chapter"] in set(present)]
                print(f"\none file: {_relative(one_file)} — {len(present)} "
                      f"chapter(s) already there, {len(reuse)} of the "
                      f"{len(plan['chapters'])} selected would be skipped")
                print("no cache, no jsonl, no per-chapter file, no report")
            print("\nRun the same command with --run to translate "
                  f"({args.source} → {target}).")
        return 0

    if one_file is not None:
        try:
            report = translate_into_one_file(
                selected, path=one_file, target=target, source=args.source,
                keep_notes=args.keep_notes, max_chars=args.max_chars,
                max_items=args.max_items, timeout=args.timeout,
                max_attempts=args.attempts, pause=args.pause,
                log=None if args.json else print)
        except TranslatorError as error:
            print(f"[rapidapi] {error}", file=sys.stderr)
            return 3
        except ValueError as error:
            print(f"[rapidapi] {error}", file=sys.stderr)
            return 2
        if args.json:
            print(json.dumps(report, indent=2, ensure_ascii=False))
        else:
            print(f"[rapidapi] {args.source} → {target_label(target)}: "
                  f"{report['chapters']} translated, {report['skipped']} already "
                  f"present, {report['paragraphs']} paragraph(s), "
                  f"{report['requests']} request(s), "
                  f"{report['elapsed_seconds']}s -> {report['path']}")
            print(f"[rapidapi] {report['chapters_in_file']} chapter(s) in the "
                  "file; nothing else was written")
        return 0

    try:
        report = run(selected, target=target, source=args.source,
                     out_dir=args.out_dir, cache_path=args.cache,
                     enabled_cache=not args.no_cache, keep_notes=args.keep_notes,
                     max_chars=args.max_chars, max_items=args.max_items,
                     timeout=args.timeout, max_attempts=args.attempts,
                     compare=not args.no_compare, existing_path=args.existing,
                     chapter_map=chapter_map,
                     log=None if args.json else print)
    except TranslatorError as error:
        print(f"[rapidapi] {error}", file=sys.stderr)
        return 3
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        totals = report["totals"]
        check = report.get("target_check") or {}
        print(f"[rapidapi] {args.source} → {target_label(target)}: "
              f"{totals['chapters']} chapter(s), {totals['paragraphs']} "
              f"paragraph(s), {totals['requests']} request(s), "
              f"{report['elapsed_seconds']}s -> {args.out_dir}")
        if "with_myanmar_script" in check:
            print(f"[rapidapi] {check['with_myanmar_script']}/{check['total']} "
                  "paragraphs contain Myanmar script")
        for warning in check.get("warnings") or []:
            print(f"[rapidapi] warning: {warning}", file=sys.stderr)
        for name in report["files"]:
            print(f"  {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
