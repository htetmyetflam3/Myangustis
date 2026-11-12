#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Workspace for an agent that reads the book, calls the MT API and fixes tone.

The remote API is a stateless translator: it sees one paragraph at a time and
knows nothing about the story. A local agent (Kilo, Claude Code, ...) supplies
the missing part -- story context, style and tone -- and needs somewhere to put
the result that is not "machine output" and not "approved translation".

    read     chapter text, paragraph ids, and the existing human Burmese
    save     the agent's adjusted text for one paragraph (status: draft)
    export   a chapter file plus a Chinese / machine / draft comparison
    list     what has been drafted, and by which model

Nothing here writes into `content/mtranslate/<route>/` (machine output) or into
`mt/mt_memory.py` (approved memory). A draft stays a draft until a human
approves it; this tool has no approve step on purpose.

    python3 mt/agent_work.py read 193 --json
    python3 mt/agent_work.py read 193 --reference-lines 40
    python3 mt/agent_work.py save 193 7 --draft "သူက ယဲ့နင်ပဲ။" --model grok
    python3 mt/agent_work.py export 193 --out-dir content/mtranslate/drafts
    python3 mt/agent_work.py list --chapter 193
    python3 mt/agent_work.py stats

Paragraph ids are stable for a given source file: `0193-007-1a2b3c4d`, where the
first group is the chapter, the second the paragraph index and the last a hash
of the text, so an id cannot silently point at rewritten prose.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from api_translate import (  # noqa: E402
    BURMESE,
    CHINESE,
    DOCX,
    chapter_paragraphs,
    reference_lines,
    reference_numbers,
)
from chapter_map import ChapterMap, ChapterMapError, load_or_derive  # noqa: E402
from translate import BurmeseChapter, Chapter, burmese_chapters, chinese_chapters  # noqa: E402

DEFAULT_STORE = ROOT / "content" / "mtranslate" / "agent-drafts.sqlite3"
DEFAULT_OUT = ROOT / "content" / "mtranslate" / "drafts"
STYLE_FILES = (
    "content/reference/style-sample.txt",
    "content/reference/EtoBnames.txt",
    "content/review/burmese-overview.md",
    "MT.md",
)
STYLE_RULES = (
    "Default prose style is LSE (literature style in essay); quoted character "
    "speech uses LSN (narration style). Do not infer style from a global "
    "particle majority: resolve particles by sentence style and grammatical "
    "role, using top/resolution data rather than replacing a surface globally.",
    "The remote API translates one paragraph at a time and has no story "
    "context. Keep names, titles and forms of address consistent yourself; "
    "paragraphs are independent, so group or split them when a unit needs "
    "more or less context than one source line.",
    "Machine output is a starting point, not a translation. A draft is not "
    "approved text, and nothing here writes to the approved phrase memory.",
)


class DraftError(Exception):
    """An actionable draft-store failure."""


def paragraph_id(chapter: int, index: int, text: str) -> str:
    """Stable id: chapter, 1-based paragraph index, hash of the paragraph text."""
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]
    return f"{chapter:04d}-{index:03d}-{digest}"


@dataclass
class Paragraph:
    chapter: int
    index: int
    text: str
    translation: str = ""

    @property
    def id(self) -> str:
        return paragraph_id(self.chapter, self.index, self.text)


# ---------------------------------------------------------------- reading


def _chapters(path: Path = CHINESE) -> dict[int, Chapter]:
    return {chapter.number: chapter for chapter in chinese_chapters(path)}


def _burmese(path: Path = BURMESE) -> dict[int, BurmeseChapter]:
    try:
        return {chapter.number: chapter for chapter in burmese_chapters(path)}
    except Exception:
        return {}


def chapter_paragraphs_by_number(number: int, *, source: Path = CHINESE,
                                 keep_notes: bool = False) -> list[Paragraph]:
    chapters = _chapters(source)
    chapter = chapters.get(number)
    if chapter is None:
        known = sorted(chapters)
        span = f"{known[0]}–{known[-1]}" if known else "none"
        raise DraftError(f"no Chinese chapter {number} in {source.name} (have {span})")
    return [Paragraph(number, index, text)
            for index, text in enumerate(chapter_paragraphs(chapter,
                                                            keep_notes=keep_notes), 1)]


