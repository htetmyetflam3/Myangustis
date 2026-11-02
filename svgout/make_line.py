#!/usr/bin/env python3
"""Python twin of svgout/make-line.js — same input, same bytes.

Standalone: does not call Node. The JS side does not call this either. Both read
the same page export and must produce identical SVG; test_frame_parity.py is the
check.

    python3 svgout/make_line.py svgout/representative-p14.svg 14
"""
from __future__ import annotations

import math
import re
import sys

from scan_frame import (frameOf, framesOf, pitchOf, blankOf, overflow,  # noqa: F401
                        lineSvg, sheetSvg, fixed, num)

SIZE = 12.96          # page 14, one size throughout
TOL = SIZE * 0.9      # baseline grouping, < one line

NUM = re.compile(r"[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
ARITY = {"M": 2, "L": 2, "T": 2, "H": 1, "V": 1,
         "C": 6, "S": 4, "Q": 4, "A": 7, "Z": 0}


def bbox_of(d: str, cache: dict):
    """Glyph bbox in em units, walked command by command.

    Control points are included, so the box is a superset: the fit check can
    only be pessimistic, never optimistic. H and V take one number, which is
    why a naive "numbers come in pairs" scan desyncs and invents ink.
    """
    if d in cache:
        return cache[d]
    tok = NUM.findall(d)
    i = 0
    x = y = sx = sy = 0.0
    x0 = y0 = math.inf
    x1 = y1 = -math.inf

    def note(px, py):
        nonlocal x0, y0, x1, y1
        if px < x0:
            x0 = px
        if px > x1:
            x1 = px
        if py < y0:
            y0 = py
        if py > y1:
            y1 = py

    cmd = None
    while i < len(tok):
        if re.match(r"[A-Za-z]", tok[i]):
            cmd = tok[i]
            i += 1
        if cmd is None or i >= len(tok):
            continue
        rel = cmd == cmd.lower()
        C = cmd.upper()
        if C == "Z":
            x, y = sx, sy
            continue
        n = ARITY.get(C)
        if n is None:
            i += 1
            continue
        if i + n > len(tok) or re.match(r"[A-Za-z]", tok[i]):
            continue
        v = [float(tok[i + k]) for k in range(n)]
        i += n
        ox, oy = x, y
        if C == "H":
            x = x + v[0] if rel else v[0]
            note(x, y)
        elif C == "V":
            y = y + v[0] if rel else v[0]
            note(x, y)
        elif C == "M":
            x = x + v[0] if rel else v[0]
            y = y + v[1] if rel else v[1]
            sx, sy = x, y
            note(x, y)
            cmd = "l" if rel else "L"
        elif C in ("L", "T"):
            x = x + v[0] if rel else v[0]
            y = y + v[1] if rel else v[1]
            note(x, y)
        elif C == "C":
            for k in range(0, 6, 2):
                note(ox + v[k] if rel else v[k], oy + v[k + 1] if rel else v[k + 1])
            x = ox + v[4] if rel else v[4]
            y = oy + v[5] if rel else v[5]
        elif C in ("S", "Q"):
            for k in range(0, 4, 2):
                note(ox + v[k] if rel else v[k], oy + v[k + 1] if rel else v[k + 1])
            x = ox + v[2] if rel else v[2]
            y = oy + v[3] if rel else v[3]
        elif C == "A":
            x = ox + v[5] if rel else v[5]
            y = oy + v[6] if rel else v[6]
            note(x, y)

    r = None if x0 == math.inf else [x0, y0, x1, y1]
    cache[d] = r
    return r


def collect_uses(svg: str, defs: dict):
    cache: dict = {}
    uses, seen = [], set()
    for m in re.finditer(r"<use\b[^>]*/>", svg):
        tag = m.group(0)
        href = re.search(r'(?:xlink:)?href="#([^"]+)"', tag)
        mat = re.search(r'transform="matrix\(([^)]+)\)"', tag)
        if not href or not mat:
            continue
        a, b, c, d, e, f = (float(v) for v in mat.group(1).split(","))
        # the page draws each glyph twice: once filled, once stroked. Keep one.
        key = f"{href.group(1)}:{fixed(e)}:{fixed(f)}"
        if key in seen:
            continue
        seen.add(key)
        gid = href.group(1)
        bb = bbox_of(defs.get(gid, ""), cache)
        if not bb:
            continue
        bx0, by0, bx1, by1 = bb
        xs = [a * bx0 + c * by0 + e, a * bx1 + c * by0 + e,
              a * bx0 + c * by1 + e, a * bx1 + c * by1 + e]
        ys = [b * bx0 + d * by0 + f, b * bx1 + d * by0 + f,
              b * bx0 + d * by1 + f, b * bx1 + d * by1 + f]
        ink = [min(xs), min(ys), max(xs), max(ys)]
        if ink[2] - ink[0] < 0.01 and ink[3] - ink[1] < 0.01:
            continue                                   # space ghost
        uses.append({"href": gid, "x": e, "y": f, "ink": ink, "raw": tag})
    return uses


def parse_lines(spec: str, n: int):
    """Same contract as parseLines() in make-line.js. Empty spec -> None."""
    if not spec:
        return None
    out: set[int] = set()
    for chunk in str(spec).split(","):
        t = chunk.strip()
        if not t:
            continue
        if "-" in t:
            a, b = (int(v) for v in t.split("-", 1))
            out.update(range(a, b + 1))
        else:
            out.add(int(t))
    return {v for v in out if 1 <= v <= n}


def mulberry32(a: int):
    def rnd():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
    return rnd


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "svgout/representative-p14.svg"
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 14
    suffix = sys.argv[3] if len(sys.argv) > 3 else ""
    only = sys.argv[4] if len(sys.argv) > 4 else ""

    svg = open(src, encoding="utf-8").read()
    W = float(re.search(r'width="([\d.]+)"', svg).group(1))

    defs = {m.group(1): m.group(2)
            for m in re.finditer(r'<path id="([^"]+)" d="([^"]*)"', svg)}

    uses = collect_uses(svg, defs)

    # rows, from the PDF's own baselines
    buckets: dict[float, list] = {}
    for u in uses:
        key = None
        for k in buckets:
            if abs(k - u["y"]) <= TOL:
                key = k
                break
        if key is None:
            key = u["y"]
            buckets[key] = []
        buckets[key].append(u)

    lines = []
    for y, g in sorted(buckets.items(), key=lambda kv: kv[0]):
        tally: dict[float, int] = {}
        for u in g:
            k = float(fixed(u["y"]))
            tally[k] = tally.get(k, 0) + 1
        base = sorted(tally.items(), key=lambda kv: -kv[1])[0][0]
        lines.append((min(u["ink"][0] for u in g), base, SIZE, ""))

    frames = framesOf(lines)
    pitch = pitchOf(frames)

    def rows_uses(y):
        return [u for u in uses if abs(u["y"] - y) <= TOL]

    rnd = mulberry32(seed)
    pick = 1 + int(rnd() * len(frames))
    frame = frames[pick - 1]
    line_uses = rows_uses(frame["baseline"])

    print(f"page width {num(W)}   {len(uses)} glyphs   {len(frames)} lines")
    print(f"pitch {num(pitch)}   slot {fixed(frame['slot'])}   "
          f"blank {fixed(blankOf(frame, pitch))}")
    print(f"E {fixed(frame['E'])}  rules "
          + " / ".join(fixed(v) for v in (frame["r1"], frame["r2"],
                                          frame["r3"], frame["r4"])))
    print(f"random line {pick} of {len(frames)}   "
          f"baseline {fixed(frame['baseline'])}   {len(line_uses)} glyphs")

    bad = 0
    for f in frames:
        o = overflow(f, rows_uses(f["baseline"]))
        if not o["ok"]:
            bad += 1
            print(f"  ! line {f['index']} ink {fixed(o['above'])} above / "
                  f"{fixed(o['below'])} below")
    print(f"fit: {len(frames) - bad}/{len(frames)} lines inside the rules")

    open(f"svgout/known/line-sample{suffix}.svg", "w", encoding="utf-8").write(
        lineSvg(width=W, frame=frame, uses=line_uses, defs=defs, pitch=pitch,
                label=f"page 14 line {pick}"))

    keep = parse_lines(only, len(frames))
    selected = [f for f in frames if f["index"] in keep] if keep else frames
    all_rows = [{"frame": f, "uses": rows_uses(f["baseline"])} for f in selected]
    open(f"svgout/known/frame-sheet{suffix}.svg", "w", encoding="utf-8").write(
        sheetSvg(width=W, rows=all_rows, defs=defs, pitch=pitch))

    print(f"-> svgout/known/line-sample{suffix}.svg")
    print(f"-> svgout/known/frame-sheet{suffix}.svg")


if __name__ == "__main__":
    main()
