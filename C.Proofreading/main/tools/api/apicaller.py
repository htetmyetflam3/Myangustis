#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Call the translation API two chapters at a time.

    python3 mt/apicaller.py                        # plan the next pair
    python3 mt/apicaller.py --run                  # translate it
    python3 mt/apicaller.py --194+195              # plan that pair
    python3 mt/apicaller.py --194+195 --run        # translate that pair
    python3 mt/apicaller.py '--194&195' --run      # the same pair, & quoted
    python3 mt/apicaller.py --status               # where the cursor is

Standard library only, so any Python 3.10+ runs it; `python3` is the documented
interpreter. With uv, spell it `uv run --no-project mt/apicaller.py …` so the
scraper's environment in `pyproject.toml` is not built for this.

`&` is a shell operator. Unquoted, `--194&195` backgrounds `--194` and runs `195`
as a command, so the tool never sees it. Quote it, or use `+`; both spellings
mean the same thing to this file.

With no chapters given the pair is the first two Chinese chapters after the
human translation, read from the DOCX. The human Burmese covers Chinese 1-193,
so the first call is 194 + 195. A chapter that already has a JSONL in the output
directory is not offered again, so the next call with no arguments is 196 + 197.

Two chapters, never a bulk run: a three-chapter request is refused and split
into the pairs to run in order. The same limit applies to
`mt/api_translate.py --run` and to the MCP tool `translate_chapters`, which call
this module, so the human's command and the agent's tool cannot drift.

`--plan` is the default and spends nothing. `--run` needs RAPIDAPI_KEY in the
environment or in `--env-file`; there is no implicit `.env` reading.

Output, per pair, under `content/mtranslate/rapidapi/`:

    ch0194.my.jsonl            one record per paragraph: source, target, cached
    ch0194.my.txt              the chapter in Burmese
    pair-0194-0195.my.txt      both chapters, one file
    compare-ch194-ch195.md     Chinese | new Burmese | existing human Burmese
    report-0194-0195.json      the report for this pair
    report.json                the latest report, overwritten each run
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from api_translate import (  # noqa: E402
    BURMESE,
    CHINESE,
    DOCX,
    OUTPUT,
    build_plan,
    chinese_chapters,
    run,
    select,
)
from chapter_map import (  # noqa: E402
    ChapterMap,
    ChapterMapError,
    load_or_derive,
)
from rapidapi_translator import (  # noqa: E402
    MAX_CHAPTERS_PER_CALL,
    MAX_REQUEST_CHARS,
    MAX_REQUEST_ITEMS,
    TranslatorError,
    load_env_file,
    parse_chapters,
)

MAX_CHAPTERS = MAX_CHAPTERS_PER_CALL
CURSOR_WORDS = frozenset({"", "next", "pair"})

# `--194&195`, `--194+195`, `--194-195`, `--194` — a chapter spec wearing a
# leading dash pair, absorbed before argparse can call it an unknown option.
_SPEC_TOKEN = re.compile(r"^--(\d[\d&+,.;\-]*)$")
_SEPARATORS = re.compile(r"[&+,;\s]+")


class PairError(ValueError):
    """A chapter selection the caller will not run. The message is the fix."""


# ---------------------------------------------------------------- selection


def absorb(argv: list[str]) -> list[str]:
    """`--194&195` -> `--chapters 194&195`, so argparse accepts the short form."""
    out: list[str] = []
    for token in argv:
        match = _SPEC_TOKEN.match(token)
        if match:
            out.extend(["--chapters", match.group(1)])
        else:
            out.append(token)
    return out


