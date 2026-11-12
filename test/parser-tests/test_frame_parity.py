#!/usr/bin/env python3
"""Check this parser's frame builder against the shared JSON golden.

The JavaScript parser and the Python parser are independent implementations
of one contract: for the same page export and the same seed they must emit
the same SVG bytes. The check lives in a JSON file, not in a subprocess:

    fixtures/frame-parity/page.svg       the input both sides read
    fixtures/frame-parity/expected.json  the SVG the JS builder emitted once
                                         for each seed (stored verbatim)

This script runs ONLY Python (``sys.executable``, this tree's
``make_line.py``) and compares the result with the JSON strings. It never
starts Node: a parser that cannot be tested without the other parser is not
independent.

Regenerating the golden is a deliberate JavaScript-side step, done when the
frame contract changes (see ``fixtures/frame-parity/README.md``). Regenerating
it from Python would make the test compare Python with Python and prove
nothing, so this script refuses to do it.

    python3 test/parser-tests/test_frame_parity.py
"""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
SVG_DIR = HERE.parents[1] / "B.Parser" / "tools" / "svg"
FIXTURES = SVG_DIR / "fixtures" / "frame-parity"
MAKE_LINE = SVG_DIR / "make_line.py"
EXPECTED = FIXTURES / "expected.json"
PAGE = FIXTURES / "page.svg"


def build(work: pathlib.Path, seed: int) -> dict:
    """Run the Python builder in ``work`` and return its two SVG strings."""
    shutil.copyfile(PAGE, work / PAGE.name)
    result = subprocess.run(
        [sys.executable, str(MAKE_LINE), PAGE.name, str(seed), f".{seed}.py"],
        cwd=work, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout[-800:])
        print(result.stderr[-800:])
        raise SystemExit(f"python builder failed for seed {seed}")
    known = work / "known"
    return {stem: (known / f"{stem}.{seed}.py.svg").read_text(encoding="utf-8")
            for stem in ("line-sample", "frame-sheet")}


def first_difference(a: str, b: str) -> int:
    for index, (left, right) in enumerate(zip(a, b)):
        if left != right:
            return index
    return min(len(a), len(b))


def main() -> int:
    if not EXPECTED.is_file() or not PAGE.is_file():
        print(f"missing fixture in {FIXTURES}", file=sys.stderr)
        return 1
    golden = json.loads(EXPECTED.read_text(encoding="utf-8"))
    if golden.get("format") != "myangustis.frame-parity/1":
        print(f"unknown fixture format: {golden.get('format')!r}", file=sys.stderr)
        return 1
    seeds = sorted(int(s) for s in golden["seeds"])
    print(f"fixtures: {PAGE.name}  seeds: {', '.join(str(s) for s in seeds)}")

    rows, failures = [], 0
    with tempfile.TemporaryDirectory(prefix="frame-parity-") as tmp:
        work = pathlib.Path(tmp)
        for seed in seeds:
            produced = build(work, seed)
            for stem in ("line-sample", "frame-sheet"):
                want = golden["seeds"][str(seed)][stem]
                got = produced[stem]
                same = want == got
                if not same:
                    failures += 1
                    at = first_difference(want, got)
                    print(f"  DIFF {stem} seed {seed} at char {at}")
                    print(f"    js {want[max(0, at - 50):at + 50]!r}")
                    print(f"    py {got[max(0, at - 50):at + 50]!r}")
                rows.append((seed, stem, len(got.encode("utf-8")), same))

    print(f"\n{'seed':>4} {'file':13} {'bytes':>8}  identical")
    print("-" * 40)
    for seed, stem, size, same in rows:
        print(f"{seed:4} {stem:13} {size:8}  {'yes' if same else 'NO'}")
    print(f"\n{len(rows) - failures}/{len(rows)} outputs identical to the JSON golden")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
