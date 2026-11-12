# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Approved phrase memory for the Chinese/Burmese MT workbench (backend only).

Exact approved entries can be reused without a paid request. Similar entries are
suggestions, never silent replacements. Machine output is never auto-approved.
The database is local and ignored in Git; export JSONL to review/commit memory.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import unicodedata

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MEMORY = ROOT / "content" / "mtranslate" / "memory.sqlite3"
STATUSES = ("suggested", "approved")
KINDS = ("phrase", "term")
ENTITY = re.compile(r"&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#x[0-9A-Fa-f]+);")
BARE_ENTITY = re.compile(r"&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#x[0-9A-Fa-f]+)")
EDGE_PUNCTUATION = " \t\r\n\"'“”‘’「」『』（）()《》〈〉【】[]"
LANGUAGE = re.compile(r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")
SEPARATOR = re.compile(r"[\n。！？!?；;]+")
MAX_TEXT = 10_000


class MemoryError_(Exception):
    """Invalid memory operation; contains no credentials."""


def normalize(text: str) -> str:
    """Matching form only. Never write this back over the user's text."""
    if not isinstance(text, str):
        raise MemoryError_("Translation-memory text must be a string")
    value = unicodedata.normalize("NFKC", text)
    return " ".join(value.split())


def _text(value: str, label: str) -> tuple[str, str]:
    if not isinstance(value, str) or "\x00" in value:
        raise MemoryError_(f"{label} must be a string without NUL")
    norm = normalize(value)
    if not norm:
        raise MemoryError_(f"{label} cannot be empty")
    if len(value) > MAX_TEXT:
        raise MemoryError_(f"{label} exceeds {MAX_TEXT} characters")
    return value, norm


def _route(source_lang: str, target_lang: str) -> tuple[str, str]:
    for label, value in (("source language", source_lang), ("target language", target_lang)):
        if not isinstance(value, str) or not LANGUAGE.fullmatch(value):
            raise MemoryError_(f"Invalid {label}")
    if source_lang == target_lang:
        raise MemoryError_("Source and target languages must differ")
    return source_lang, target_lang


@dataclass(frozen=True)
class Entry:
    id: int
    source: str
    target: str
    source_lang: str
    target_lang: str
    status: str
    kind: str
    note: str
    uses: int
    created_at: str
    updated_at: str


def _entry(row) -> Entry:
    return Entry(*row)


class Memory:
    """Route-specific translation memory. Approved exact matches are reusable."""

    def __init__(self, path: Path = DEFAULT_MEMORY, *, readonly: bool = False):
        self.path = Path(path)
        self.db = None
        if readonly and not self.path.exists():
            return
        if not readonly:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        target = self.path.as_uri() + "?mode=ro" if readonly else str(self.path)
        self.db = sqlite3.connect(target, uri=readonly)
        self.db.execute("PRAGMA foreign_keys = ON")
        if readonly:
            columns = {row[1] for row in self.db.execute("PRAGMA table_info(memory)")}
            if "kind" not in columns:
                raise MemoryError_("Old phrase-memory schema; run a writable mt/mt_memory.py command to migrate it")
        if not readonly:
            self.db.execute(
                """CREATE TABLE IF NOT EXISTS memory (
                    id INTEGER PRIMARY KEY,
                    source TEXT NOT NULL,
                    source_norm TEXT NOT NULL,
                    target TEXT NOT NULL,
                    source_lang TEXT NOT NULL,
                    target_lang TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('suggested','approved')),
                    kind TEXT NOT NULL DEFAULT 'phrase' CHECK (kind IN ('phrase','term')),
                    note TEXT NOT NULL DEFAULT '',
                    uses INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (source_lang, target_lang, source_norm)
                )"""
            )
            columns = {row[1] for row in self.db.execute("PRAGMA table_info(memory)")}
            if "kind" not in columns:
                self.db.execute("ALTER TABLE memory ADD COLUMN kind TEXT NOT NULL DEFAULT 'phrase'")
            self.db.commit()

    def close(self):
        if self.db is not None:
            self.db.close()
            self.db = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def add(self, source: str, target: str, source_lang: str, target_lang: str,
            *, status: str = "suggested", kind: str = "phrase", note: str = "",
            _commit: bool = True) -> Entry:
        if self.db is None:
            raise MemoryError_("Translation memory is read-only")
        source, source_norm = _text(source, "source")
        target, _ = _text(target, "target")
        source_lang, target_lang = _route(source_lang, target_lang)
        if status not in STATUSES:
            raise MemoryError_("Status must be suggested or approved")
        if kind not in KINDS:
            raise MemoryError_("Kind must be phrase or term")
        if not isinstance(note, str) or "\x00" in note:
            raise MemoryError_("Note must be a string without NUL")
        existing = self._row(source_lang, target_lang, source_norm)
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if existing is None:
            cursor = self.db.execute(
                """INSERT INTO memory
                   (source, source_norm, target, source_lang, target_lang, status, kind, note,
                    uses, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)""",
                (source, source_norm, target, source_lang, target_lang, status, kind, note, now, now),
            )
            if _commit:
                self.db.commit()
            return self.get(cursor.lastrowid)
        if existing.status == "approved" and status == "suggested":
            raise MemoryError_("An approved entry already exists; approve or update it explicitly")
        self.db.execute(
            """UPDATE memory SET source=?, target=?, status=?, kind=?, note=?, updated_at=?
               WHERE id=?""",
            (source, target, status, kind, note, now, existing.id),
        )
        if _commit:
            self.db.commit()
        return self.get(existing.id)

    def _row(self, source_lang: str, target_lang: str, source_norm: str):
        row = self.db.execute(
            """SELECT id, source, target, source_lang, target_lang, status, kind, note,
                      uses, created_at, updated_at
               FROM memory WHERE source_lang=? AND target_lang=? AND source_norm=?""",
            (source_lang, target_lang, source_norm),
        ).fetchone()
        if row is None:
            return None
        entry = _entry(row)
        if not entry.target.strip() or entry.status not in STATUSES:
            raise MemoryError_("Invalid translation-memory entry")
        return entry

    def get(self, entry_id: int) -> Entry:
        if self.db is None:
            raise MemoryError_("Translation memory is read-only")
        row = self.db.execute(
            """SELECT id, source, target, source_lang, target_lang, status, kind, note,
                      uses, created_at, updated_at FROM memory WHERE id=?""",
            (int(entry_id),),
        ).fetchone()
        if row is None:
            raise MemoryError_(f"No translation-memory entry {entry_id}")
        return _entry(row)

    def approve(self, entry_id: int) -> Entry:
        if self.db is None:
            raise MemoryError_("Translation memory is read-only")
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        cursor = self.db.execute(
            "UPDATE memory SET status='approved', updated_at=? WHERE id=?",
            (now, int(entry_id)),
        )
        if cursor.rowcount != 1:
            raise MemoryError_(f"No translation-memory entry {entry_id}")
        self.db.commit()
        return self.get(entry_id)

    def delete(self, entry_id: int) -> None:
        if self.db is None:
            raise MemoryError_("Translation memory is read-only")
        cursor = self.db.execute("DELETE FROM memory WHERE id=?", (int(entry_id),))
        if cursor.rowcount != 1:
            raise MemoryError_(f"No translation-memory entry {entry_id}")
        self.db.commit()

    def exact(self, text: str, source_lang: str, target_lang: str, *, count_use: bool = False):
        """Return only an APPROVED, exact route match (or None)."""
        if self.db is None:
            return None
        source_lang, target_lang = _route(source_lang, target_lang)
        source_norm = normalize(text)
        if not source_norm:
            return None
        entry = self._row(source_lang, target_lang, source_norm)
        if entry is None or entry.status != "approved":
            return None
        if count_use:
            self.db.execute("UPDATE memory SET uses=uses+1 WHERE id=?", (entry.id,))
            self.db.commit()
            entry = self.get(entry.id)
        return entry

    def suggestions(self, text: str, source_lang: str, target_lang: str,
                    *, limit: int = 3, min_score: float = 0.45):
        """Similarity candidates for human review; never auto-applied."""
        if self.db is None:
            return []
        source_lang, target_lang = _route(source_lang, target_lang)
        query = normalize(text)
        if len(query) < 2 or limit < 0:
            return []
        rows = self.db.execute(
            """SELECT id, source, target, source_lang, target_lang, status, kind, note,
                      uses, created_at, updated_at
               FROM memory WHERE source_lang=? AND target_lang=? AND source_norm<>?
               ORDER BY uses DESC, updated_at DESC LIMIT 20000""",
            (source_lang, target_lang, query),
        ).fetchall()
        ranked = []
        for row in rows:
            entry = _entry(row)
            candidate = normalize(entry.source)
            if not candidate:
                continue
            if query in candidate or candidate in query:
                score = 0.85
            else:
                matcher = SequenceMatcher(None, query, candidate, autojunk=False)
                if matcher.quick_ratio() < min_score:
                    continue
                score = matcher.ratio()
            if score >= min_score:
                ranked.append((score, entry))
        ranked.sort(key=lambda item: (item[0], item[1].uses, item[1].updated_at), reverse=True)
        return [{"entry": entry, "score": round(score, 3)} for score, entry in ranked[:limit]]

    def phrase_hits(self, text: str, source_lang: str, target_lang: str,
                    *, limit: int = 20, min_chars: int = 2, kind: str | None = None):
        """Approved phrases occurring inside a larger unit; report-only."""
        if self.db is None:
            return []
        source_lang, target_lang = _route(source_lang, target_lang)
        if kind is not None and kind not in KINDS:
            raise MemoryError_("Kind must be phrase or term")
        haystack = normalize(text)
        if not haystack:
            return []
        rows = self.db.execute(
            """SELECT id, source, target, source_lang, target_lang, status, kind, note,
                      uses, created_at, updated_at
               FROM memory WHERE source_lang=? AND target_lang=? AND status='approved'
                 AND (? IS NULL OR kind=?)""",
            (source_lang, target_lang, kind, kind),
        ).fetchall()
        hits = []
        for row in rows:
            entry = _entry(row)
            needle = normalize(entry.source)
            if len(needle) < min_chars or needle == haystack:
                continue
            count = haystack.count(needle)
            if count:
                hits.append({"entry": entry, "occurrences": count, "chars": len(needle)})
        hits.sort(key=lambda item: (item["occurrences"] * item["chars"], item["entry"].uses), reverse=True)
        return hits[:limit]

    def glossary(self, source_lang: str, target_lang: str, *, limit: int = 200):
        """Approved terms for one route, longest first. Reference only."""
        if self.db is None:
            return []
        source_lang, target_lang = _route(source_lang, target_lang)
        rows = self.db.execute(
            """SELECT id, source, target, source_lang, target_lang, status, kind, note,
                      uses, created_at, updated_at
               FROM memory
               WHERE source_lang=? AND target_lang=? AND status='approved' AND kind='term'
               ORDER BY length(source_norm) DESC, uses DESC, source_norm
               LIMIT ?""",
            (source_lang, target_lang, max(1, int(limit))),
        ).fetchall()
        return [_entry(row) for row in rows]

    def list(self, *, status: str | None = None, kind: str | None = None,
             limit: int = 100):
        if self.db is None:
            return []
        if status is not None and status not in STATUSES:
            raise MemoryError_("Status must be suggested or approved")
        if kind is not None and kind not in KINDS:
            raise MemoryError_("Kind must be phrase or term")
        sql = """SELECT id, source, target, source_lang, target_lang, status, kind, note,
                        uses, created_at, updated_at FROM memory"""
        clauses, params = [], []
        if status is not None:
            clauses.append("status=?")
            params.append(status)
        if kind is not None:
            clauses.append("kind=?")
            params.append(kind)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY updated_at DESC, id DESC LIMIT ?"
        params.append(max(1, int(limit)))
        return [_entry(row) for row in self.db.execute(sql, params).fetchall()]

    def stats(self):
        if self.db is None:
            return {"entries": 0, "approved": 0, "suggested": 0, "terms": 0,
                    "approved_terms": 0, "reuses": 0, "routes": []}
        counts = dict(self.db.execute("SELECT status, count(*) FROM memory GROUP BY status").fetchall())
        routes = [
            {"source_lang": row[0], "target_lang": row[1], "entries": row[2],
             "terms": row[3] or 0, "approved_terms": row[4] or 0, "reuses": row[5] or 0}
            for row in self.db.execute(
                """SELECT source_lang, target_lang, count(*),
                          sum(CASE WHEN kind='term' THEN 1 ELSE 0 END),
                          sum(CASE WHEN kind='term' AND status='approved' THEN 1 ELSE 0 END),
                          sum(uses)
                   FROM memory GROUP BY source_lang, target_lang
                   ORDER BY count(*) DESC"""
            )
        ]
        terms = self.db.execute("SELECT count(*) FROM memory WHERE kind='term'").fetchone()[0]
        approved_terms = self.db.execute(
            "SELECT count(*) FROM memory WHERE kind='term' AND status='approved'").fetchone()[0]
        return {"entries": sum(counts.values()), "approved": counts.get("approved", 0),
                "suggested": counts.get("suggested", 0), "terms": terms,
                "approved_terms": approved_terms,
                "reuses": self.db.execute("SELECT COALESCE(sum(uses),0) FROM memory").fetchone()[0],
                "routes": routes}

    def export_jsonl(self, path: Path) -> int:
        if self.db is None:
            raise MemoryError_("Translation memory is read-only")
        if Path(path).resolve() == self.path.resolve():
            raise MemoryError_("Export must not replace the memory database")
        rows = self.db.execute(
            """SELECT source, target, source_lang, target_lang, status, kind, note
               FROM memory ORDER BY id"""
        ).fetchall()
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".memory-", dir=target.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                for source, translated, source_lang, target_lang, status, kind, note in rows:
                    stream.write(json.dumps({
                        "source": source, "target": translated,
                        "source_lang": source_lang, "target_lang": target_lang,
                        "status": status, "kind": kind, "note": note,
                    }, ensure_ascii=False) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return len(rows)

    def import_jsonl(self, path: Path, *, status: str | None = None) -> dict:
        if self.db is None:
            raise MemoryError_("Translation memory is read-only")
        if status is not None and status not in STATUSES:
            raise MemoryError_("Status must be suggested or approved")
        records = []
        for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError
                entry_status = status or value.get("status", "suggested")
                if entry_status not in STATUSES:
                    raise ValueError
                kind = value.get("kind", "phrase")
                if kind not in KINDS:
                    raise ValueError
                source, _ = _text(value["source"], "source")
                target, _ = _text(value["target"], "target")
                source_lang, target_lang = _route(value["source_lang"], value["target_lang"])
                note = value.get("note", "")
                if not isinstance(note, str) or "\x00" in note:
                    raise ValueError
            except (ValueError, KeyError, TypeError, MemoryError_) as error:
                raise MemoryError_(f"Invalid memory import at line {number}") from error
            records.append((source, target, source_lang, target_lang, entry_status, kind, note))
        added = updated = skipped = 0
        with self.db:
            for source, target, source_lang, target_lang, entry_status, kind, note in records:
                source_norm = normalize(source)
                existing = self._row(source_lang, target_lang, source_norm)
                if existing is None:
                    added += 1
                    self.add(source, target, source_lang, target_lang, status=entry_status,
                             kind=kind, note=note, _commit=False)
                elif existing.status == "approved" and entry_status == "suggested":
                    skipped += 1
                else:
                    updated += 1
                    self.add(source, target, source_lang, target_lang, status=entry_status,
                             kind=kind, note=note, _commit=False)
            self.db.commit()
        return {"added": added, "updated": updated, "skipped_approved": skipped,
                "total_records": len(records)}


def frequent_phrases(text: str, *, min_count: int = 2, min_chars: int = 2,
                     max_chars: int = 120, top: int = 30):
    """Repeated punctuation-delimited phrases; no Burmese tokenizer is involved."""
    if min_count < 2 or not 1 <= min_chars <= max_chars or top < 1:
        raise MemoryError_("Invalid frequency limits")
    counts: dict[str, int] = {}
    display: dict[str, str] = {}
    for match in SEPARATOR.split(text):
        phrase = match.strip()
        # The supplied HCrawler text contains literal HTML quote entities.
        # Strip only edge entities for this report; never rewrite the source.
        previous = None
        while phrase != previous:
            previous = phrase
            phrase = ENTITY.sub("", phrase, count=1).strip() if phrase.startswith("&") else phrase
            if phrase.endswith(";"):
                stripped = re.sub(r"&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#x[0-9A-Fa-f]+);$", "", phrase)
                phrase = stripped.strip()
        if not phrase or not min_chars <= len(phrase) <= max_chars:
            continue
        phrase = phrase.strip(EDGE_PUNCTUATION)
        if not phrase or not min_chars <= len(phrase) <= max_chars:
            continue
        if not any(character.isalnum() for character in phrase):
            continue
        if ENTITY.fullmatch(phrase) or BARE_ENTITY.fullmatch(phrase):
            continue
        norm = normalize(phrase)
        if not norm:
            continue
        counts[norm] = counts.get(norm, 0) + 1
        display.setdefault(norm, phrase)
    ranked = sorted(
        ((count, display[phrase]) for phrase, count in counts.items() if count >= min_count),
        key=lambda item: (-item[0], -len(item[1]), item[1]),
    )
    result = []
    for count, phrase in ranked[:top]:
        result.append({"source": phrase, "occurrences": count})
    return result


def _jsonable(entry: Entry) -> dict:
    return {
        "id": entry.id, "source": entry.source, "target": entry.target,
        "source_lang": entry.source_lang, "target_lang": entry.target_lang,
        "status": entry.status, "kind": entry.kind, "note": entry.note, "uses": entry.uses,
        "created_at": entry.created_at, "updated_at": entry.updated_at,
    }


@contextmanager
def open_memory(path: Path, readonly: bool = False):
    memory = Memory(path, readonly=readonly)
    try:
        yield memory
    finally:
        memory.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--memory", type=Path, default=DEFAULT_MEMORY)
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="Add or update a phrase (suggested by default)")
    add.add_argument("--source", required=True)
    add.add_argument("--target", required=True)
    add.add_argument("--from", dest="source_lang", required=True)
    add.add_argument("--to", dest="target_lang", required=True)
    add.add_argument("--status", choices=STATUSES, default="suggested")
    add.add_argument("--kind", choices=KINDS, default="phrase")
    add.add_argument("--note", default="")

    approve = commands.add_parser("approve", help="Approve one entry for exact reuse")
    approve.add_argument("id", type=int)

    delete = commands.add_parser("delete", help="Delete one entry")
    delete.add_argument("id", type=int)

    listing = commands.add_parser("list", help="List stored phrases")
    listing.add_argument("--status", choices=STATUSES)
    listing.add_argument("--kind", choices=KINDS)
    listing.add_argument("--limit", type=int, default=50)

    glossary = commands.add_parser("glossary", help="List approved glossary terms for one route")
    glossary.add_argument("--from", dest="source_lang", required=True)
    glossary.add_argument("--to", dest="target_lang", required=True)
    glossary.add_argument("--limit", type=int, default=200)

    suggest = commands.add_parser("suggest", help="Find similar stored phrases")
    suggest.add_argument("text")
    suggest.add_argument("--from", dest="source_lang", required=True)
    suggest.add_argument("--to", dest="target_lang", required=True)
    suggest.add_argument("--limit", type=int, default=3)
    suggest.add_argument("--min-score", type=float, default=0.45)

    commands.add_parser("stats", help="Show counts and reuse totals")

    export = commands.add_parser("export", help="Write JSONL for review/version control")
    export.add_argument("--output", type=Path, required=True)

    imp = commands.add_parser("import", help="Import reviewed JSONL atomically")
    imp.add_argument("--input", type=Path, required=True)
    imp.add_argument("--status", choices=STATUSES)

    frequent = commands.add_parser("frequent", help="Find repeated source phrases and known translations")
    frequent.add_argument("--input", type=Path, required=True)
    frequent.add_argument("--top", type=int, default=30)
    frequent.add_argument("--min-count", type=int, default=2)
    frequent.add_argument("--min-chars", type=int, default=2)
    frequent.add_argument("--max-chars", type=int, default=120)
    frequent.add_argument("--from", dest="source_lang", default="zh-Hant")
    frequent.add_argument("--to", dest="target_lang", default="my")

    args = parser.parse_args(argv)
    readonly = args.command in {"list", "suggest", "stats", "frequent", "glossary"}
    temporary = None
    try:
        with open_memory(args.memory, readonly=readonly) as memory:
            if args.command == "add":
                result = _jsonable(memory.add(args.source, args.target, args.source_lang,
                                              args.target_lang, status=args.status,
                                              kind=args.kind, note=args.note))
            elif args.command == "approve":
                result = _jsonable(memory.approve(args.id))
            elif args.command == "delete":
                memory.delete(args.id)
                result = {"deleted": args.id}
            elif args.command == "list":
                result = [_jsonable(entry) for entry in memory.list(
                    status=args.status, kind=args.kind, limit=args.limit)]
            elif args.command == "suggest":
                result = [{"score": item["score"], **_jsonable(item["entry"])}
                          for item in memory.suggestions(args.text, args.source_lang,
                                                         args.target_lang, limit=args.limit,
                                                         min_score=args.min_score)]
            elif args.command == "stats":
                result = memory.stats()
            elif args.command == "glossary":
                result = [_jsonable(entry) for entry in memory.glossary(
                    args.source_lang, args.target_lang, limit=args.limit)]
            elif args.command == "export":
                target = args.output.resolve()
                if target in {args.memory.resolve(), Path(__file__).resolve()}:
                    raise MemoryError_("Export must not replace the database or source file")
                result = {"exported": memory.export_jsonl(target), "output": str(target)}
            elif args.command == "import":
                result = memory.import_jsonl(args.input, status=args.status)
            elif args.command == "frequent":
                with args.input.open(encoding="utf-8", newline="") as stream:
                    text = stream.read()
                phrases = frequent_phrases(text, min_count=args.min_count,
                                           min_chars=args.min_chars,
                                           max_chars=args.max_chars, top=args.top)
                for phrase in phrases:
                    entry = memory.exact(phrase["source"], args.source_lang, args.target_lang)
                    phrase["translation"] = entry.target if entry else None
                    phrase["kind"] = entry.kind if entry else None
                    phrase["source_lang"] = args.source_lang
                    phrase["target_lang"] = args.target_lang
                result = {"phrases": phrases, "count": len(phrases)}
            else:  # pragma: no cover - argparse enforces the choices
                raise MemoryError_("Unknown command")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (MemoryError_, OSError, ValueError, sqlite3.Error) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
