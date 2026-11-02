#!/usr/bin/env python3
"""Raster page -> line-art SVG with round tips.

EXPERIMENTAL SCRATCH -- OCR LANE ONLY. NOT PRODUCTION.
    This is a proof, not a component. It is here to show that an image page can
    become stroke geometry instead of staying a bitmap, and to record the one
    finding worth keeping: a thin stroke must be traced to its centreline and
    STROKED, not filled from its contour, or the outline doubles.

    Do not import this into the parser as-is. The production lane is described
    in AGENT-NOTE-vector-svg.md, section 4 (the lane verdict). The digital-page
    method -- the one that is final -- is svgout/scan-frame.js.

Raster page -> line-art SVG with round tips.

The page is a photo of a chalk drawing, so the chalk is a thin light stroke on a
dark board. Filling traced contours of a thin stroke gives a doubled outline
that only looks right by accident; what the drawing actually is, is a set of
polylines of a known width. So:

    threshold -> skeletonise to 1 px -> walk the skeleton into polylines
              -> simplify -> stroke with round caps and round joins

Round tips are the point: every stroke ends in a disc, so the sea, the mast and
the little dots all read as chalk rather than as cut-off shapes.
"""
import io
import sys

import numpy as np
import pymupdf as fitz
from PIL import Image
from skimage import exposure, filters, morphology, measure

PDF = '/tmp/representative.pdf'
XREF = 1009            # the 959 x 1455 photo on page 54
STROKE = 2.6           # chalk width in source pixels
TOL = 1.4              # polyline simplification, px


def chalk_mask():
    d = fitz.open(PDF)
    src = Image.open(io.BytesIO(d.extract_image(XREF)['image'])).convert('L')
    a = np.asarray(src, dtype=np.float32)
    H, W = a.shape
    # drop the white page border and the empty upper half of the board
    y0, y1, x0, x1 = int(H * 0.30), int(H * 0.98), int(W * 0.02), int(W * 0.98)
    sub = a[y0:y1, x0:x1]
    # the board is lit from the top, so level each neighbourhood separately
    eq = exposure.equalize_adapthist(sub / sub.max(), clip_limit=0.03)
    smooth = filters.gaussian(eq, 1.2)
    mask = smooth > 0.74
    mask = morphology.remove_small_objects(mask, 12)
    mask = morphology.remove_small_holes(mask, 40)
    return mask, sub


def neighbours(y, x, skel):
    out = []
    h, w = skel.shape
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and skel[ny, nx]:
                out.append((ny, nx))
    return out


def walk(skel):
    """Skeleton -> polylines. Starts at endpoints, then sweeps loops."""
    h, w = skel.shape
    deg = np.zeros((h, w), dtype=np.int8)
    ys, xs = np.nonzero(skel)
    for y, x in zip(ys, xs):
        deg[y, x] = len(neighbours(y, x, skel))

    used = np.zeros((h, w), dtype=bool)
    lines = []

    def grow(start):
        path = [start]
        used[start] = True
        cur = start
        while True:
            nxt = [p for p in neighbours(*cur, skel) if not used[p]]
            if not nxt:
                break
            # prefer to keep going straight through a junction
            if len(nxt) > 1 and len(path) >= 2:
                py, px = path[-2]
                cy, cx = cur
                vy, vx = cy - py, cx - px
                nxt.sort(key=lambda p: (p[0] - cy) * vy + (p[1] - cx) * vx, reverse=True)
            cur = nxt[0]
            used[cur] = True
            path.append(cur)
            if deg[cur] != 2:
                break
        return path

    for y, x in zip(*np.nonzero((skel) & (deg == 1))):
        if used[y, x]:
            continue
        p = grow((y, x))
        if len(p) >= 3:
            lines.append(p)

    for y, x in zip(ys, xs):                     # whatever is left are loops
        if used[y, x]:
            continue
        p = grow((y, x))
        if len(p) >= 3:
            lines.append(p)
    return lines


def to_path(points):
    xy = np.array([[x, y] for y, x in points], dtype=np.float64)
    xy = measure.approximate_polygon(xy[:, [1, 0]], tolerance=TOL)[:, [1, 0]]
    return "M" + " ".join(f"{x:.1f} {y:.1f}" for x, y in xy)


def main():
    mask, sub = chalk_mask()
    skel = morphology.skeletonize(mask)
    lines = walk(skel)
    paths = [to_path(p) for p in lines]
    h, w = mask.shape

    body = "".join(paths)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" version="1.1" '
        f'width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        f'data-paths="{len(paths)}" data-stroke="{STROKE}" data-cap="round">\n'
        f'<rect width="{w}" height="{h}" fill="#141414"/>\n'
        f'<path d="{body}" fill="none" stroke="#F2F2F2" stroke-width="{STROKE}" '
        f'stroke-linecap="round" stroke-linejoin="round"/>\n'
        f'</svg>\n'
    )
    open('/tmp/vec/chalk-round.svg', 'w').write(svg)
    print(f"mask {mask.mean()*100:.2f}%  skeleton {skel.sum()} px -> {len(paths)} polylines")
    print(f"chalk-round.svg  {len(svg)/1024:.1f} KB  stroke {STROKE} px  cap round  join round")

    doc = fitz.open('/tmp/vec/chalk-round.svg')
    pix = doc[0].get_pixmap()
    pix.save('/tmp/vec/chalk-round.png')
    t = Image.open('/tmp/vec/chalk-round.png').convert('RGB')
    s = Image.fromarray(sub.astype(np.uint8)).convert('RGB').resize(t.size)
    side = Image.new('RGB', (t.width * 2 + 16, t.height), (255, 255, 255))
    side.paste(s, (0, 0))
    side.paste(t, (t.width + 16, 0))
    side.save('/tmp/vec/chalk-round-side.png')
    print(f"-> /tmp/vec/chalk-round-side.png  {side.width}x{side.height}")


if __name__ == '__main__':
    main()
