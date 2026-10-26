#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""The name and term list: read it, check text against it, add to it.

`content/reference/EtoBnames.txt` is the authority for how a name or a term is
written in Burmese. It predates this pipeline and the human translation used it,
so it wins over the API even when the API's rendering is correct Burmese:

    the list says ယဲ့နင်   ->  ယဲ့နိန် is rewritten, not defended
    the list says လျိုချင်း  ->  the API's လျိုကျင်း is rewritten

The file is `Key = Value` lines, one per term, with no header and no schema:

    Ye Nin = ယဲ့နင်
    Liu Jin = လျိုချင်း

A line with no `=` is prose and is skipped. A line written the other way round
(`ဟဲရွမ် = hedong`) is read as Burmese = key. Duplicates are kept and reported:
several English terms may legitimately share one Burmese term (Xianmen,
Ascension sect, Immortal gate and Feather gate are all အင်မော်တယ်ဂိုဏ်း).

Two sides, nothing else:

    left   the English of the zh-en column (`content/mtranslate/zh-en/`)
    right  the Burmese of the AI translation (RapidAPI), corrected if needed

No categories. The file has never had them and does not need them: one English
term, one Burmese form. What *does* get registered is wider than people — a
weapon, a martial art, a bloodline ability, a pill, a rank or a place is
registered the same way, because `ရွှေလင်းတဓား` has to read the same in chapter
212 as in 194, and the API will not remember it for you.

A trailing `# …` note is tolerated and stripped before the form is compared, so
a note written by `--add` can never leak into a spelling match.

    python3 mt/names.py --list
    python3 mt/names.py --lookup "Liu Jin"
    python3 mt/names.py --check --chapter 194
    python3 mt/names.py --check --text "ယဲ့နိန် က နန်းတော်ထဲ ဝင်တယ်။"
    python3 mt/names.py --add "Shen Ji = ရှန်းကျီ"

`--check` is a report, not a rewriter: it never edits the text. It lists exact
hits and *suspected* variants (a Burmese run within a syllable or two of a
canonical form). The agent decides; the list decides what is correct.

`--add` appends. It refuses a Burmese form that is already canonical for a
different key, because two spellings for one name is the defect this file
exists to prevent. Nothing else in the repository is written.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
NAMES_FILE = ROOT / "content" / "reference" / "EtoBnames.txt"

MYANMAR = re.compile(r"[\u1000-\u109f\uAA60-\uAA7F\uA9E0-\uA9FF]")
MYANMAR_RUN = re.compile(r"[\u1000-\u109f\uAA60-\uAA7F\uA9E0-\uA9FF]{3,}")
_STRIP = re.compile(r"[\s\u200b\u200c\u200d\ufeff.,;:!?\"'()\[\]«»“”‘’\-–—/…။၊]+")


def normalize(text: str) -> str:
    """Compare forms, not typography: no spaces, no ZWSP, no punctuation."""
    return _STRIP.sub("", text or "").lower()


@dataclass
class Entry:
    key: str
    value: str
    line: int
    reversed: bool = False
    note: str = ""

    def as_dict(self) -> dict:
        payload = {"key": self.key, "burmese": self.value, "line": self.line}
        if self.note:
            payload["note"] = self.note
        if self.reversed:
            payload["reversed_in_file"] = True
        return payload


def split_comment(value: str) -> tuple[str, str]:
    """`form  # note` -> (form, note). A note is never part of the form.

    `--add` writes its note after a `#`; without this, the note became part of
    the Burmese form and the entry could not match the text it was added for.
    """
    form, _, comment = value.partition("#")
    return form.strip(), comment.strip()


