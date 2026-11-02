#!/usr/bin/env python3
"""Python twin of svgout/scan-frame.js — same API, same bytes.

The parser exists in two languages by design, so this module does not shell out
to Node and the JS module does not shell out to Python. Each is standalone.

THE CONTRACT THAT KEEPS THEM 1:1
    The two implementations must emit byte-identical SVG for the same input.
    That is only possible if number formatting is pinned, because the standard
    formatters disagree:

        JS   (2.5).toFixed(0)      -> "3"      half away from zero
        Py   f"{2.5:.0f}"          -> "2"      half to even
        JS   String(12.0)          -> "12"
        Py   str(12.0)             -> "12.0"

    So both sides use fixed() and num() below and nowhere else. test_frame_parity.py
    diffs the two outputs and fails if a single character differs.

WHAT THIS FILE IS
    frameOf / framesOf / pitchOf / blankOf / overflow / brokenByLine /
    lineSvg / sheetSvg, and the four-rule frame: E = size / 2, rules at
    b-2E, b-E, b, b+E, canvas locked to the page width.

    The reasoning behind E, and the measurement that rejected per-font
    coordinates, are in AGENT-NOTE-vector-svg.md.
"""
from __future__ import annotations

import math

BAND = 0.5                      # E as a fraction of size, calibrated on Myanmar3


# --------------------------------------------------------------------------
# number formatting — the parity contract, see the module docstring
# --------------------------------------------------------------------------

def fixed(v: float, digits: int = 2) -> str:
    """Integer hundredths, rounded half away from zero. Matches JS fixed()."""
    scale = 10 ** digits
    s = -1 if v < 0 else 1
    n = math.floor(abs(v) * scale + 0.5)
    i = n // scale
    f = n % scale
    sign = "-" if (s < 0 and n != 0) else ""
    return f"{sign}{i}.{str(f).zfill(digits)}"


def num(v):
    """Integral floats print without a decimal part. Matches JS num()."""
    if isinstance(v, bool):
        return str(v).lower()
    if isinstance(v, int):
        return str(v)
    if float(v).is_integer():
        return str(int(v))
    return repr(float(v))


def js_round(v: float) -> int:
    """Math.round: halves go towards +inf, so -2.5 -> -2."""
    return math.floor(v + 0.5)


def _esc(s) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# --------------------------------------------------------------------------
# the frame
# --------------------------------------------------------------------------

def frameOf(baseline: float, size: float, band: float = BAND) -> dict:
    """The four rules for one line."""
    E = size * band
    return {
        "baseline": baseline,
        "size": size,
        "E": E,
        "band": band,
        "r1": baseline - 2 * E,
        "r2": baseline - E,
        "r3": baseline,
        "r4": baseline + E,
        "top": baseline - 2 * E,
        "bottom": baseline + E,
        "slot": 3 * E,
    }


def framesOf(lines, band: float = BAND) -> list[dict]:
    """Frames for a page from the parser's own line boundaries.

    lines yields (x, y, size, text), i.e. PdfPagePieces.lines().
    """
    out = []
    for i, (x, y, size, text) in enumerate(lines, 1):
        f = frameOf(y, size, band)
        out.append({"index": i, "x": x, "y": y, "size": size, "text": text, **f})
    return out


def pitchOf(frames) -> float:
    """Modal consecutive baseline gap, rounded the way JS rounds it."""
    gaps = []
    for i in range(1, len(frames)):
        d = frames[i]["baseline"] - frames[i - 1]["baseline"]
        if d > 1:
            gaps.append(js_round(d * 100) / 100)
    if not gaps:
        return 0
    tally: dict[float, int] = {}
    for g in gaps:
        tally[g] = tally.get(g, 0) + 1
    # count desc, then value asc, stable over insertion order
    return sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def blankOf(frame: dict, pitch: float) -> float:
    """What is left between one slot and the next."""
    return pitch - frame["slot"]


def inkOf(use: dict):
    return use.get("ink")


def overflow(frame: dict, uses) -> dict:
    """Does this row's ink stay inside its four rules? Needs no font file."""
    lo = math.inf
    hi = -math.inf
    for u in uses:
        ink = u.get("ink")
        if not ink:
            continue
        if ink[1] < lo:
            lo = ink[1]
        if ink[3] > hi:
            hi = ink[3]
    if lo == math.inf:
        return {"ok": True, "above": 0, "below": 0}
    above = frame["baseline"] - lo
    below = hi - frame["baseline"]
    return {"ok": above <= 2 * frame["E"] and below <= frame["E"],
            "above": above, "below": below}


def brokenByLine(frames, scan) -> list[dict]:
    """Attach scanBrokenSpans results to the lines they fall on."""
    out = []
    for f in frames:
        spans = scan(str(f.get("text") or "")) or []
        out.append({**f, "spans": spans, "broken": bool(spans)})
    return out


# --------------------------------------------------------------------------
# SVG
# --------------------------------------------------------------------------

DEFAULT_PAINT = {"slot": "#D6EAF8", "rule": "#FF6EAE",
                 "base": "#FFC300", "ink": "#000000"}