def parse_spec(text: str) -> list[int]:
    """One chapter or two, from `194&195`, `194+195`, `194,195`, `194-195`."""
    cleaned = str(text).strip()
    if cleaned.startswith("--"):
        cleaned = cleaned[2:]
    pieces = [piece for piece in _SEPARATORS.split(cleaned) if piece]
    if not pieces:
        raise PairError("no chapter number given")
    try:
        numbers = parse_chapters(pieces)
    except ValueError as error:
        raise PairError(f"bad chapter selection {text!r}: {error}") from error
    numbers = [number for number in dict.fromkeys(numbers) if number > 0]
    if not numbers:
        raise PairError(f"bad chapter selection {text!r}")
    if len(numbers) > MAX_CHAPTERS:
        raise PairError(
            f"{len(numbers)} chapters requested; the API is called "
            f"{MAX_CHAPTERS} at a time. Run "
            + ", then ".join(pair_commands(numbers))
        )
    return numbers


def pair_commands(numbers: list[int]) -> list[str]:
    """The paste-safe `--194+195` commands covering these chapters."""
    return [
        "--" + "+".join(str(number) for number in numbers[start:start + MAX_CHAPTERS])
        for start in range(0, len(numbers), MAX_CHAPTERS)
    ]


def available_numbers(chapters) -> list[int]:
    return sorted({chapter.number for chapter in chapters})


def done_numbers(out_dir: Path | str, target: str) -> set[int]:
    """Chapters that already have a JSONL for this target under `out_dir`."""
    directory = Path(out_dir)
    if not directory.is_dir():
        return set()
    pattern = re.compile(r"^ch(\d+)\.%s\.jsonl$" % re.escape(target))
    found = set()
    for path in directory.iterdir():
        match = pattern.match(path.name)
        if match:
            found.add(int(match.group(1)))
    return found


def default_numbers(chapter_map: ChapterMap | None, available: list[int],
                    done: set[int]) -> list[int]:
    """The next pair after the human translation that is not on disk yet."""
    start = chapter_map.next_chinese if chapter_map is not None else None
    if start is None:
        raise PairError(
            "no DOCX chapter map, so there is no 'after the human translation' "
            "to start from. Pass the chapters explicitly (for example "
            "--194+195), or drop --no-map"
        )
    pending = [number for number in available
               if number >= start and number not in done]
    if not pending:
        raise PairError(
            f"no chapter at or after {start} is left to translate in this "
            f"source ({len(available)} chapter(s) found); see --status"
        )
    return pending[:MAX_CHAPTERS]


def resolve(spec: str | None, chapters, chapter_map: ChapterMap | None, *,
            out_dir: Path | str = OUTPUT, target: str = "my"):
    """Return (numbers, selected chapters, note) for a spec or the cursor."""
    available = available_numbers(chapters)
    if spec is not None and str(spec).strip().lower() == "all":
        raise PairError(
            f"there is no bulk run: the API is called {MAX_CHAPTERS} chapters "
            "at a time. Start with --run and no chapters; each call moves the "
            "cursor forward"
        )
    if spec is None or str(spec).strip().lower() in CURSOR_WORDS:
        numbers = default_numbers(chapter_map, available,
                                  done_numbers(out_dir, target))
        first, last = chapter_map.chinese_covered[0], chapter_map.last_chinese
        note = (f"first two chapters after the human translation "
                f"(Chinese {first}-{last})")
    else:
        numbers = parse_spec(str(spec))
        note = "requested"
    selected = select(chapters, numbers)
    found = {chapter.number for chapter in selected}
    missing = [number for number in numbers if number not in found]
    if missing:
        raise PairError(f"chapter(s) {missing} are not in the Chinese source")
    return numbers, selected, note


def next_numbers(chapter_map: ChapterMap | None, chapters, *,
                 out_dir: Path | str = OUTPUT, target: str = "my") -> list[int]:
    """The pair a second run would take, or [] when the source is exhausted."""
    try:
        return default_numbers(chapter_map, available_numbers(chapters),
                               done_numbers(out_dir, target))
    except PairError:
        return []


# ---------------------------------------------------------------- output


