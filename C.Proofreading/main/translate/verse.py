#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///

"""Poems and philosophy lines: the agent's English, kept for careful review.

**This module does not find verse.** Whether a line is a poem, a maxim, a song,
an inscription or a throwaway quotation is a reading judgement, and the agent
that re-matches tone already has the paragraph in front of it. A regex cannot
tell a couplet from a short sentence, and the cost of guessing wrong is a
"poem" section full of ordinary prose — or, worse, a real couplet left judging
drafts while nobody notices. So the agent decides, and this file is where the
decision is stored and where the human reads it.

What it is for: at the end of a chapter, every poem, song or philosophy line
gets an English version — either the local zh-en model's line or the agent's
own — in a section of its own, so the human can check the Burmese rendering
against something readable without opening the Chinese.

Three texts, kept apart on purpose:

    the Chinese line      what the poem says
    the English           zh-en output (flat but literal) or the agent's own
    the AI Burmese        what is being judged; never edited here

Nothing in this file touches the draft store, the AI translation, the name
list, or the engine. It writes two files per chapter under
`content/mtranslate/verse/`:

    ch0194.verse.jsonl    one record per line the agent judged to be verse
    ch0194.verse.md       the review section: Chinese | English | why

    python3 mt/verse.py add 194 --paragraph 161 --kind poem \\
        --english "Even the wind has grown weary of blowing." \\
        --source own --note "parallel couplet, closes the chapter's elegy"
    python3 mt/verse.py add 194 --kind none --note "read the chapter twice, no verse"
    python3 mt/verse.py list 194
    python3 mt/verse.py export 194
    python3 mt/verse.py mt 194            # numbered zh-en lines, to quote from
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEFAULT_DIR = ROOT / "content" / "mtranslate" / "verse"
ZH_EN = ROOT / "content" / "mtranslate" / "zh-en.txt"

# `none` is not a line; it records that the agent looked and found nothing. It
# is the only way a reader can tell "no poems here" from "the agent skipped it".
KINDS = ("poem", "philosophy", "song", "inscription", "maxim", "other", "none")
SOURCES = ("mt", "own", "mixed")


class VerseError(Exception):
    """An actionable verse-store failure."""


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def paths(chapter: int, directory: Path | str | None = None) -> tuple[Path, Path]:
    directory = Path(directory) if directory is not None else DEFAULT_DIR
    return (directory / f"ch{chapter:04d}.verse.jsonl",
            directory / f"ch{chapter:04d}.verse.md")


def load(chapter: int, directory: Path | str | None = None) -> list[dict]:
    """Every stored line for one chapter, in paragraph order."""
    data, _ = paths(chapter, directory)
    if not data.is_file():
        return []
    rows: list[dict] = []
    for number, raw in enumerate(data.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise VerseError(f"{data} line {number}: {error}") from None
    return sorted(rows, key=lambda row: row.get("index") or 0)


def _write(rows: list[dict], chapter: int, directory: Path | str | None) -> Path:
    data, _ = paths(chapter, directory)
    data.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    fd, temporary = tempfile.mkstemp(prefix=".verse-", dir=data.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, data)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return data


def _paragraph(chapter: int, selector: str | int, source: Path | str | None):
    """The source paragraph, so the record carries the Chinese it came from."""
    from agent_work import DraftError, _select, chapter_paragraphs_by_number  # noqa: PLC0415
    from api_translate import CHINESE  # noqa: PLC0415

    paragraphs = chapter_paragraphs_by_number(
        chapter, source=Path(source or CHINESE))
    try:
        return _select(paragraphs, str(selector)), len(paragraphs)
    except DraftError as error:
        raise VerseError(str(error)) from None


def save(chapter: int, *, kind: str, paragraph: str | int | None = None,
         english: str = "", english_source: str = "own",
         mt_english: str | None = None, note: str = "",
         model: str | None = None, source: Path | str | None = None,
         directory: Path | str | None = None) -> dict:
    """Store one judged line, or the fact that the chapter has none.

    `english_source` says where the English came from: `mt` is the local zh-en
    model, `own` is the agent's rendering, `mixed` means it leaned on the model
    and rewrote it. It is recorded because the human reviews them differently.
    """
    kind = (kind or "").strip()
    if kind not in KINDS:
        raise VerseError(f"kind {kind!r} is not one of: {', '.join(KINDS)}")
    english_source = (english_source or "own").strip()
    if english_source not in SOURCES:
        raise VerseError(
            f"english_source {english_source!r} is one of: {', '.join(SOURCES)}")

    rows = load(chapter, directory)
    rows = [row for row in rows if row.get("kind") != "none"]

    if kind == "none":
        if rows:
            raise VerseError(
                f"chapter {chapter} already has {len(rows)} verse line(s); "
                "`none` contradicts them — delete the lines first or drop `none`")
        if (english or "").strip():
            raise VerseError("kind `none` takes no English")
        record = {"chapter": chapter, "kind": "none", "note": note.strip(),
                  "model": model, "saved_at": _now()}
    else:
        if paragraph is None:
            raise VerseError(f"kind {kind!r} needs a paragraph")
        text = (english or "").strip()
        if not text:
            raise VerseError("`english` must be a non-empty string")
        item, total = _paragraph(chapter, paragraph, source)
        record = {
            "chapter": chapter,
            "paragraph_id": item.id,
            "index": item.index,
            "paragraphs": total,
            "kind": kind,
            "zh": item.text,
            "english": text,
            "english_source": english_source,
            "mt_english": (mt_english or "").strip() or None,
            "note": note.strip(),
            "model": model,
            "saved_at": _now(),
        }
        # One record per paragraph: a re-save replaces, it does not append.
        rows = [row for row in rows if row.get("paragraph_id") != item.id]
    rows.append(record)
    _write(sorted(rows, key=lambda row: row.get("index") or 0), chapter, directory)
    return record


def mt_lines(chapter: int, route_dir: Path | str | None = None) -> list[str]:
    """The zh-en body for one chapter, one line per model sentence.

    The default is the consolidated `zh-en.txt`; an explicitly supplied
    directory remains supported for old temporary per-chapter runs.
    """
    path = Path(route_dir) if route_dir is not None else ZH_EN
    if path.is_dir():
        chapter_path = path / f"ch{chapter:04d}.en.txt"
        if not chapter_path.is_file():
            return []
        lines = chapter_path.read_text(encoding="utf-8").splitlines()
        body = lines[2:] if len(lines) > 1 and set(lines[1].strip()) <= {"="} else lines[1:]
        return [line.strip() for line in body if line.strip()]
    if not path.is_file():
        return []
    active = False
    found = False
    body: list[str] = []
    marker = re.compile(r"^===== Chapter (\d+)(?: — .*?)? =====$")
    for line in path.read_text(encoding="utf-8").splitlines():
        match = marker.match(line)
        if match:
            if active:
                break
            active = int(match.group(1)) == chapter
            found = found or active
        elif active:
            body.append(line)
    return [line.strip() for line in "\n".join(body).strip().splitlines() if line.strip()] if found else []


def render(chapter: int, rows: list[dict] | None = None,
           directory: Path | str | None = None) -> str:
    """The markdown review section for one chapter."""
    rows = load(chapter, directory) if rows is None else rows
    total = next((row.get("paragraphs") for row in rows if row.get("paragraphs")), None)
    lines = [
        f"# Chapter {chapter} — poems, songs and philosophy lines",
        "",
        "**This section is not part of the draft.** It is the agent's reading of the "
        "chapter's verse and maxims, with an English version for each, so the Burmese "
        "rendering can be checked against something readable. Nothing here is "
        "approved text and nothing here rewrites the AI translation.",
        "",
        "The agent chose these lines by reading. No tool extracts verse — the "
        "boundary between a short sentence and a line of poetry is a judgement.",
        "",
    ]
    if not rows:
        lines.extend([
            "**Nothing recorded for this chapter.** The agent has not judged it yet, "
            "or the judgement was not saved. Ask for "
            f"`save_verse {{\"chapter\": {chapter}, \"kind\": \"none\"}}` if the "
            "chapter really has no verse.",
            "",
        ])
        return "\n".join(lines)

    if any(row.get("kind") == "none" for row in rows):
        marker = next(row for row in rows if row["kind"] == "none")
        lines.extend([
            f"**Checked, no verse found.** {marker.get('saved_at', '')}"
            + (f" — {marker['note']}" if marker.get("note") else ""),
            "",
        ])
        return "\n".join(lines)

    counts: dict[str, int] = {}
    for row in rows:
        counts[row["kind"]] = counts.get(row["kind"], 0) + 1
    summary = ", ".join(f"{kind} {count}" for kind, count in sorted(counts.items()))
    coverage = (f"{total} paragraphs in the chapter, " if total else "") + \
               f"{len(rows)} line(s) saved ({summary})"
    lines.extend([f"Coverage: {coverage}.", ""])

    for row in rows:
        source = {"mt": "zh-en model", "own": "agent", "mixed": "zh-en, rewritten"}[
            row.get("english_source", "own")]
        lines.extend([
            f"## {row.get('index')} — {row['kind']}",
            "",
            f"`{row.get('paragraph_id', '')}`",
            "",
            f"**Chinese.** {row.get('zh', '')}",
            "",
        ])
        if row.get("mt_english"):
            lines.extend([f"**zh-en.** {row['mt_english']}", ""])
        lines.extend([
            f"**English ({source}).** {row['english']}",
            "",
        ])
        if row.get("note"):
            lines.extend([f"**Why.** {row['note']}", ""])
    return "\n".join(lines).rstrip() + "\n"


def export(chapter: int, *, directory: Path | str | None = None,
           out_dir: Path | str | None = None) -> dict:
    """Write the review section and report what it holds."""
    rows = load(chapter, directory)
    text = render(chapter, rows, directory)
    _, markdown = paths(chapter, out_dir or directory)
    markdown.parent.mkdir(parents=True, exist_ok=True)
    markdown.write_text(text, encoding="utf-8")
    by_kind: dict[str, int] = {}
    for row in rows:
        by_kind[row["kind"]] = by_kind.get(row["kind"], 0) + 1
    return {"chapter": chapter, "file": str(markdown), "lines": len(rows),
            "kinds": by_kind, "checked": any(r["kind"] == "none" for r in rows),
            "empty": not rows}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Poems and philosophy lines: the agent's English, for review.",
        epilog="Nothing here detects verse. The agent reads the chapter and "
               "records what it judged to be verse or a maxim.")
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR,
                        help=f"store directory (default: {DEFAULT_DIR.relative_to(ROOT)})")
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add", help="store one line, or record that there is none")
    add.add_argument("chapter", type=int)
    add.add_argument("--paragraph", help="1-based index or paragraph id")
    add.add_argument("--kind", required=True, help=", ".join(KINDS))
    add.add_argument("--english", default="", help="the English version")
    add.add_argument("--source", default="own", choices=SOURCES,
                     help="where the English came from (default: own)")
    add.add_argument("--mt-english", default=None, help="the zh-en line, if quoted")
    add.add_argument("--note", default="", help="why this line, and what to watch")
    add.add_argument("--model", default=None)

    listing = sub.add_parser("list", help="stored lines for a chapter")
    listing.add_argument("chapter", type=int)

    render_cmd = sub.add_parser("render", help="print the review section")
    render_cmd.add_argument("chapter", type=int)

    export_cmd = sub.add_parser("export", help="write the review section to disk")
    export_cmd.add_argument("chapter", type=int)

    mt = sub.add_parser("mt", help="numbered zh-en lines for a chapter")
    mt.add_argument("chapter", type=int)

    args = parser.parse_args(argv)
    try:
        if args.command == "add":
            record = save(args.chapter, kind=args.kind, paragraph=args.paragraph,
                          english=args.english, english_source=args.source,
                          mt_english=args.mt_english, note=args.note,
                          model=args.model, directory=args.dir)
            print(json.dumps(record, ensure_ascii=False, indent=2))
            return 0
        if args.command == "list":
            print(json.dumps(load(args.chapter, args.dir), ensure_ascii=False, indent=2))
            return 0
        if args.command == "render":
            print(render(args.chapter, directory=args.dir))
            return 0
        if args.command == "export":
            print(json.dumps(export(args.chapter, directory=args.dir),
                             ensure_ascii=False, indent=2))
            return 0
        lines = mt_lines(args.chapter)
        if not lines:
            print(f"[verse] no zh-en lines for chapter {args.chapter}; run "
                  "`python3 mt/translate.py --route zh-en` or write your own",
                  file=sys.stderr)
            return 2
        for number, line in enumerate(lines, 1):
            print(f"{number:>4}  {line}")
        return 0
    except VerseError as error:
        print(f"[verse] {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