@dataclass
class ListResult:
    entries: list[Entry] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def parse(text: str) -> ListResult:
    """Read the list. Prose lines are skipped and counted, not an error."""
    result = ListResult()
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or "=" not in line:
            if line and not line.startswith("#"):
                result.warnings.append(f"line {number}: no '=' — skipped: {line[:60]}")
            continue
        left, _, right = line.partition("=")
        value, note = split_comment(right.strip())
        key = left.strip().lstrip("[").strip()
        reversed_ = False
        if MYANMAR.search(key) and not MYANMAR.search(value):
            key, value = value, key
            reversed_ = True
        elif not MYANMAR.search(value):
            result.warnings.append(
                f"line {number}: no Burmese on the right — skipped: {line[:60]}")
            continue
        if not key:
            result.warnings.append(f"line {number}: no key before '=' — skipped")
            continue
        result.entries.append(Entry(key=key, value=value, line=number,
                                    reversed=reversed_, note=note))
    return result


def load(path: Path | str | None = None) -> ListResult:
    path = Path(path or NAMES_FILE)
    if not path.is_file():
        raise FileNotFoundError(f"no name list at {path}")
    return parse(path.read_text(encoding="utf-8"))


def canonical(entries: list[Entry]) -> dict[str, list[Entry]]:
    """normalized Burmese -> the entries that use it."""
    table: dict[str, list[Entry]] = {}
    for entry in entries:
        table.setdefault(normalize(entry.value), []).append(entry)
    return table


def lookup(entries: list[Entry], term: str) -> list[Entry]:
    """Find a term by English key or by Burmese form, exact before substring."""
    wanted = normalize(term)
    if not wanted:
        return []
    exact = [entry for entry in entries
             if normalize(entry.value) == wanted or normalize(entry.key) == wanted]
    if exact:
        return exact
    return [entry for entry in entries
            if wanted in normalize(entry.value) or wanted in normalize(entry.key)]


def hits(text: str, entries: list[Entry]) -> list[dict]:
    """Canonical forms that occur in the text, longest first, with counts."""
    flat = normalize(text)
    found = []
    for norm, group in canonical(entries).items():
        if not norm:
            continue
        count = flat.count(norm)
        if count:
            found.append({
                "burmese": group[0].value,
                "keys": sorted({entry.key for entry in group}),
                "count": count,
                "lines": sorted({entry.line for entry in group}),
            })
    return sorted(found, key=lambda row: -len(normalize(row["burmese"])))


def _windows(run: str, length: int) -> list[tuple[int, str]]:
    out = []
    for size in {length, length - 1, length + 1}:
        if size < 3 or size > len(run):
            continue
        for start in range(0, len(run) - size + 1):
            out.append((start, run[start:start + size]))
    return out


def variants(text: str, entries: list[Entry], *, threshold: float = 0.72) -> list[dict]:
    """Burmese runs that look like a canonical name but are spelled differently.

    Every run of Myanmar characters is compared with every canonical form whose
    length is within one character. A run that *contains* the canonical form is
    a hit, not a variant, and is skipped. This is deliberately conservative:
    it reports suspects for a human (or an agent) to judge.
    """
    exact = {normalize(entry.value) for entry in entries if normalize(entry.value)}
    table = {normalize(entry.value): entry for entry in entries if normalize(entry.value)}
    reported: dict[tuple[str, str], dict] = {}
    for match in MYANMAR_RUN.finditer(text):
        run = match.group()
        flat = normalize(run)
        if len(flat) > 48:  # a long run is prose; names are short
            continue
        for start, window in _windows(flat, min(8, max(4, len(flat)))):
            if window in exact or len(window) < 4:
                continue
            for norm, entry in table.items():
                if abs(len(norm) - len(window)) > 1 or len(norm) < 4:
                    continue
                if window in norm or norm in window:
                    continue
                ratio = difflib.SequenceMatcher(None, window, norm).ratio()
                # A name that opens with the same two characters and is one
                # vowel away is a variant (ယဲ့နိန် for ယဲ့နင်). A reordering of
                # the same syllables is a different mistake, and needs to be
                # much closer before it is worth a false positive.
                same_opening = window[:2] == norm[:2]
                if ratio < (0.86 if not same_opening else threshold):
                    continue
                key = (window, norm)
                best = reported.get(key)
                if best and best["similarity"] >= ratio:
                    continue
                reported[key] = {
                    "found": window,
                    "canonical": entry.value,
                    "keys": sorted({item.key for item in table.values()
                                    if normalize(item.value) == norm}),
                    "similarity": round(ratio, 2),
                    "context": run[max(0, start - 8):start + len(window) + 8],
                }
    rows = list(reported.values())
    # One report per canonical name: the closest suspect is the useful one.
    best_by_name: dict[str, dict] = {}
    for row in rows:
        name = row["canonical"]
        if name not in best_by_name or row["similarity"] > best_by_name[name]["similarity"]:
            best_by_name[name] = row
    return sorted(best_by_name.values(), key=lambda row: -row["similarity"])


