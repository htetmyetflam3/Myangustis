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

CASES = [
    ("representative-p14.svg", [14, 1, 22, 7]),
    ("representative-p46.svg", [46, 3]),
    ("part-2-p341.svg", [341]),
]


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
    cases = [(p, seed) for stem, seeds in CASES for p in [stem] if p in pages
             for seed in seeds]
    if not cases:
        cases = [(p, 1) for p in pages]

    rows, failures = [], 0
    for name, seed in cases:
        src = f"svgout/{name}"

        # node -> <stem>.<seed>.js.svg ; python -> <stem>.<seed>.py.svg
        run(["node", "svgout/make-line.js", src, str(seed), f".{seed}.js"], ROOT)
        run([sys.executable, "svgout/make_line.py", src, str(seed), f".{seed}.py"], ROOT)

        for stem in ("line-sample", "frame-sheet"):
            a = (KNOWN / f"{stem}.{seed}.js.svg").read_bytes()
            b = (KNOWN / f"{stem}.{seed}.py.svg").read_bytes()
            same = a == b
            if not same:
                failures += 1
                n = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y),
                         min(len(a), len(b)))
                print(f"  DIFF {stem} {name} seed {seed} at byte {n}:")
                print(f"    js {a[max(0, n - 60):n + 60]!r}")
                print(f"    py {b[max(0, n - 60):n + 60]!r}")
            rows.append((name, seed, stem, len(a), same))
            os.remove(KNOWN / f"{stem}.{seed}.js.svg")
            os.remove(KNOWN / f"{stem}.{seed}.py.svg")

    print(f"\n{'page':26} {'seed':>4} {'file':13} {'bytes':>8}  identical")
    print("-" * 66)
    for name, seed, stem, size, same in rows:
        print(f"{name:26} {seed:4} {stem:13} {size:8}  {'yes' if same else 'NO'}")

    print(f"\n{len(rows) - failures}/{len(rows)} outputs byte-identical")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
