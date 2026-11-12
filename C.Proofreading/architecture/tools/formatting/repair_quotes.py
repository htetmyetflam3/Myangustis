# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Repair literal HTML quote entities in a Chinese UTF-8 text file.

The supplied HCrawler text contains `&quot;` (and possibly `&amp;quot;`) where
Chinese opening/closing quotation marks belong. This tool chooses `“` or `”`
from local context, preserves every other character and every line ending, and
can write an audit report. It is not a general HTML unescaper.

Default output is a new file next to the input:
    input/chinese-...txt -> input/chinese-...quotes-repaired.txt

Use --in-place explicitly to overwrite the input. The original remains recoverable
from Git in this repository.

The state machine is shared with HCrawler (`format/quote_text.py`);
HCrawler uses it while writing each page, so new crawls do not need a later repair.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from quote_text import Change, repair_text  # noqa: E402


def read_text(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as stream:
        return stream.read()


def atomic_write(path: Path, text: str, *, mode_from: Path | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".quote-repair-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        if mode_from is not None and mode_from.exists():
            os.chmod(temporary, stat.S_IMODE(mode_from.stat().st_mode))
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_report(path: Path, changes: list[Change]) -> None:
    lines = ["line\tcolumn\tchoice\treason\tambiguous\tcontext"]
    for change in changes:
        lines.append(
            f"{change.line}\t{change.column}\t{change.choice}\t{change.reason}\t"
            f"{'yes' if change.ambiguous else 'no'}\t{change.context}"
        )
    atomic_write(path, "\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Repair HTML-escaped or bare ASCII quotes as Chinese opening/closing quotes.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input", type=Path, help="UTF-8 Chinese text file")
    output = parser.add_mutually_exclusive_group()
    output.add_argument("-o", "--output", type=Path,
                        help="Write here; default: <input>.quotes-repaired.txt")
    output.add_argument("--in-place", action="store_true",
                        help="Overwrite the input atomically")
    parser.add_argument("--report", type=Path, help="Write a TSV audit of every change")
    parser.add_argument("--dry-run", action="store_true", help="Analyse but write no text output")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing output")
    parser.add_argument("--include-straight-quotes", action="store_true",
                        help="Also normalize bare ASCII double quotes, not just HTML entities")
    args = parser.parse_args(argv)

    try:
        if not args.input.is_file():
            raise ValueError(f"Input is not a file: {args.input}")
        if args.in_place:
            destination = args.input
        else:
            destination = args.output or args.input.with_name(
                f"{args.input.stem}.quotes-repaired{args.input.suffix or '.txt'}"
            )
        if not args.in_place and destination.resolve() == args.input.resolve():
            raise ValueError("Use --in-place to overwrite the input")
        if destination.exists() and not args.in_place and not args.force:
            raise ValueError(f"Output already exists: {destination}; use --force or --in-place")
        if args.report and args.report.resolve() in {args.input.resolve(), destination.resolve()}:
            raise ValueError("Report must be different from input and output")

        source = read_text(args.input)
        repaired, changes, counts = repair_text(
            source, include_ascii=args.include_straight_quotes
        )
        if args.report:
            write_report(args.report, changes)
        if not args.dry_run:
            atomic_write(destination, repaired, mode_from=args.input)
        summary = {
            "input": str(args.input),
            "output": None if args.dry_run else str(destination),
            "dry_run": args.dry_run,
            "report": str(args.report) if args.report else None,
            **counts,
            "changed": repaired != source,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    except (OSError, UnicodeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