def lineSvg(width, frame, uses, defs, pitch=None, label=None, paint=None) -> str:
    """One line as a standalone SVG on the page-width canvas."""
    c = {**DEFAULT_PAINT, **(paint or {})}
    pad = frame["size"] * 0.6
    top = frame["r1"] - pad
    bot = frame["r4"] + pad
    h = bot - top

    used = {u["href"] for u in uses}
    defsXml = "".join(f'<path id="{_esc(i)}" d="{defs[i]}"/>'
                      for i in defs if i in used)

    ink = "".join(u["raw"] for u in uses)

    rules = "".join(
        f'<line x1="0" y1="{fixed(y)}" x2="{fixed(width)}" y2="{fixed(y)}"/>'
        for y in (frame["r1"], frame["r2"], frame["r4"]))

    idx = frame.get("index") or ""
    title = label if label is not None else f'line {idx if idx != "" else "?"}'
    pitch_attr = ""
    if pitch:
        pitch_attr = (f' data-pitch="{fixed(pitch)}"'
                      f' data-blank="{fixed(blankOf(frame, pitch))}"')

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'version="1.1" '
        f'width="{fixed(width)}" height="{fixed(h)}" '
        f'viewBox="0 {fixed(top)} {fixed(width)} {fixed(h)}" '
        f'data-line="{idx}" data-baseline="{fixed(frame["baseline"])}" '
        f'data-size="{num(frame["size"])}" data-E="{fixed(frame["E"], 3)}" '
        'data-rules="' + ",".join(fixed(v) for v in
                                  (frame["r1"], frame["r2"], frame["r3"], frame["r4"])) + '"'
        + pitch_attr +
        f' data-glyphs="{len(uses)}">\n'
        f'<title>{_esc(title)}</title>\n'
        f'<rect x="0" y="{fixed(top)}" width="{fixed(width)}" height="{fixed(h)}" fill="#FFFFFF"/>\n'
        f'<rect x="0" y="{fixed(frame["r1"])}" width="{fixed(width)}" '
        f'height="{fixed(frame["slot"])}" fill="{c["slot"]}"/>\n'
        f'<defs>{defsXml}</defs>\n'
        f'<g fill="{c["ink"]}">{ink}</g>\n'
        f'<g stroke="{c["rule"]}" stroke-width="0.5" fill="none" '
        f'stroke-linecap="round" stroke-linejoin="round">{rules}</g>\n'
        f'<line x1="0" y1="{fixed(frame["r3"])}" x2="{fixed(width)}" '
        f'y2="{fixed(frame["r3"])}" stroke="{c["base"]}" stroke-width="0.7" '
        f'stroke-linecap="round"/>\n'
        '</svg>\n'
    )


def sheetSvg(width, rows, defs, pitch, mode="page", paint=None) -> str:
    """Many lines as one sheet: page-width canvas, page-space coordinates."""
    c = {**DEFAULT_PAINT, **(paint or {})}

    used: set[str] = set()
    body, slots, slotRules, baseRules = [], [], [], []

    cursor = 0.0
    for row in rows:
        frame, uses = row["frame"], row["uses"]
        shift = 0.0
        if mode == "stack":
            shift = cursor - frame["r1"]
            cursor += frame["slot"] + (pitch - frame["slot"])

        g = []
        for u in uses:
            used.add(u["href"])
            g.append(u["raw"] if shift == 0 else _shift_matrix(u["raw"], shift))
        body.append("".join(g))

        b = frame["baseline"] + shift
        slots.append(f'<rect x="0" y="{fixed(b - 2 * frame["E"])}" width="{fixed(width)}" '
                     f'height="{fixed(frame["slot"])}" fill="{c["slot"]}"/>')
        for y in (b - 2 * frame["E"], b - frame["E"], b + frame["E"]):
            slotRules.append(f'<line x1="0" y1="{fixed(y)}" x2="{fixed(width)}" y2="{fixed(y)}"/>')
        baseRules.append(f'<line x1="0" y1="{fixed(b)}" x2="{fixed(width)}" y2="{fixed(b)}"/>')

    if mode == "stack":
        top, h = 0.0, cursor + 8
    else:
        top = min(r["frame"]["r1"] for r in rows)
        h = max(r["frame"]["r4"] for r in rows) - top + 8

    defsXml = "".join(f'<path id="{_esc(i)}" d="{defs[i]}"/>'
                      for i in defs if i in used)

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'version="1.1" '
        f'width="{fixed(width)}" height="{fixed(h)}" '
        f'viewBox="0 {fixed(top)} {fixed(width)} {fixed(h)}" '
        f'data-lines="{len(rows)}" data-pitch="{fixed(pitch)}" data-band="{num(BAND)}">\n'
        f'<rect x="0" y="{fixed(top)}" width="{fixed(width)}" height="{fixed(h)}" fill="#FFFFFF"/>\n'
        f'<g fill="{c["slot"]}">{"".join(slots)}</g>\n'
        f'<defs>{defsXml}</defs>\n'
        f'<g fill="{c["ink"]}">{"".join(body)}</g>\n'
        f'<g stroke="{c["rule"]}" stroke-width="0.5" fill="none" '
        f'stroke-linecap="round" stroke-linejoin="round">{"".join(slotRules)}</g>\n'
        f'<g stroke="{c["base"]}" stroke-width="0.7" fill="none" '
        f'stroke-linecap="round" stroke-linejoin="round">{"".join(baseRules)}</g>\n'
        '</svg>\n'
    )


def _shift_matrix(raw: str, shift: float) -> str:
    """Translate the glyph's own matrix down by `shift`."""
    import re
    m = re.search(r'transform="matrix\(([^)]*)\)"', raw)
    if not m:
        return raw
    p = [float(v) for v in m.group(1).split(",")]
    repl = (f'transform="matrix({num(p[0])},{num(p[1])},{num(p[2])},{num(p[3])},'
            f'{num(p[4])},{fixed(p[5] + shift)})"')
    return raw[:m.start()] + repl + raw[m.end():]
