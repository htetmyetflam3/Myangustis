"""Bounded, source-checked context for the local English review task.

The agent sees only one chapter window or a few Burmese keyword hits. File
alignment and DOCX chapter mapping happen here, never in the agent's context.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MT = ROOT / "mt"
if str(MT) not in sys.path:
    sys.path.insert(0, str(MT))

import api_translate  # noqa: E402
import translate as local_mt  # noqa: E402
from agent_work import paragraph_id  # noqa: E402
from chapter_map import ChapterMapError, load_or_derive  # noqa: E402

DEFAULT_API_FILE = ROOT / "content" / "mtranslate" / "english.txt"
DEFAULT_API_DIR = ROOT / "content" / "mtranslate" / "rapidapi"
DEFAULT_MACHINE_FILE = ROOT / "content" / "mtranslate" / "zh-en.txt"
DEFAULT_MACHINE_DIR = ROOT / "content" / "mtranslate" / "zh-en" / "chapters"  # explicit legacy override only
DEFAULT_DOCX = ROOT / "content" / "merged" / "episodes.docx"
DEFAULT_BURMESE = ROOT / "content" / "source" / "ယဲ့နင်.txt"

_API_MARK = re.compile(r"^===== Chapter (\d+)(?: — .*)? =====$")
_MYANMAR = re.compile(r"[\u1000-\u109f\uAA60-\uAA7F\uA9E0-\uA9FF]")


def _chapter(number: int, source: Path):
    chapters = api_translate.select(api_translate.chinese_chapters(source), [number])
    if not chapters:
        raise ValueError(f"no Chinese chapter {number} in {source}")
    return chapters[0]


def _chapter_block(path: Path, number: int) -> list[str]:
    """Stream the one-file API output and return just this chapter's body lines."""
    active = False
    found = False
    body: list[str] = []
    with path.open(encoding="utf-8") as stream:
        for raw in stream:
            line = raw.rstrip("\r\n")
            marker = _API_MARK.match(line)
            if marker:
                if active:
                    break
                active = int(marker.group(1)) == number
                found = found or active
                continue
            if active:
                body.append(line)
    if not found:
        raise ValueError(f"API English file {path} has no chapter {number}")
    text = "\n".join(body).strip()
    return [piece.strip() for piece in re.split(r"\n\s*\n", text) if piece.strip()]


def _chapter_txt(path: Path) -> list[str]:
    """Read a per-chapter API .txt: title, underline, then blank-line paragraphs."""
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 3:
        raise ValueError(f"API English chapter file is empty or truncated: {path}")
    text = "\n".join(lines[2:]).strip()
    return [piece.strip() for piece in re.split(r"\n\s*\n", text) if piece.strip()]


