#!/usr/bin/env python3
"""Prove the JS and Python frame builders are 1:1.

Runs make-line.js and make_line.py on the same page export with the same seed,
then compares the output byte for byte. Each implementation is standalone: Node
is not called from Python and Python is not called from Node. This script is the
only place both are known, and it only reads their files.

    python3 B.Parser/main/parser/svg/test_frame_parity.py
"""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

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
    # SVG sitting in B.Parser/main/parser/svg/ is fair game; skip the ones that are absent.
    pages = sorted(p.name for p in (ROOT / "parser" / "svg").glob("*.svg"))
    if not pages:
        print("no page exports in B.Parser/main/parser/svg/. Make one first:")
        print("  python3 B.Parser/main/parser/svg/pdf2svg.py --file book.pdf --pages 14")
        return 1
    cases = [(p, seed) for p in pages for seed in SEEDS]

    rows, failures = [], 0
    # The fallback test must not rename or overwrite the user's page metadata
    # or generated sheets. Both implementations write into a temporary copy.
    with tempfile.TemporaryDirectory(prefix="svg-frame-parity-") as tmp:
        work = pathlib.Path(tmp)
        (work / "parser" / "svg" / "known").mkdir(parents=True)
        for name, seed in cases:
            source = ROOT / "parser" / "svg" / name
            src = work / "parser" / "svg" / name
            shutil.copyfile(source, src)
            original_lines = source.with_suffix(".lines.json")
            temp_lines = src.with_suffix(".lines.json")
            if original_lines.exists():
                metadata = json.loads(original_lines.read_text(encoding="utf-8"))
                if metadata.get("coordinates") != "svg-page":
                    raise SystemExit(f"unverified coordinates in {original_lines}; re-export the page")
            modes = ("lines", "fallback") if original_lines.exists() else ("fallback",)

            for mode in modes:
                if mode == "lines":
                    shutil.copyfile(original_lines, temp_lines)
                elif temp_lines.exists():
                    temp_lines.unlink()
                run(["node", str(ROOT / "parser" / "svg" / "make-line.js"), str(src),
                     str(seed), f".{seed}.js"], work)
                run([sys.executable, str(ROOT / "parser" / "svg" / "make_line.py"), str(src),
                     str(seed), f".{seed}.py"], work)

                for stem in ("line-sample", "frame-sheet"):
                    known = work / "parser" / "svg" / "known"
                    a = (known / f"{stem}.{seed}.js.svg").read_bytes()
                    b = (known / f"{stem}.{seed}.py.svg").read_bytes()
                    same = a == b
                    if not same:
                        failures += 1
                        n = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y),
                                 min(len(a), len(b)))
                        print(f"  DIFF {stem} {name} seed {seed} [{mode}] at byte {n}:")
                        print(f"    js {a[max(0, n - 60):n + 60]!r}")
                        print(f"    py {b[max(0, n - 60):n + 60]!r}")
                    rows.append((name, seed, mode, stem, len(a), same))

    print(f"\n{'page':26} {'seed':>4} {'mode':9} {'file':13} {'bytes':>8}  identical")
    print("-" * 76)
    for name, seed, mode, stem, size, same in rows:
        print(f"{name:26} {seed:4} {mode:9} {stem:13} {size:8}  {'yes' if same else 'NO'}")

    print(f"\n{len(rows) - failures}/{len(rows)} outputs byte-identical")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