DEFAULT_TRANSLATIONS = ROOT / "content" / "mtranslate" / "rapidapi"


def load_translation(chapter: int, paragraphs: list["Paragraph"],
                     directory: Path | None = None) -> dict:
    """The API's Burmese for one chapter, aligned to paragraphs by index.

    Written by `mt/api_translate.py --run` as `ch0001.my.jsonl`. Alignment is
    checked, not assumed: a record is only attached when its `source` equals the
    paragraph's Chinese text, so a stale file cannot silently shift the Burmese
    onto the wrong sentence.
    """
    directory = Path(directory) if directory is not None else DEFAULT_TRANSLATIONS
    path = directory / f"ch{chapter:04d}.my.jsonl"
    if not path.is_file():
        return {"available": False, "file": None, "attached": 0,
                "mismatched": 0, "detail": f"no API translation at {path}"}
    by_index: dict[int, dict] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            by_index[int(record.get("index", 0))] = record
    attached = mismatched = 0
    for paragraph in paragraphs:
        record = by_index.get(paragraph.index)
        if record is None:
            continue
        if record.get("source", "").strip() != paragraph.text.strip():
            record["aligned"] = False
            mismatched += 1
            continue
        paragraph.translation = record.get("target", "")
        attached += 1
    return {"available": True, "file": str(path), "attached": attached,
            "mismatched": mismatched,
            "detail": "aligned by index and verified against the source text"}


def read_chapter(number: int, *, source: Path = CHINESE, existing: Path = BURMESE,
                 docx: Path = DOCX, chapter_map: ChapterMap | None = None,
                 store: "DraftStore | None" = None, reference_lines_limit: int = 60,
                 with_reference: bool = True,
                 translations: Path | None = None,
                 start: int | None = None, count: int | None = None) -> dict:
    """Everything an agent needs before translating one chapter.

    `start` and `count` window the paragraphs (1-based, inclusive). They exist
    because the whole chapter is the single most expensive thing an agent can
    ask for: 166 paragraphs of Chinese plus Burmese is ~13k tokens, it is resent
    on every later turn, and Groq's TPM budget is 250k for the whole minute. Ten
    paragraphs at a time is enough to judge, and the `window` block says how
    much is left so nothing gets skipped.
    """
    chapters = _chapters(source)
    paragraphs = chapter_paragraphs_by_number(number, source=source)  # raises if absent
    chapter = chapters[number]
    if chapter_map is None:
        try:
            chapter_map = load_or_derive(None, docx)
        except (ChapterMapError, OSError, KeyError):
            chapter_map = None
    numbers = reference_numbers(chapter_map, number)
    reference: list[str] = []
    if with_reference and numbers:
        burmese = _burmese(existing)
        for ref in numbers:
            if ref in burmese:
                reference.extend(reference_lines(burmese[ref]))
    translation = load_translation(number, paragraphs, translations)
    total = len(paragraphs)
    first = max(1, int(start)) if start else 1
    last = total if count is None else min(total, first + max(1, int(count)) - 1)
    if first > total:
        raise DraftError(f"paragraph {first} is outside this chapter's 1–{total}")
    window = paragraphs[first - 1:last]
    payload = {
        "chapter": number,
        "title": chapter.title,
        "translation": {key: value for key, value in translation.items() if key != "file"},
        "window": {"start": first, "count": len(window), "total": total,
                   "more": last < total, "next_start": last + 1 if last < total else None},
        "paragraphs": [{"id": item.id, "index": item.index, "zh": item.text,
                        **({"my": item.translation} if item.translation else {})}
                       for item in window],
        "reference": {
            "chapters": numbers,
            "lines": len(reference),
            "sample": reference[:reference_lines_limit],
            "truncated": len(reference) > reference_lines_limit,
        },
        "neighbors": {
            "previous": number - 1 if number - 1 in chapters else None,
            "next": number + 1 if number + 1 in chapters else None,
        },
        "style": {
            "rules": list(STYLE_RULES),
            "files": STYLE_FILES,
        },
    }
    if store is not None:
        saved = store.ids_for(number)
        payload["drafts"] = {"saved": len(saved), "missing": total - len(saved),
                             "ids": saved}
    return payload