def _api_english(number: int, paragraphs: list[str], api_file: Path | None,
                 api_dir: Path | None) -> tuple[list[str], dict]:
    """Load the retained one-file API English; alternate paths are explicit only."""
    if api_file is None and api_dir is None:
        one_file = DEFAULT_API_FILE
        if not one_file.is_file():
            raise FileNotFoundError(f"API English file not found: {one_file}")
        rows = _chapter_block(one_file, number)
        _same_count("API English", len(paragraphs), len(rows), one_file)
        return rows, {"file": str(one_file),
                      "alignment": "ordered chapter paragraphs; count verified",
                      "source_checked": False}

    jsonl: Path | None = None
    if api_file is not None:
        path = api_file.expanduser()
        if path.is_dir():
            api_dir = path
            api_file = None
        else:
            if not path.is_file():
                raise FileNotFoundError(f"API English file not found: {path}")
            if path.suffix.lower() == ".jsonl":
                jsonl = path
            else:
                rows = (_chapter_txt(path) if path.name == f"ch{number:04d}.en.txt"
                        else _chapter_block(path, number))
                _same_count("API English", len(paragraphs), len(rows), path)
                return rows, {"file": str(path), "alignment": "ordered chapter paragraphs; count verified",
                              "source_checked": False}
    else:
        jsonl = None

    directory = api_dir or DEFAULT_API_DIR
    chapter_jsonl = jsonl or directory.expanduser() / f"ch{number:04d}.en.jsonl"
    chapter_txt = directory.expanduser() / f"ch{number:04d}.en.txt"
    if chapter_jsonl.is_file():
        by_index: dict[int, dict] = {}
        with chapter_jsonl.open(encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                    index = int(record["index"])
                except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
                    raise ValueError(f"invalid API JSONL at {chapter_jsonl}:{line_number}: {error}") from None
                if index in by_index:
                    raise ValueError(f"API English JSONL repeats paragraph {index}: {chapter_jsonl}")
                if record.get("chapter") is not None and int(record["chapter"]) != number:
                    raise ValueError(f"API English JSONL has chapter {record['chapter']} instead of {number}: {chapter_jsonl}")
                by_index[index] = record
        result = []
        for index, original in enumerate(paragraphs, 1):
            record = by_index.get(index)
            if record is None:
                raise ValueError(f"API English JSONL is missing paragraph {index}: {chapter_jsonl}")
            if str(record.get("source", "")).strip() != original.strip():
                raise ValueError(f"API English source mismatch at chapter {number}, paragraph {index}; refusing shifted alignment")
            result.append(str(record.get("target", "")))
        return result, {"file": str(chapter_jsonl), "alignment": "paragraph index + exact Chinese source",
                        "source_checked": True}

    chapter_txt = directory.expanduser() / f"ch{number:04d}.en.txt"
    if chapter_txt.is_file():
        rows = _chapter_txt(chapter_txt)
        _same_count("API English", len(paragraphs), len(rows), chapter_txt)
        return rows, {"file": str(chapter_txt), "alignment": "ordered chapter paragraphs; count verified",
                      "source_checked": False}
    raise FileNotFoundError(
        f"no API English for chapter {number}; expected {one_file}, "
        f"{chapter_jsonl}, or {chapter_txt}")


def _same_count(label: str, expected: int, found: int, path: Path) -> None:
    if expected != found:
        raise ValueError(f"{label} alignment refused: Chinese has {expected} paragraphs, "
                         f"but {path} has {found}; no rows were paired")


def _onefile_machine_block(path: Path, number: int) -> list[str]:
    """Read one translated chapter body from the consolidated zh-en file."""
    active = False
    found = False
    body: list[str] = []
    with path.open(encoding="utf-8") as stream:
        for raw in stream:
            line = raw.rstrip("\r\n")
            marker = _API_MARK.match(line)
            if marker:
                if active:
                    break
                active = int(marker.group(1)) == number
                found = found or active
                continue
            if active:
                body.append(line)
    if not found:
        raise ValueError(f"local machine-English file {path} has no chapter {number}")
    return "\n".join(body).strip().splitlines()


def _machine_english(chapter, paragraphs: list[str], machine_file: Path) -> tuple[list[str], dict]:
    """Group local sentence-level MT output back onto its Chinese paragraphs.

    The tracked local route is one consolidated text file. Its chapter block
    contains one output line per Chinese sentence; verify the source sentence
    and paragraph counts before grouping anything for review.
    """
    if not machine_file.is_file():
        raise FileNotFoundError(f"local machine-English file not found: {machine_file}")
    try:
        machine_sentences = _onefile_machine_block(machine_file, chapter.number)
    except ValueError as error:
        # An explicitly selected per-chapter file remains supported for local
        # tests or temporary runs, but the default input is always zh-en.txt.
        if machine_file.name == "zh-en.txt":
            raise
        lines = machine_file.read_text(encoding="utf-8").splitlines()
        if len(lines) < 2:
            raise ValueError(f"local machine-English file is truncated: {machine_file}") from error
        machine_sentences = lines[2:]

    # The local engine translates every non-empty raw line, including crawler
    # furniture. Reconstruct that exact sequence, but return only paragraphs
    # accepted by api_translate.chapter_paragraphs().
    clean_iter = iter(paragraphs)
    next_clean = next(clean_iter, None)
    grouped: list[str] = []
    cursor = 0
    seen_clean = 0
    for raw in chapter.body.splitlines():
        original_line = raw.strip()
        if not original_line:
            continue
        source_sentences = local_mt.sentences(original_line)
        if not source_sentences:
            continue
        is_clean = next_clean is not None and original_line == next_clean
        end = cursor + len(source_sentences)
        if end > len(machine_sentences):
            raise ValueError(f"local MT alignment refused: {machine_file} ends inside "
                             f"the sentence group for source line {seen_clean + 1}")
        translated = machine_sentences[cursor:end]
        cursor = end
        if is_clean:
            grouped.append(" ".join(part.strip() for part in translated if part.strip()))
            seen_clean += 1
            next_clean = next(clean_iter, None)
    if cursor != len(machine_sentences):
        raise ValueError(f"local MT alignment refused: source accounts for {cursor} sentence(s), "
                         f"but {machine_file} contains {len(machine_sentences)}")
    if next_clean is not None or seen_clean != len(paragraphs):
        raise ValueError("local MT alignment refused: cleaned Chinese paragraphs do not match "
                         "the source chapter's line order")
    _same_count("local machine English", len(paragraphs), len(grouped), machine_file)
    return grouped, {"file": str(machine_file),
                     "alignment": "source sentence counts grouped to exact Chinese paragraphs",
                     "source_checked": True}


def compare_english_chapter(number: int, *, start: int = 1, count: int = 10,
                            source_file: Path | None = None,
                            machine_file: Path | None = None,
                            machine_dir: Path | None = None,
                            api_file: Path | None = None,
                            api_dir: Path | None = None) -> dict:
    """One bounded window: Chinese, local MT English, and API English per line."""
    from agent_work import chapter_paragraphs_by_number
    from api_translate import CHINESE

    source = source_file or CHINESE
    chapter = _chapter(number, source)
    paragraphs = api_translate.chapter_paragraphs(chapter)
    if not paragraphs:
        raise ValueError(f"chapter {number} has no translatable paragraphs")

    if machine_file is None:
        machine_file = ((machine_dir / f"ch{number:04d}.en.txt") if machine_dir
                        else DEFAULT_MACHINE_FILE)
    machine_rows, machine_meta = _machine_english(chapter, paragraphs, Path(machine_file).expanduser())
    api_rows, api_meta = _api_english(number, paragraphs, api_file, api_dir)

    first = max(1, int(start))
    size = max(1, int(count))
    if first > len(paragraphs):
        raise ValueError(f"start {first} is outside chapter {number}'s 1–{len(paragraphs)} paragraphs")
    last = min(len(paragraphs), first + size - 1)
    rows = [{"id": paragraph_id(number, index, text), "index": index,
             "zh": text, "machine_en": machine_rows[index - 1],
             "api_en": api_rows[index - 1]}
            for index, text in enumerate(paragraphs[first - 1:last], first)]
    return {
        "chapter": number,
        "title": chapter.title,
        "window": {"start": first, "count": len(rows), "total": len(paragraphs),
                   "more": last < len(paragraphs),
                   "next_start": last + 1 if last < len(paragraphs) else None},
        "alignment": {"machine_en": machine_meta, "api_en": api_meta},
        "lines": rows,
        "note": "one row per Chinese source paragraph; translations are read-only",
    }


def _validate_burmese_keyword(keyword: str) -> str:
    value = keyword.strip()
    if not value:
        raise ValueError("`keyword` must be a Burmese word or phrase")
    if not _MYANMAR.search(value):
        raise ValueError("`keyword` must contain Burmese-script text, not an English gloss")
    if any(unicodedata.category(char).startswith("L") and not _MYANMAR.fullmatch(char)
           for char in value):
        raise ValueError("`keyword` must be Burmese only; do not pass an English/Chinese gloss")
    return value


def previous_burmese_context(number: int, keyword: str, *, before: int = 2, after: int = 2,
                             max_hits: int = 10,
                             source_file: Path | None = None,
                             docx: Path | None = None,
                             burmese_file: Path | None = None) -> dict:
    """Find Burmese keyword lines in the two Chinese chapters before `number`.

    Chinese→Burmese chapter numbers come from the DOCX map, which matters at
    the end of the human-translated span (Chinese 193 maps to Burmese 195).
    """
    from api_translate import BURMESE, CHINESE, reference_lines, reference_numbers
    from translate import burmese_chapters

    term = _validate_burmese_keyword(keyword)
    current = int(number)
    if current < 1:
        raise ValueError("`chapter` must be a positive Chinese chapter number")
    before = max(0, int(before))
    after = max(0, int(after))
    max_hits = max(1, int(max_hits))
    source_path = burmese_file or BURMESE
    try:
        mapping = load_or_derive(None, docx or DEFAULT_DOCX)
    except (ChapterMapError, OSError, KeyError) as error:
        raise ValueError(f"cannot map Chinese chapters to Burmese reference chapters: {error}") from None

    chinese_previous = [chapter for chapter in (current - 2, current - 1) if chapter >= 1]
    mapped: list[tuple[int, int]] = []
    for chinese_number in chinese_previous:
        for burmese_number in reference_numbers(mapping, chinese_number):
            mapped.append((chinese_number, burmese_number))
    if not mapped:
        raise ValueError(f"the DOCX has no Burmese reference mapping for chapters {chinese_previous}")

    by_number = {}
    for parsed in burmese_chapters(source_path):
        current_copy = by_number.get(parsed.number)
        if current_copy is None or len(parsed.body) > len(current_copy.body):
            by_number[parsed.number] = parsed
    hits = []
    searched = []
    total_hits = 0
    for chinese_number, burmese_number in mapped:
        chapter = by_number.get(burmese_number)
        if chapter is None:
            continue
        lines = reference_lines(chapter)
        searched.append({"chinese": chinese_number, "burmese": burmese_number,
                         "lines": len(lines)})
        for index, line in enumerate(lines):
            if term not in line:
                continue
            total_hits += 1
            if len(hits) >= max_hits:
                continue
            lo, hi = max(0, index - before), min(len(lines), index + after + 1)
            hits.append({
                "chinese_chapter": chinese_number,
                "burmese_chapter": burmese_number,
                "line": index + 1,
                "matches": line.count(term),
                "context": [{"line": n + 1, "match": n == index, "text": lines[n]}
                            for n in range(lo, hi)],
            })
    return {
        "current_chinese_chapter": current,
        "searched_chapters": searched,
        "keyword": term,
        "hits": hits,
        "hit_count": total_hits,
        "truncated": total_hits > len(hits),
        "note": ("Human Burmese context only; the source has known encoding damage, "
                 "so treat hits as clues and verify meaning/spelling against Chinese. "
                 "Chapter correspondence comes from the merged DOCX."),
    }