def chapter_text(chapter: int, out_dir: Path | str | None = None,
                 target: str = "my") -> tuple[Path, str]:
    """The AI translation of one chapter, as stored by mt/apicaller.py."""
    directory = Path(out_dir or ROOT / "content" / "mtranslate" / "rapidapi")
    path = directory / f"ch{chapter:04d}.{target}.jsonl"
    if not path.is_file():
        raise SystemExit(f"[names] no translation at {path}; "
                         "run python3 mt/apicaller.py --run first")
    lines = []
    for row in path.read_text(encoding="utf-8").splitlines():
        if row.strip():
            record = json.loads(row)
            lines.append(record.get("target") or "")
    return path, "\n".join(lines)


def add(path: Path | str | None, english: str, burmese: str, note: str = "") -> Entry:
    """Append one term to the list, refusing a second spelling for one name.

    `english` is the term as the zh-en column writes it, `burmese` the form the
    AI translation produced (corrected by the agent when it is wrong). That is
    the whole record: no category, because the file has never had one.
    """
    path = Path(path or NAMES_FILE)
    english, burmese = english.strip(), burmese.strip()
    if not english or not burmese:
        raise ValueError("--add needs both a key and a Burmese form")
    if MYANMAR.search(english):
        raise ValueError(f"key {english!r} contains Myanmar script; the left "
                         "side is the English or Chinese term")
    if not MYANMAR.search(burmese):
        raise ValueError(f"{burmese!r} has no Myanmar script; the value side "
                         "must be Burmese")
    if "#" in burmese:
        raise ValueError("'#' starts the category note; it cannot appear in a form")
    result = load(path)
    existing = canonical(result.entries)
    same_key = [entry for entry in result.entries
                if normalize(entry.key) == normalize(english)]
    for entry in same_key:
        if normalize(entry.value) == normalize(burmese):
            return entry          # already there: same term, same spelling
        raise ValueError(
            f"{entry.key!r} is already {entry.value!r} (line {entry.line}); "
            f"refusing to add {burmese!r}. Reuse the existing term, or edit the "
            "list by hand if the existing one is wrong.")
    clash = existing.get(normalize(burmese))
    if clash and all(normalize(entry.key) != normalize(english) for entry in clash):
        keys = ", ".join(sorted({entry.key for entry in clash}))
        raise ValueError(f"{burmese!r} is already the term for {keys} "
                         f"(line {clash[0].line}); two names, one spelling is "
                         "usually a mistake — use the existing key, or edit by hand")

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    body = path.read_text(encoding="utf-8")
    if not body.endswith("\n"):
        body += "\n"
    line = f"{english} = {burmese}" + (f"  # {note.strip()}" if note.strip() else "")
    body += f"# added {stamp}\n{line}\n"
    path.write_text(body, encoding="utf-8")
    return Entry(key=english, value=burmese, line=len(body.splitlines()),
                 note=note.strip())


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Read, check and extend the name and term list.",
        epilog="The list at content/reference/EtoBnames.txt is the authority: "
               "a term is written the way the list writes it, even when another "
               "spelling is also correct Burmese.")
    parser.add_argument("--file", type=Path, default=NAMES_FILE,
                        help=f"name list (default: {NAMES_FILE.relative_to(ROOT)})")
    parser.add_argument("--list", action="store_true", help="print every entry")
    parser.add_argument("--lookup", metavar="TERM",
                        help="find a term by its key or by its Burmese form")
    parser.add_argument("--check", action="store_true",
                        help="report canonical hits and suspected variants in --text")
    parser.add_argument("--text", help="text to check, quoted")
    parser.add_argument("--chapter", type=int,
                        help="check one chapter of the AI translation on disk")
    parser.add_argument("--translations", type=Path, default=None, metavar="DIR",
                        help="directory holding chNNNN.my.jsonl")
    parser.add_argument("--target", default="my", help="target code (default: my)")
    parser.add_argument("--add", metavar="'KEY = BURMESE'",
                        help="append one term to the list")
    parser.add_argument("--note", default="", help="note stored with --add")
    parser.add_argument("--json", action="store_true", help="print JSON")
    parser.add_argument("--warnings", action="store_true",
                        help="print skipped lines and duplicates and exit")
    args = parser.parse_args(argv)

    try:
        result = load(args.file)
    except FileNotFoundError as error:
        print(f"[names] {error}", file=sys.stderr)
        return 2

    if args.add:
        key, _, value = args.add.partition("=")
        if not value:
            print("[names] --add needs 'KEY = BURMESE'", file=sys.stderr)
            return 2
        try:
            entry = add(args.file, key, value, args.note)
        except ValueError as error:
            print(f"[names] {error}", file=sys.stderr)
            return 2
        print(f"[names] added line {entry.line}: {entry.key} = {entry.value}")
        return 0

    if args.warnings:
        table = canonical(result.entries)
        for norm, group in table.items():
            if len({entry.key.lower() for entry in group}) > 1:
                result.warnings.append(
                    "one Burmese form, several keys: " + ", ".join(
                        f"{entry.key} (line {entry.line})" for entry in group))
        if args.json:
            print(json.dumps(result.warnings, indent=2, ensure_ascii=False))
        else:
            print("\n".join(result.warnings) or "[names] no warnings")
        return 0

    if args.lookup is not None:
        found = lookup(result.entries, args.lookup)
        if args.json:
            print(json.dumps([entry.as_dict() for entry in found], indent=2,
                             ensure_ascii=False))
            return 0
        if not found:
            print(f"[names] no entry for {args.lookup!r}; "
                  "check a spelling variant, or add it with --add")
            return 1
        for entry in found:
            print(f"{entry.line:>4}  {entry.key:<34} {entry.value}")
        return 0

    if args.check:
        if args.chapter is not None:
            path, text = chapter_text(args.chapter, args.translations, args.target)
            origin = str(path)
        elif args.text:
            text, origin = args.text, "--text"
        else:
            print("[names] --check needs --text or --chapter", file=sys.stderr)
            return 2
        report = {
            "source": origin,
            "entries": len(result.entries),
            "hits": hits(text, result.entries),
            "variants": variants(text, result.entries),
        }
        if args.json:
            print(json.dumps(report, indent=2, ensure_ascii=False))
            return 0
        print(f"[names] {origin}: {report['entries']} entries in the list")
        if report["hits"]:
            print("  in the text:")
            for row in report["hits"]:
                print(f"    {row['burmese']}  x{row['count']}  "
                      f"({', '.join(row['keys'])})")
        if report["variants"]:
            print("  suspected variants — rewrite to the canonical form:")
            for row in report["variants"]:
                print(f"    {row['found']}  ->  {row['canonical']}  "
                      f"({row['similarity']}; {', '.join(row['keys'])})")
        if not report["hits"] and not report["variants"]:
            print("  no listed name or term found in this text")
        return 0

    rows = [entry.as_dict() for entry in result.entries]
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return 0
    print(f"[names] {args.file} — {len(rows)} entries")
    width = max((len(entry.key) for entry in result.entries), default=10)
    for entry in result.entries:
        mark = " (reversed in file)" if entry.reversed else ""
        print(f"{entry.line:>4}  {entry.key:<{width}}  {entry.value}{mark}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