# ---------------------------------------------------------------- store


class DraftStore:
    """SQLite table of agent drafts; keyed by (chapter, paragraph id)."""

    SCHEMA = """CREATE TABLE IF NOT EXISTS drafts (
        chapter INTEGER NOT NULL,
        paragraph_id TEXT NOT NULL,
        paragraph_index INTEGER NOT NULL,
        zh TEXT NOT NULL,
        draft_text TEXT NOT NULL,
        mt_text TEXT,
        model TEXT,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (chapter, paragraph_id)
    )"""

    def __init__(self, path: Path | str = DEFAULT_STORE) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path)
        self.db.execute(self.SCHEMA)
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    def __enter__(self) -> "DraftStore":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- writing ------------------------------------------------------

    def save(self, paragraph: Paragraph, draft_text: str, *, ai_text: str | None = None,
             mt_text: str | None = None, model: str | None = None,
             note: str | None = None) -> dict:
        """Store one revised paragraph.

        `ai_text` is the AI translation the revision started from (the RapidAPI
        output). `mt_text` is the legacy machine-translated column and is kept
        only for rows written before the AI column existed; it is not the same
        thing and must not be conflated. The column is still called `mt_text`
        in SQLite so existing stores stay readable.
        """
        source_text = ai_text if ai_text is not None else mt_text
        text = (draft_text or "").strip()
        if not text:
            raise DraftError("draft text is empty")
        self.db.execute(
            """INSERT INTO drafts (chapter, paragraph_id, paragraph_index, zh,
                                   draft_text, mt_text, model, note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(chapter, paragraph_id) DO UPDATE SET
                   draft_text = excluded.draft_text,
                   mt_text = COALESCE(excluded.mt_text, drafts.mt_text),
                   model = COALESCE(excluded.model, drafts.model),
                   note = COALESCE(excluded.note, drafts.note),
                   updated_at = datetime('now')""",
            (paragraph.chapter, paragraph.id, paragraph.index, paragraph.text,
             text, source_text, model, note),
        )
        self.db.commit()
        return {"status": "saved", "chapter": paragraph.chapter,
                "paragraph_id": paragraph.id, "index": paragraph.index,
                "characters": len(text)}

    def note(self, chapter: int, paragraph: str, note: str) -> dict:
        row = self.find(chapter, paragraph)
        if row is None:
            raise DraftError(f"no draft for {chapter}/{paragraph}")
        self.db.execute("UPDATE drafts SET note = ?, updated_at = datetime('now') "
                        "WHERE chapter = ? AND paragraph_id = ?",
                        (note, chapter, row["paragraph_id"]))
        self.db.commit()
        return {"status": "noted", "paragraph_id": row["paragraph_id"]}

    # -- reading ------------------------------------------------------

    def find(self, chapter: int, selector: str | int) -> dict | None:
        """Look up by paragraph id, 1-based index, or a unique id prefix."""
        selector = str(selector).strip()
        columns = ("chapter, paragraph_id, paragraph_index, zh, draft_text, mt_text,"
                   " model, note, status, created_at, updated_at")
        if selector.isdigit():
            row = self.db.execute(
                f"SELECT {columns} FROM drafts WHERE chapter = ? AND paragraph_index = ?",
                (chapter, int(selector))).fetchone()
        else:
            row = self.db.execute(
                f"SELECT {columns} FROM drafts WHERE chapter = ? AND paragraph_id = ?",
                (chapter, selector)).fetchone()
            if row is None:
                rows = self.db.execute(
                    f"SELECT {columns} FROM drafts WHERE chapter = ? AND paragraph_id"
                    " LIKE ?", (chapter, selector + "%")).fetchall()
                row = rows[0] if len(rows) == 1 else None
        if row is None:
            return None
        keys = ("chapter", "paragraph_id", "index", "zh", "draft_text", "mt_text",
                "model", "note", "status", "created_at", "updated_at")
        return dict(zip(keys, row))

    def rows_for(self, chapter: int) -> list[dict]:
        columns = ("paragraph_id, paragraph_index, zh, draft_text, mt_text, model,"
                   " note, status, updated_at")
        rows = self.db.execute(
            f"SELECT {columns} FROM drafts WHERE chapter = ? ORDER BY paragraph_index",
            (chapter,)).fetchall()
        keys = ("paragraph_id", "index", "zh", "draft_text", "mt_text", "model",
                "note", "status", "updated_at")
        return [dict(zip(keys, row)) for row in rows]

    def ids_for(self, chapter: int) -> list[str]:
        return [row[0] for row in self.db.execute(
            "SELECT paragraph_id FROM drafts WHERE chapter = ? ORDER BY paragraph_index",
            (chapter,))]

    def chapters(self) -> list[dict]:
        rows = self.db.execute(
            """SELECT chapter, COUNT(*), SUM(LENGTH(draft_text)),
                      MAX(updated_at), GROUP_CONCAT(DISTINCT model)
               FROM drafts GROUP BY chapter ORDER BY chapter""").fetchall()
        return [{"chapter": row[0], "drafts": row[1], "characters": row[2] or 0,
                 "updated": row[3], "models": row[4]} for row in rows]

    def stats(self) -> dict:
        row = self.db.execute(
            "SELECT COUNT(*), COUNT(DISTINCT chapter), COALESCE(SUM(LENGTH(draft_text)), 0)"
            " FROM drafts").fetchone()
        return {"drafts": row[0], "chapters": row[1], "characters": row[2],
                "store": str(self.path)}

    # -- export -------------------------------------------------------

    def export(self, chapter: int, out_dir: Path | str = DEFAULT_OUT, *,
               require_all: bool = False, source: Path = CHINESE,
               include_verse: bool = True) -> dict:
        paragraphs = chapter_paragraphs_by_number(chapter, source=source)
        rows = {row["index"]: row for row in self.rows_for(chapter)}
        missing = [item.index for item in paragraphs if item.index not in rows]
        if require_all and missing:
            raise DraftError(f"chapter {chapter} is missing drafts for paragraphs "
                             f"{missing[:10]}{' …' if len(missing) > 10 else ''}")
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        text_path = out_dir / f"ch{chapter:04d}.draft.my.txt"
        text_path.write_text(
            "\n\n".join(rows[item.index]["draft_text"] if item.index in rows
                        else item.text for item in paragraphs) + "\n",
            encoding="utf-8")
        compare_path = out_dir / f"ch{chapter:04d}.draft.compare.md"
        lines = [
            f"# Chapter {chapter} — draft comparison",
            "",
            f"{len(rows)}/{len(paragraphs)} paragraphs drafted"
            f"{f'; missing {missing[:10]}' if missing else ''}.",
            "",
            "`machine` is the API output the draft started from; `draft` is the "
            "agent's adjusted text. Neither is approved text.",
            "",
        ]
        for item in paragraphs:
            row = rows.get(item.index)
            lines.append(f"**{item.index}.** {item.text}")
            lines.append("")
            if row is None:
                lines.extend(["> _no draft yet_", ""])
                continue
            if row["mt_text"]:
                lines.extend([f"machine: {row['mt_text']}", ""])
            lines.extend([f"draft: {row['draft_text']}",
                          f"<sub>{row['paragraph_id']} · {row['model'] or 'model not set'}"
                          f" · {row['status']}</sub>", ""])
        body = "\n".join(lines).rstrip() + "\n"
        # The verse section belongs at the end of the chapter file, not in a
        # drawer: it is the part the human reads most carefully.
        verse_note = None
        if include_verse:
            import verse as verse_store  # noqa: PLC0415
            verse_rows = verse_store.load(chapter)
            if verse_rows:
                body += "\n---\n\n" + verse_store.render(chapter, verse_rows)
                verse_note = {"lines": len(verse_rows),
                              "kinds": sorted({row["kind"] for row in verse_rows})}
        compare_path.write_text(body, encoding="utf-8")
        return {"chapter": chapter, "drafted": len(rows), "paragraphs": len(paragraphs),
                "missing": len(missing), "missing_first": missing[:10],
                "verse": verse_note,
                "files": [str(text_path), str(compare_path)]}


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--store", type=Path, default=DEFAULT_STORE)
    parser.add_argument("--source", type=Path, default=CHINESE,
                        help="Chinese source text")
    parser.add_argument("--existing", type=Path, default=BURMESE,
                        help="existing human Burmese")
    parser.add_argument("--docx", type=Path, default=DOCX)
    parser.add_argument("--json", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    read = sub.add_parser("read", help="chapter text, ids and reference Burmese")
    read.add_argument("chapter", type=int)
    read.add_argument("--reference-lines", type=int, default=60)
    read.add_argument("--no-reference", action="store_true")

    save = sub.add_parser("save", help="store the agent's text for one paragraph")
    save.add_argument("chapter", type=int)
    save.add_argument("paragraph", help="1-based index or paragraph id")
    group = save.add_mutually_exclusive_group(required=True)
    group.add_argument("--draft", help="the adjusted Burmese text")
    group.add_argument("--draft-file", type=Path,
                       help="read the text from a file (UTF-8)")
    save.add_argument("--ai-text", help="AI translation this draft started from")
    save.add_argument("--mt", help="deprecated alias of --ai-text")
    save.add_argument("--model", help="which model wrote the draft")
    save.add_argument("--note", help="free-form note")

    note = sub.add_parser("note", help="attach a note to an existing draft")
    note.add_argument("chapter", type=int)
    note.add_argument("paragraph")
    note.add_argument("text")

    export = sub.add_parser("export", help="write chapter text and comparison")
    export.add_argument("chapter", type=int)
    export.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    export.add_argument("--require-all", action="store_true")

    listing = sub.add_parser("list", help="drafts in a chapter, or all chapters")
    listing.add_argument("--chapter", type=int, default=None)

    sub.add_parser("stats", help="totals for the whole store")

    args = parser.parse_args(argv)
    try:
        with DraftStore(args.store) as store:
            if args.command == "read":
                payload = read_chapter(args.chapter, source=args.source,
                                       existing=args.existing, docx=args.docx,
                                       store=store,
                                       reference_lines_limit=args.reference_lines,
                                       with_reference=not args.no_reference)
            elif args.command == "save":
                paragraphs = chapter_paragraphs_by_number(args.chapter, source=args.source)
                if args.draft_file:
                    text = args.draft_file.read_text(encoding="utf-8")
                else:
                    text = args.draft
                selected = _select(paragraphs, args.paragraph)
                payload = store.save(selected, text, ai_text=args.ai_text or args.mt,
                                     model=args.model, note=args.note)
            elif args.command == "note":
                payload = store.note(args.chapter, args.paragraph, args.text)
            elif args.command == "export":
                payload = store.export(args.chapter, args.out_dir,
                                       require_all=args.require_all,
                                       source=args.source)
            elif args.command == "list":
                payload = ({"chapter": args.chapter, "drafts": store.rows_for(args.chapter)}
                           if args.chapter is not None else {"chapters": store.chapters()})
            else:
                payload = store.stats()
    except DraftError as error:
        print(f"[draft] {error}", file=sys.stderr)
        return 2

    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def _select(paragraphs: list[Paragraph], selector: str) -> Paragraph:
    selector = str(selector).strip()
    if selector.isdigit():
        index = int(selector)
        if not 1 <= index <= len(paragraphs):
            raise DraftError(f"paragraph {index} is outside 1–{len(paragraphs)}")
        return paragraphs[index - 1]
    matches = [item for item in paragraphs if item.id == selector]
    if not matches:
        matches = [item for item in paragraphs if item.id.startswith(selector)]
    if len(matches) != 1:
        raise DraftError(f"paragraph id {selector!r} matched {len(matches)} paragraphs")
    return matches[0]


if __name__ == "__main__":
    sys.exit(main())
