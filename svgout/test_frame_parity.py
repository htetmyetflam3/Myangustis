#!/usr/bin/env python3
"""Prove the JS and Python frame builders are 1:1.

Runs make-line.js and make_line.py on the same page export with the same seed,
then compares the output byte for byte. Each implementation is standalone: Node
is not called from Python and Python is not called from Node. This script is the
only place both are known, and it only reads their files.

    python3 svgout/test_frame_parity.py
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
KNOWN = ROOT / "svgout" / "known"

# Seed picks the random single-line sample, so a couple of seeds per page also
# proves the picker agrees. Pages are discovered, not listed: page exports are
# working files and are absent on a clean checkout.
SEEDS = [1, 7]


def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-800:])
        print(r.stderr[-800:])
        raise SystemExit(f"failed: {' '.join(cmd)}")
    return r.stdout


def main():
    # the parity check runs on page exports, which are working files. Any page
    # SVG sitting in svgout/ is fair game; skip the ones that are absent.
    pages = sorted(p.name for p in (ROOT / "svgout").glob("*.svg"))
    if not pages:
        print("no page exports in svgout/. Make one first:")
        print("  python3 svgout/pdf2svg.py --file book.pdf --pages 14")
        return 0
    cases = [(p, seed) for p in pages for seed in SEEDS]

    rows, failures = [], 0
    for name, seed in cases:
        src = f"svgout/{name}"
        json_path = (ROOT / src).with_suffix(".lines.json")

        # Both paths must agree in both languages: the text-layer path, and the
        # tick-tolerance fallback used when pdf2svg.py has not written a line
        # file. The fallback is exercised by moving the file aside, so a bug in
        # one path cannot hide behind the other.
        for mode in ("lines", "fallback"):
            parked = None
            if mode == "fallback" and json_path.exists():
                parked = json_path.with_suffix(".lines.json.parked")
                json_path.rename(parked)

            try:
                run(["node", "svgout/make-line.js", src, str(seed), f".{seed}.js"], ROOT)
                run([sys.executable, "svgout/make_line.py", src, str(seed), f".{seed}.py"], ROOT)
            finally:
                if parked:
                    parked.rename(json_path)

            if mode == "fallback" and not parked:
                continue   # nothing to fall back from: this page has no line file

            for stem in ("line-sample", "frame-sheet"):
                a = (KNOWN / f"{stem}.{seed}.js.svg").read_bytes()
                b = (KNOWN / f"{stem}.{seed}.py.svg").read_bytes()
                same = a == b
                if not same:
                    failures += 1
                    n = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y),
                             min(len(a), len(b)))
                    print(f"  DIFF {stem} {name} seed {seed} [{mode}] at byte {n}:")
                    print(f"    js {a[max(0, n - 60):n + 60]!r}")
                    print(f"    py {b[max(0, n - 60):n + 60]!r}")
                rows.append((name, seed, mode, stem, len(a), same))
                os.remove(KNOWN / f"{stem}.{seed}.js.svg")
                os.remove(KNOWN / f"{stem}.{seed}.py.svg")

    print(f"\n{'page':26} {'seed':>4} {'mode':9} {'file':13} {'bytes':>8}  identical")
    print("-" * 76)
    for name, seed, mode, stem, size, same in rows:
        print(f"{name:26} {seed:4} {mode:9} {stem:13} {size:8}  {'yes' if same else 'NO'}")

    print(f"\n{len(rows) - failures}/{len(rows)} outputs byte-identical")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
