#!/usr/bin/env python3
"""How wide should the equal band E be? Three candidates, measured, drawn.

The four rules are equally spaced, so one number E settles everything:
    r1 = b-2E   r2 = b-E   r3 = b (baseline)   r4 = b+E

Three ways to pick E, all measured on page 14 at 12.96 pt:

    A  page content only   E = tallest base letter actually on the page
    B  both scripts        E = tallest base letter of either font, so the
                              same frame takes a Burmese line and a Latin line
    C  fill the pitch      E = pitch/3, no blank left at all

A and B differ only because a Latin capital is ~8.2-9.6 pt tall while a
Burmese base letter is 6.65 pt at the same size. That is the sketch's point:
same size, same word, different vertical extent.
"""
import pymupdf as fitz
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

SIZE = 12.96
MM = '/tmp/repo-fonts/mm3_05-Jan-2011.ttf'
DV = '/tmp/repo-fonts/DejaVuSans.ttf'
CAL = '/tmp/repo-fonts/calibri.ttf'
PITCH = 30.12
W = 595.32
LEFT = 46.0


def extent(path, text):
    ft = TTFont(path)
    upm = ft['head'].unitsPerEm
    k = SIZE / upm
    glyf = ft['glyf']
    f = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(f, buf, {})
    tops, bots = [], []
    for i in buf.glyph_infos:
        g = glyf[ft.getGlyphName(i.codepoint)]
        if g.numberOfContours:
            g.recalcBounds(glyf)
            tops.append(g.yMax * k)
            bots.append(g.yMin * k)
    return (max(tops) if tops else 0.0, min(bots) if bots else 0.0)


def shape_run(path, text, origin_x, baseline, paths):
    ft = TTFont(path)
    upm = ft['head'].unitsPerEm
    gs = ft.getGlyphSet()
    k = SIZE / upm
    f = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(f, buf, {'kern': True, 'liga': True})
    x = origin_x
    parts = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        gid = info.codepoint
        if gid:
            n = ft.getGlyphName(gid)
            key = f'{path.split("/")[-1][:4]}_{n}'
            if key not in paths:
                pen = SVGPathPen(gs)
                gs[n].draw(pen)
                paths[key] = pen.getCommands()
            tx = x + pos.x_offset * k
            ty = baseline - pos.y_offset * k
            parts.append(f'<use xlink:href="#{key}" '
                         f'transform="translate({tx:.2f} {ty:.2f}) '
                         f'scale({k:.6f} {-k:.6f})"/>')
        x += pos.x_advance * k
    return "".join(parts), x


