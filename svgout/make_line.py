#!/usr/bin/env python3
"""Python twin of svgout/make-line.js — same input, same bytes.

Standalone: does not call Node. The JS side does not call this either. Both read
the same page export and must produce identical SVG; test_frame_parity.py is the
check.

    python3 svgout/make_line.py svgout/representative-p14.svg 14
"""
from __future__ import annotations

import json
import math
import re
import sys

from scan_frame import (framesOf, pitchOf, blankOf, overflow, bandFor,  # noqa: F401
                        lineSvg, sheetSvg, fixed, num)

# Size is NOT a constant. Every glyph carries its own: the page export writes
# <use transform="matrix(sx,0,0,-sy,x,y)"> and sx IS the font size in points,
# because the glyph paths in <defs> are in em units.
UNITS = 0.9           # baseline grouping tolerance, as a fraction of the size

NUM = re.compile(r"[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "Q": 4, "Z": 0}


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
        if re.fullmatch(r"[A-Za-z]", tok[i]):
            cmd = tok[i]
            i += 1
        if cmd is None:
            raise ValueError("invalid glyph path: missing command")
        rel = cmd == cmd.lower()
        C = cmd.upper()
        if C == "Z":
            x, y, cmd = sx, sy, None
            continue
        n = ARITY.get(C)
        if n is None:
            raise ValueError(f"unsupported glyph path command {cmd}")
        if i + n > len(tok):
            raise ValueError("invalid glyph path: truncated command")
        if any(re.fullmatch(r"[A-Za-z]", v) for v in tok[i:i + n]):
            raise ValueError("invalid glyph path: missing arguments")
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
        elif C == "L":
            x = x + v[0] if rel else v[0]
            y = y + v[1] if rel else v[1]
            note(x, y)
        elif C == "C":
            for k in range(0, 6, 2):
                note(ox + v[k] if rel else v[k], oy + v[k + 1] if rel else v[k + 1])
            x = ox + v[4] if rel else v[4]
            y = oy + v[5] if rel else v[5]
        elif C == "Q":
            for k in range(0, 4, 2):
                note(ox + v[k] if rel else v[k], oy + v[k + 1] if rel else v[k + 1])
            x = ox + v[2] if rel else v[2]
            y = oy + v[3] if rel else v[3]

    r = None if x0 == math.inf else [x0, y0, x1, y1]
    cache[d] = r
    return r


# Preserve every use in its source group/order. The reader accepts the SVG form
# produced by pdf2svg.py; unfamiliar containers or references fail explicitly
# rather than yielding a partial sheet.
TAGS = re.compile(r'''<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(?:[^>"']|"[^"]*"|'[^']*')*>''')
IDENTITY = (1, 0, 0, 1, 0, 0)
CSS_ATTRS = ("style", "class")
EFFECT_ATTRS = ("stroke", "stroke-width", "filter", "mask", "marker",
                "marker-start", "marker-mid", "marker-end")


def attr(tag, name):
    match = re.search(r'(?:^|\s)' + re.escape(name) + r'''\s*=\s*(["'])([\s\S]*?)\1''', tag)
    return match.group(2) if match else None


def has_any(tag, names):
    return any(attr(tag, name) is not None for name in names)


def matrix(value):
    if value is None:
        return IDENTITY
    match = re.fullmatch(r"matrix\s*\(([^)]*)\)\s*", value.strip())
    if not match:
        return None
    try:
        parts = [float(v) for v in re.split(r"[\s,]+", match.group(1).strip())]
    except ValueError:
        return None
    return parts if len(parts) == 6 and all(math.isfinite(v) for v in parts) else None


def multiply(p, q):
    if p is None or q is None:
        return None
    a, b, c, d, e, f = p
    g, h, i, j, k, l = q
    return (a * g + c * h, b * g + d * h, a * i + c * j,
            b * i + d * j, a * k + c * l + e, b * k + d * l + f)


def read_scene(source):
    defs, path_flags, body_defs, references = {}, {}, {}, {}
    defined, all_ids = set(), set()
    definitions, scene, source_uses, groups = [], [], [], []
    defs_depth = defs_start = end = 0
    root, root_closed = None, False
    stylesheet = definition_effects = False

    def remember_path(gid, tag):
        d = attr(tag, "d")
        if d is None:
            return
        defs[gid] = d
        path_flags[gid] = {"css": has_any(tag, CSS_ATTRS) or attr(tag, "transform") is not None,
                           "effects": has_any(tag, EFFECT_ATTRS)}

    for match in TAGS.finditer(source):
        if "<" in source[end:match.start()]:
            raise ValueError("malformed SVG markup")
        tag = match.group(0)
        end = match.end()
        if tag.startswith("<!--") or tag.startswith("<?"):
            continue
        if tag.startswith("<!"):
            raise ValueError("unsupported SVG declaration")
        if "<" in tag[1:]:
            raise ValueError("malformed SVG markup")
        name_match = re.match(r"<\s*(/?)\s*([A-Za-z_][A-Za-z0-9:_.-]*)", tag)
        if not name_match:
            raise ValueError("unsupported SVG tag")
        closing, name = bool(name_match.group(1)), name_match.group(2)
        if ":" in name:
            raise ValueError(f"unsupported namespaced SVG element <{name}>")
        self_closing = bool(re.search(r"/\s*>$", tag))
        gid = None if closing else attr(tag, "id")
        if gid:
            if gid in all_ids:
                raise ValueError(f"duplicate SVG id {gid}; the page was not emitted")
            all_ids.add(gid)
        href = None if closing else (attr(tag, "xlink:href") or attr(tag, "href"))
        if name == "use" and href and not href.startswith("#"):
            raise ValueError("unsupported external SVG use reference; the page was not emitted")
        if name == "image" and href and not href.startswith(("#", "data:")):
            raise ValueError("unsupported external SVG image reference; the page was not emitted")
        if name in ("use", "image") and href and href.startswith("#"):
            references[href[1:]] = None
        for ref in re.finditer(r'''url\(\s*(["']?)([^"')]+)\1\s*\)''', tag):
            value = ref.group(2).strip()
            if not value.startswith("#"):
                raise ValueError("unsupported external SVG resource; the page was not emitted")
            references[value[1:]] = None

        if defs_depth:
            if gid:
                defined.add(gid)
            if not closing and name == "path" and gid:
                remember_path(gid, tag)
            if not closing and name == "style":
                stylesheet = True
            if not closing and name == "g":
                if has_any(tag, CSS_ATTRS) or attr(tag, "transform") is not None:
                    stylesheet = True
                if has_any(tag, EFFECT_ATTRS):
                    definition_effects = True
            if name == "defs" and not closing and not self_closing:
                defs_depth += 1
            if name == "defs" and closing:
                defs_depth -= 1
                if not defs_depth:
                    definitions.append(source[defs_start:match.end()])
            continue
        if name == "svg":
            if not closing and root is None:
                root = tag
            elif closing and root and not root_closed and not groups:
                root_closed = True
            else:
                raise ValueError("unsupported nested or malformed SVG root")
            continue
        if not root or root_closed:
            raise ValueError("SVG content outside the root element")
        if name == "defs":
            if closing:
                raise ValueError("unexpected closing defs")
            if self_closing:
                definitions.append(tag)
            else:
                defs_depth, defs_start = 1, match.start()
            continue
        if name == "g":
            if closing:
                if not groups:
                    raise ValueError("unmatched SVG group")
                groups.pop()
            elif not self_closing:
                parent = groups[-1] if groups else {"matrix": IDENTITY, "css": False, "effects": False}
                groups.append({"matrix": multiply(parent["matrix"], matrix(attr(tag, "transform"))),
                               "css": parent["css"] or has_any(tag, CSS_ATTRS),
                               "effects": parent["effects"] or has_any(tag, EFFECT_ATTRS)})
            scene.append({"raw": tag})
            continue
        if name == "use":
            if closing or not self_closing:
                raise ValueError("unsupported non-empty SVG use")
            parent = groups[-1] if groups else {"matrix": IDENTITY, "css": False, "effects": False}
            item = {"raw": tag, "index": len(source_uses), "parent": parent["matrix"], "href": href,
                    "css": parent["css"] or has_any(tag, CSS_ATTRS),
                    "effects": parent["effects"] or has_any(tag, EFFECT_ATTRS)}
            source_uses.append(item)
            scene.append(item)
            continue
        # A body image may be referenced by a later <use>; put that definition
        # in <defs> without drawing the original image a second time.
        if name in ("image", "path") and gid and self_closing and not closing:
            body_defs[gid] = tag
            if name == "path":
                remember_path(gid, tag)
        elif not self_closing or closing:
            raise ValueError(f"unsupported SVG container <{name}>")
    if "<" in source[end:]:
        raise ValueError("malformed SVG markup")
    if not root or not root_closed or defs_depth or groups:
        raise ValueError("incomplete SVG page")

    extra = []
    for gid in references:
        if gid in defined:
            continue
        raw = body_defs.get(gid)
        if raw is None:
            raise ValueError(f"cannot preserve SVG reference #{gid}: definition is missing or unsupported")
        defined.add(gid)
        extra.append(raw)
    if extra:
        definitions.append("<defs>" + "".join(extra) + "</defs>")

    uses, unframed, cache = [], [], {}
    for item in source_uses:
        href = item["href"]
        gid = href[1:] if href and href.startswith("#") else None
        transform = attr(item["raw"], "transform")
        combined = None if transform is None else multiply(item["parent"], matrix(transform))
        try:
            ox = float(attr(item["raw"], "x") or 0)
            oy = float(attr(item["raw"], "y") or 0)
        except ValueError:
            ox = oy = math.nan
        if (not gid or gid not in defs or combined is None
                or not math.isfinite(ox) or not math.isfinite(oy)
                or stylesheet or item["css"] or path_flags[gid]["css"]):
            unframed.append(item["index"])
            continue
        a, b, c, d, tx, ty = combined
        e, f = tx + a * ox + c * oy, ty + b * ox + d * oy
        size = float(fixed(math.hypot(a, b)))
        # The four rules are horizontal. Keep rotated glyphs on the full page
        # rather than guessing which horizontal line they belong to.
        if not size or abs(b) > size * 1e-6:
            unframed.append(item["index"])
            continue
        bb = bbox_of(defs[gid], cache)
        ink = None
        if bb:
            x0, y0, x1, y1 = bb
            xs = [a * x0 + c * y0 + e, a * x1 + c * y0 + e,
                  a * x0 + c * y1 + e, a * x1 + c * y1 + e]
            ys = [b * x0 + d * y0 + f, b * x1 + d * y0 + f,
                  b * x0 + d * y1 + f, b * x1 + d * y1 + f]
            ink = [min(xs), min(ys), max(xs), max(ys)]
        uses.append({"href": gid, "x": e, "y": f, "ink": ink, "size": size,
                     "raw": item["raw"], "index": item["index"],
                     "fullPage": item["effects"] or path_flags[gid]["effects"] or definition_effects})
    try:
        width, height = float(attr(root, "width")), float(attr(root, "height"))
    except (TypeError, ValueError):
        raise ValueError("SVG page needs numeric width and height") from None
    if not (math.isfinite(width) and width > 0 and math.isfinite(height) and height > 0):
        raise ValueError("SVG page needs numeric width and height")
    if (attr(root, "xmlns") != "http://www.w3.org/2000/svg"
            or attr(root, "xmlns:xlink") not in (None, "http://www.w3.org/1999/xlink")):
        raise ValueError("unsupported SVG root namespace")
    viewbox = attr(root, "viewBox")
    if viewbox is not None:
        try:
            box = [float(v) for v in re.split(r"[\s,]+", viewbox.strip())]
        except ValueError:
            box = []
        expected = (0, 0, width, height)
        if (len(box) != 4 or any(not math.isfinite(v)
                                 or abs(v - expected[i]) > max(width, height, 1) * 1e-6
                                 for i, v in enumerate(box))):
            raise ValueError("unsupported SVG root viewBox; the page was not emitted")
    for name in ("style", "class", "transform", "fill", "stroke", "opacity", "color",
                 "clip-path", "mask", "filter", "display", "visibility", "overflow"):
        if attr(root, name) is not None:
            raise ValueError(f"unsupported SVG root {name}; the page was not emitted")
    namespaces = "".join(ns.group(0) for ns in re.finditer(
        r'''\s+xmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])([\s\S]*?)\2''', root)
        if ns.group(1) != "xlink")
    clip_id = "__svgout_page_clip"
    while clip_id in all_ids:
        clip_id += "_"
    return {"width": width, "height": height, "defs": defs,
            "definitions": "".join(definitions), "namespaces": namespaces, "scene": scene,
            "uses": uses, "unframed": unframed, "clip_id": clip_id}


def render_scene(scene, selected=None):
    return "".join(item["raw"] for item in scene
                   if "index" not in item or selected is None or item["index"] in selected)


def modal(values):
    """Most common value; ties break towards the smaller one, as in JS."""
    tally: dict = {}
    for k in values:
        tally[k] = tally.get(k, 0) + 1
    return sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


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
    page = src.replace("\\", "/").split("/")[-1].rsplit(".", 1)[0]

    with open(src, encoding="utf-8") as fh:
        svg = fh.read()
    page_scene = read_scene(svg)
    W, H = page_scene["width"], page_scene["height"]
    defs, uses, unframed = (page_scene["defs"], page_scene["uses"],
                            page_scene["unframed"])
    if not uses:
        print(f"no frameable glyph uses in {src} — the page was not emitted",
              file=sys.stderr)
        return 1

    # the page's dominant size sets the grouping tolerance; each line then takes
    # its own size, so a page that mixes 11 pt and 12 pt still frames correctly
    tol = modal(u["size"] for u in uses) * UNITS

    # ---- line boundaries -------------------------------------------------
    # pdf2svg.py writes <page>.lines.json beside the SVG: the PDF's own
    # text-layer lines. That file is the authority. Guessing a baseline
    # tolerance merges real lines on a page whose sub-headings interleave with
    # the body, so the guess is only a fallback and it says so out loud.
    lines_path = re.sub(r"\.svg$", ".lines.json", src)
    page_lines = None
    try:
        with open(lines_path, encoding="utf-8") as fh:
            metadata = json.load(fh)
        if metadata.get("coordinates") == "svg-page":
            page_lines = metadata["lines"]
        else:
            print(f"unverified coordinates in {lines_path} — falling back to a baseline tolerance; "
                  "re-export the page with pdf2svg.py", file=sys.stderr)
    except FileNotFoundError:
        print(f"no {lines_path} — falling back to a baseline tolerance; "
              "run pdf2svg.py to get exact line boundaries", file=sys.stderr)
    if page_lines is not None and not isinstance(page_lines, list):
        raise ValueError("invalid page line metadata")
    if page_lines == []:
        print(f"no text lines in {lines_path} — falling back to a baseline tolerance",
              file=sys.stderr)

    def inferred_row(glyphs):
        return {"x": min(u["ink"][0] if u["ink"] else u["x"] for u in glyphs),
                "y": modal(float(fixed(u["y"])) for u in glyphs),
                "size": modal(u["size"] for u in glyphs),
                "text": "", "glyphs": glyphs}

    def nearest_row(u, candidates):
        best, distance = None, math.inf
        for r in candidates:
            d = abs(r["y"] - u["y"])
            if d < distance:
                best, distance = r, d
        return best if distance <= tol else None

    unmatched_ink = []
    if page_lines:
        rows = [{"x": x, "y": y, "size": size, "text": text, "glyphs": []}
                for x, y, size, text in page_lines]
        for u in uses:
            row = nearest_row(u, rows)
            if row is not None:
                row["glyphs"].append(u)
            elif u["ink"]:
                unmatched_ink.append(u)
            else:
                unframed.append(u["index"])
    else:
        # Empty outlines do not establish a line. Attach them to a nearby
        # inferred row, or retain them unframed on the full page sheet.
        buckets: dict[float, list] = {}
        for u in (v for v in uses if v["ink"]):
            key = None
            for k in buckets:
                if abs(k - u["y"]) <= tol:
                    key = k
                    break
            if key is None:
                key = u["y"]
                buckets[key] = []
            buckets[key].append(u)
        rows = [inferred_row(g) for g in buckets.values()]
        for u in (v for v in uses if not v["ink"]):
            row = nearest_row(u, rows)
            if row is not None:
                row["glyphs"].append(u)
            else:
                unframed.append(u["index"])

    if unmatched_ink:
        buckets = {}
        for u in unmatched_ink:
            buckets.setdefault(fixed(u["y"]), []).append(u)
        rows.extend(inferred_row(g) for g in buckets.values())
        print(f"{len(unmatched_ink)} unmatched glyph uses retained in "
              f"{len(buckets)} inferred row(s)", file=sys.stderr)
    rows.sort(key=lambda r: (r["y"], r["x"]))
    if not rows:
        raise ValueError("no text rows or visible glyphs; the page was not emitted")
    if unframed:
        print(f"{len(unframed)} uses could not be assigned to a line; retained "
              "at their original positions on the full sheet", file=sys.stderr)

    # Each line takes the calibrated band, raised only if its own ink needs
    # more. The four rules stay equally spaced; only the spacing scales, so the
    # design holds on a page the calibration did not cover.
    for r in rows:
        r["band"] = bandFor(r["y"], r["size"], r["glyphs"])
    lines = [(r["x"], r["y"], r["size"], r["text"], r["band"]) for r in rows]

    frames = framesOf(lines)
    pitch = pitchOf(frames)

    def rows_uses(frame):
        return rows[frame["index"] - 1]["glyphs"]

    rnd = mulberry32(seed)
    pick = 1 + int(rnd() * len(frames))
    frame = frames[pick - 1]
    line_uses = rows_uses(frame)

    print(f"{page}   width {num(W)}   {len(uses)} glyph uses   {len(frames)} lines")
    print(f"assigned {sum(len(r['glyphs']) for r in rows)}/{len(uses)} glyph uses; "
          f"{len(unframed)} uses retained unframed on the full sheet")
    print("sizes " + ", ".join(num(v) for v in sorted({f["size"] for f in frames})))
    blank = blankOf(frame, pitch)
    print(f"pitch {num(pitch) if pitch else '— (not uniform)'}   "
          f"slot {fixed(frame['slot'])}   "
          f"blank {'—' if blank is None else fixed(blank)}")
    print(f"band {fixed(frame['band'], 3)}  E {fixed(frame['E'])}  rules "
          + " / ".join(fixed(v) for v in (frame["r1"], frame["r2"],
                                          frame["r3"], frame["r4"])))
    print(f"random line {pick} of {len(frames)}   "
          f"baseline {fixed(frame['baseline'])}   {len(line_uses)} glyphs")

    bad = unchecked = 0
    for f in frames:
        glyphs = rows_uses(f)
        if any(u["fullPage"] for u in glyphs):
            unchecked += 1
            continue
        o = overflow(f, glyphs)
        if not o["ok"]:
            bad += 1
            print(f"  ! line {f['index']} (size {num(f['size'])}, "
                  f"band {fixed(f['band'], 3)}) "
                  f"ink {fixed(o['above'])} above / {fixed(o['below'])} below")
    fit_note = f"; {unchecked} not assessed for strokes or effects" if unchecked else ""
    print(f"fit: {len(frames) - bad - unchecked}/{len(frames)} lines inside the rules{fit_note}")

    keep = parse_lines(only, len(frames))
    selected = frames if keep is None else [f for f in frames if f["index"] in keep]
    if not selected:
        raise ValueError("the line selector matched nothing; the page was not emitted")
    all_rows = [{"frame": f, "uses": rows_uses(f)} for f in selected]
    all_lines = len(selected) == len(frames)
    selected_ids = (None if all_lines else
                    {u["index"] for row in all_rows for u in row["uses"]})
    line_ids = {u["index"] for u in line_uses}
    line_full_page = any(u["fullPage"] for u in line_uses)
    sheet_full_page = all_lines or any(u["fullPage"] for row in all_rows for u in row["uses"])
    if line_full_page or (not all_lines and sheet_full_page):
        print("stroke or effects present; retained the source page viewport to avoid clipping a selected use",
              file=sys.stderr)

    line_output = lineSvg(width=W, frame=frame, uses=line_uses, defs=defs, pitch=pitch,
                          label=f"{page} line {pick}", definitions=page_scene["definitions"],
                          namespaces=page_scene["namespaces"], source_height=H,
                          clip_id=page_scene["clip_id"], full_page=line_full_page,
                          scene=render_scene(page_scene["scene"], line_ids))
    sheet_output = sheetSvg(width=W, rows=all_rows, defs=defs, pitch=pitch,
                            definitions=page_scene["definitions"], namespaces=page_scene["namespaces"],
                            scene=render_scene(page_scene["scene"], selected_ids),
                            source_height=H, clip_id=page_scene["clip_id"],
                            page_height=H if sheet_full_page else None)
    with open(f"svgout/known/line-sample{suffix}.svg", "w", encoding="utf-8") as fh:
        fh.write(line_output)
    with open(f"svgout/known/frame-sheet{suffix}.svg", "w", encoding="utf-8") as fh:
        fh.write(sheet_output)

    print(f"-> svgout/known/line-sample{suffix}.svg")
    print(f"-> svgout/known/frame-sheet{suffix}.svg")


if __name__ == "__main__":
    sys.exit(main() or 0)