def _show(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def planned_files(numbers: list[int], out_dir: Path | str, target: str,
                  compare: bool = True) -> list[Path]:
    directory = Path(out_dir)
    labels = [f"ch{number:04d}.{target}" for number in numbers]
    first, last = numbers[0], numbers[-1]
    files = [directory / f"{label}.jsonl" for label in labels]
    files += [directory / f"{label}.txt" for label in labels]
    files.append(directory / f"pair-{first:04d}-{last:04d}.{target}.txt")
    if compare:
        files.append(directory / f"compare-ch{first:03d}-ch{last:03d}.md")
    files.append(directory / f"report-{first:04d}-{last:04d}.json")
    return files


def translate_pair(selected, *, chapter_map: ChapterMap | None = None,
                   target: str = "my", source: str = "auto",
                   out_dir: Path | str = OUTPUT, cache_path=None,
                   enabled_cache: bool = True, max_chars: int = MAX_REQUEST_CHARS,
                   max_items: int = MAX_REQUEST_ITEMS, timeout: float = 60.0,
                   attempts: int = 3, compare: bool = True,
                   existing: Path | str = BURMESE, log=None) -> dict:
    """Translate one pair and archive its report next to the chapters."""
    first, last = selected[0].number, selected[-1].number
    label = f"{first:04d}-{last:04d}"
    directory = Path(out_dir)
    report = run(
        selected, target=target, source=source, out_dir=directory,
        cache_path=cache_path, enabled_cache=enabled_cache,
        max_chars=max_chars, max_items=max_items, timeout=timeout,
        max_attempts=attempts, compare=compare, existing_path=existing,
        chapter_map=chapter_map, log=log,
        book_name=f"pair-{label}.{target}.txt",
    )
    latest = directory / "report.json"
    archived = directory / f"report-{label}.json"
    if latest.is_file():
        shutil.copyfile(latest, archived)
        report["files"].append(_show(archived))
    report["pair"] = {
        "label": label,
        "chapters": [chapter.number for chapter in selected],
        "note": "one API call per pair; nothing is translated in bulk",
    }
    return report


def status(chapter_map: ChapterMap | None, chapters, *, out_dir: Path | str = OUTPUT,
           target: str = "my", docx: Path | str = DOCX) -> dict:
    available = available_numbers(chapters)
    done = done_numbers(out_dir, target)
    start = chapter_map.next_chinese if chapter_map is not None else None
    after = [number for number in available if start is not None and number >= start]
    payload = {
        "mode": "status",
        "target": target,
        "out_dir": _show(Path(out_dir)),
        "docx": _show(Path(docx)) if Path(docx).is_file() else None,
        "human_translation": None,
        "in_source_after_human": len(after),
        "done": len([number for number in after if number in done]),
        "pending": len([number for number in after if number not in done]),
        "next": [],
    }
    if chapter_map is not None and chapter_map.pairs:
        payload["human_translation"] = {
            "chinese": [chapter_map.chinese_covered[0], chapter_map.last_chinese],
            "burmese": [chapter_map.burmese_chapters[0], chapter_map.last_burmese],
            "pairs": len(chapter_map.pairs),
        }
    payload["next"] = next_numbers(chapter_map, chapters, out_dir=out_dir,
                                   target=target)
    return payload


# ---------------------------------------------------------------- CLI


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="apicaller.py",
        description="Translate two chapters of the Chinese novel per call. "
                    "The default pair is the first two chapters after the "
                    "human translation, read from the DOCX.",
        epilog="The default is a plan: no key, no request, no file. Add --run "
               "to spend quota. `&` is a shell character, so write '--194&195' "
               "quoted or --194+195 unquoted.",
    )
    parser.add_argument("numbers", nargs="*", metavar="CHAPTER",
                        help="chapter numbers to translate, e.g. 194 195")
    parser.add_argument("--chapters", dest="chapters_flag", metavar="SPEC",
                        help="194&195, 194+195, 194,195, 194-195, next, or "
                             "nothing for the cursor")
    parser.add_argument("--status", action="store_true",
                        help="show the cursor and what is left; no request")
    parser.add_argument("--target", default="my",
                        help="target language code (default: my)")
    parser.add_argument("--source", default="auto",
                        help="source language code or auto (default: auto)")
    parser.add_argument("--source-file", type=Path, default=CHINESE,
                        help="Chinese text with ===== 第N章 ===== headings")
    parser.add_argument("--existing", type=Path, default=BURMESE,
                        help="human Burmese, used as the comparison reference")
    parser.add_argument("--docx", type=Path, default=DOCX,
                        help="bilingual DOCX the chapter numbers come from")
    parser.add_argument("--map", dest="map_path", type=Path, default=None,
                        help="saved chapter map JSON; skips reading the DOCX")
    parser.add_argument("--no-map", action="store_true",
                        help="ignore the DOCX map; needs explicit chapters")
    parser.add_argument("--out-dir", type=Path, default=OUTPUT,
                        help="output directory (default: content/mtranslate/rapidapi)")
    parser.add_argument("--cache", type=Path, default=None, help="SQLite cache path")
    parser.add_argument("--no-cache", action="store_true", help="ignore the cache")
    parser.add_argument("--no-compare", action="store_true",
                        help="do not write the comparison markdown")
    parser.add_argument("--max-chars", type=int, default=MAX_REQUEST_CHARS,
                        help=f"characters per request (default: {MAX_REQUEST_CHARS})")
    parser.add_argument("--max-items", type=int, default=MAX_REQUEST_ITEMS,
                        help=f"strings per batch request (default: {MAX_REQUEST_ITEMS})")
    parser.add_argument("--timeout", type=float, default=60.0,
                        help="per-request timeout in seconds")
    parser.add_argument("--attempts", type=int, default=3,
                        help="retries per request (default: 3)")
    parser.add_argument("--json", action="store_true",
                        help="print the plan, report or status as one JSON object")
    parser.add_argument("--env-file", type=Path, default=None, metavar="PATH",
                        help="read KEY=VALUE lines from PATH before running; the "
                             "shell environment wins. Not loaded implicitly.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--plan", action="store_true",
                      help="count the work, no request (default)")
    mode.add_argument("--run", action="store_true",
                      help="call the API; needs RAPIDAPI_KEY")
    return parser