def main():
    base_mm = max(extent(MM, c)[0] for c in 'ကခဂဃငစဆဇဉညဋဌဍဎဏတထဒဓနပဖဗဘမယရလဝသဟဠအ')
    base_dv = max(extent(DV, c)[0] for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    base_cal = extent(CAL, 'd')[0]
    below = -min(extent(MM, c)[1] for c in 'ျြွှုူ')
    above = max(extent(MM, s)[0] for s in ['ိ', '်', 'ံ', 'င်္', 'ြ'])

    cands = [
        ('A  page content only', max(base_mm, below, above / 2), '#2E86DE'),
        ('B  both scripts',      max(base_mm, base_dv, below, above / 2), '#27AE60'),
        ('C  fill the pitch',    PITCH / 3, '#C0392B'),
    ]

    print(f"at {SIZE} pt   pitch {PITCH} pt")
    print(f"  Myanmar3 base letters   {base_mm:6.2f}")
    print(f"  DejaVu caps A-Z         {base_dv:6.2f}")
    print(f"  Calibri 'd'             {base_cal:6.2f}  (subset: only d/M are latin)")
    print(f"  Myanmar3 below marks    {below:6.2f}")
    print(f"  Myanmar3 above marks    {above:6.2f}  /2 = {above/2:6.2f}\n")
    for name, E, col in cands:
        print(f"  {name:22} E {E:6.2f}  slot 3E {3*E:6.2f}  "
              f"blank {PITCH-3*E:6.2f}  slot {3*E/PITCH*100:3.0f}%  "
              f"above limit {2*E:6.2f} vs {above:.2f} "
              f"{'OK' if 2*E >= above else 'CLIPS'}")

    T = ['စာပေနှင့်အနုပညာမူပိုင်ခွင့်ဥပဒေ',
         '၁။ (က) ဤဥပဒေကို စာပေနှင့်အနုပညာမူပိုင်ခွင့်ဥပဒေ ဟု ခေါ်တွင်စေရမည်။']

    paths, bands, labels = {}, [], []
    y = 26.0
    for name, E, col in cands:
        labels.append((y, f'{name}     E = {E:.2f} pt     slot 3E = {3*E:.2f}'
                           f'     blank = {PITCH-3*E:.2f}', col))
        y += 16
        for t in T:
            b = y + 2 * E
            body, _ = shape_run(MM, t, LEFT, b, paths)
            bands.append(f'<rect x="0" y="{b-2*E:.2f}" width="{W:.2f}" '
                         f'height="{3*E:.2f}" fill="{col}" fill-opacity="0.06"/>')
            for yy in (b - 2 * E, b - E, b + E):
                bands.append(f'<line x1="0" y1="{yy:.2f}" x2="{W:.2f}" y2="{yy:.2f}" '
                             f'stroke="{col}" stroke-width="0.7"/>')
            bands.append(f'<line x1="0" y1="{b:.2f}" x2="{W:.2f}" y2="{b:.2f}" '
                         f'stroke="#FFB800" stroke-width="1.1"/>')
            bands.append(body)
            y = b + E + (PITCH - 3 * E)
        y += 30

    # ---- the sketch's two-font test at the widest candidate -------------
    E = cands[1][1]
    labels.append((y, f'B again: the same E must take က and a on one baseline    '
                       f'E = {E:.2f}', '#27AE60'))
    y += 16
    b = y + 2 * E
    bands.append(f'<rect x="0" y="{b-2*E:.2f}" width="{W:.2f}" height="{3*E:.2f}" '
                 f'fill="#27AE60" fill-opacity="0.06"/>')
    for yy in (b - 2 * E, b - E, b + E):
        bands.append(f'<line x1="0" y1="{yy:.2f}" x2="{W:.2f}" y2="{yy:.2f}" '
                     f'stroke="#27AE60" stroke-width="0.7"/>')
    bands.append(f'<line x1="0" y1="{b:.2f}" x2="{W:.2f}" y2="{b:.2f}" '
                 f'stroke="#FFB800" stroke-width="1.1"/>')
    for i, (path, ch) in enumerate([(MM, 'က'), (MM, 'ကျ'), (MM, 'ကင်္'),
                                    (DV, 'a'), (DV, 'H'), (DV, 'g'), (DV, 'l')]):
        body, _ = shape_run(path, ch, LEFT + i * 46, b, paths)
        bands.append(body)
        bands.append(f'<text x="{LEFT + i * 46:.1f}" y="{b + E + 13:.2f}" '
                     f'font-family="DejaVu Sans" font-size="8" fill="#777">'
                     f'{ch if path == MM else ch}</text>')

    bot = b + E + 30
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'version="1.1" width="{W}" height="{bot:.2f}" viewBox="0 0 {W} {bot:.2f}">\n'
        f'<rect width="{W}" height="{bot:.2f}" fill="#fff"/>\n'
        '<defs>' + "".join(f'<path id="{n}" d="{d}"/>' for n, d in paths.items()) + '</defs>\n'
        '<g fill="#000">' + "".join(bands) + '</g>\n'
        '<g font-family="DejaVu Sans" font-size="9.5">'
        + "".join(f'<text x="8" y="{yy:.2f}" fill="{c}">{nm}</text>'
                  for yy, nm, c in labels)
        + '</g>\n</svg>\n')
    open('svgout/known/rule-candidates.svg', 'w', encoding='utf-8').write(svg)

    d = fitz.open('svgout/known/rule-candidates.svg')
    pix = d[0].get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
    pix.save('svgout/known/rule-candidates.png')
    print(f"\n-> svgout/known/rule-candidates.png  {pix.width}x{pix.height}")


if __name__ == '__main__':
    main()