def _print_plan(payload: dict, numbers: list[int], note: str,
                out_dir: Path, target: str, compare: bool, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return
    totals = payload["totals"]
    print(f"[apicaller] {numbers[0]} + {numbers[-1]} — {note}")
    print("[apicaller] plan only — no key, no request, nothing written")
    print(f"{'chapter':>7}  {'paragraphs':>10}  {'characters':>10}  "
          f"{'requests':>8}  title")
    for row in payload["chapters"]:
        print(f"{row['chapter']:>7}  {row['paragraphs']:>10}  "
              f"{row['characters']:>10}  {row['requests']:>8}  {row['title']}")
    print(f"{'total':>7}  {totals['paragraphs']:>10}  "
          f"{totals['characters']:>10}  {totals['requests']:>8}")
    print("[apicaller] would write:")
    for path in planned_files(numbers, out_dir, target, compare):
        print(f"  {_show(path)}")
    print(f"[apicaller] run: python3 mt/apicaller.py {pair_commands(numbers)[0]} --run")


def _print_run(report: dict, numbers: list[int]) -> None:
    totals = report["totals"]
    print(f"[apicaller] {numbers[0]} + {numbers[-1]} done: "
          f"{totals['paragraphs']} paragraph(s), {totals['requests']} request(s), "
          f"{totals['cached']} cached, {report['elapsed_seconds']}s")
    for name in report["files"]:
        print(f"  {name}")
    upcoming = report.get("next") or []
    if upcoming:
        print(f"[apicaller] next pair: {upcoming[0]} + {upcoming[-1]} — "
              f"python3 mt/apicaller.py {pair_commands(upcoming)[0]} --run")
    else:
        print("[apicaller] no chapters left after this pair in the source")


def main(argv: list[str] | None = None) -> int:
    raw = list(sys.argv[1:] if argv is None else argv)
    args = build_parser().parse_args(absorb(raw))

    if args.env_file:
        try:
            loaded = load_env_file(args.env_file)
        except TranslatorError as error:
            print(f"[apicaller] {error}", file=sys.stderr)
            return 2
        if loaded and not args.json:
            print(f"[apicaller] loaded {', '.join(loaded)} from {args.env_file}",
                  file=sys.stderr)

    if not args.source_file.is_file():
        print(f"[apicaller] no source file at {args.source_file}", file=sys.stderr)
        return 4
    chapters = chinese_chapters(args.source_file)
    if not chapters:
        print(f"[apicaller] no chapters found in {args.source_file}", file=sys.stderr)
        return 4

    chapter_map: ChapterMap | None = None
    map_error = ""
    if not args.no_map:
        try:
            chapter_map = load_or_derive(args.map_path, args.docx)
        except (ChapterMapError, OSError, KeyError) as error:
            map_error = str(error)

    if args.status:
        payload = status(chapter_map, chapters, out_dir=args.out_dir,
                         target=args.target, docx=args.docx)
        if map_error:
            payload["map_error"] = map_error
        if args.json:
            print(json.dumps(payload, indent=2, ensure_ascii=False))
            return 0
        human = payload["human_translation"]
        if human:
            print(f"[apicaller] human translation: Chinese "
                  f"{human['chinese'][0]}–{human['chinese'][1]} ↔ Burmese "
                  f"{human['burmese'][0]}–{human['burmese'][1]} — {payload['docx']}")
        else:
            print(f"[apicaller] no human-translation span: {map_error or 'no DOCX map'}")
        print(f"[apicaller] after it: {payload['in_source_after_human']} chapter(s) "
              f"in the source, {payload['done']} done, {payload['pending']} left")
        if payload["next"]:
            print(f"[apicaller] next pair: {payload['next'][0]} + {payload['next'][-1]}")
            command = pair_commands(payload["next"])[0]
            print(f"[apicaller] plan it: python3 mt/apicaller.py {command}")
            print(f"[apicaller] run it:  python3 mt/apicaller.py {command} --run")
        else:
            print("[apicaller] nothing left to translate after the human translation")
        return 0

    if args.chapters_flag:
        spec: str | None = args.chapters_flag
    elif args.numbers:
        spec = "&".join(args.numbers)
    else:
        spec = None

    try:
        numbers, selected, note = resolve(spec, chapters, chapter_map,
                                          out_dir=args.out_dir, target=args.target)
    except PairError as error:
        print(f"[apicaller] {error}", file=sys.stderr)
        return 2

    if not args.run:
        payload = build_plan(selected, target=args.target, source=args.source,
                             max_chars=args.max_chars, max_items=args.max_items)
        payload["mode"] = "plan"
        payload["pair"] = {"chapters": numbers, "note": note}
        payload["human_translation"] = (
            {"chinese": [chapter_map.chinese_covered[0], chapter_map.last_chinese],
             "burmese": [chapter_map.burmese_chapters[0], chapter_map.last_burmese]}
            if chapter_map is not None and chapter_map.pairs else None
        )
        payload["files"] = [_show(path) for path in
                            planned_files(numbers, args.out_dir, args.target,
                                          not args.no_compare)]
        payload["next"] = next_numbers(chapter_map, chapters,
                                       out_dir=args.out_dir, target=args.target)
        _print_plan(payload, numbers, note, args.out_dir, args.target,
                    not args.no_compare, args.json)
        return 0

    try:
        report = translate_pair(
            selected, chapter_map=chapter_map, target=args.target,
            source=args.source, out_dir=args.out_dir, cache_path=args.cache,
            enabled_cache=not args.no_cache, max_chars=args.max_chars,
            max_items=args.max_items, timeout=args.timeout,
            attempts=args.attempts, compare=not args.no_compare,
            existing=args.existing, log=None if args.json else print)
    except TranslatorError as error:
        print(f"[apicaller] {error}", file=sys.stderr)
        return 3
    report["next"] = next_numbers(chapter_map, chapters, out_dir=args.out_dir,
                                  target=args.target)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        _print_run(report, numbers)
    return 0


if __name__ == "__main__":
    sys.exit(main())
