#!/usr/bin/env python3
"""Four rules per line, equal vertical width, derived from the PDF.

THE LOGIC (from the sketch, not its numbers)
    blue   = the whole line slot inside the PDF
    white  = line spacing (the gap between one slot and the next)
    yellow = the baseline; Burmese and Latin both sit on it
    four rules, equally spaced

    Because the four rules are equally spaced, one number decides everything:
    E, the band width. The rules are then, from one baseline b:

        r1 = b - 2E      r2 = b - E      r3 = b (yellow)      r4 = b + E

WHAT SETS E
    Each band has to hold the tallest thing that lands in it, and E must
    clear all three:

        band 2 (r2..r3) must hold the base letters   -> E >= base/cap height
        band 3 (r3..r4) must hold the below marks    -> E >= below depth
        band 1 (r1..r2) must hold the above marks    -> 2E >= above-mark top

    The base letter is the binding one, and it is the *union over every font
    on the page*, not one font. At 12.96 pt:

        Myanmar3  က   6.55 pt          Calibri cap H   8.19 pt
        Calibri   a   6.02 pt          Calibri 'l'     9.72 pt (ascender)

    So Latin cap height decides E on this page, not Burmese. That is the
    whole point of the two-font duplicate in the sketch: same size, same
    text, different vertical extent, and the rule has to fit both.

    E is then clamped so the slots still tile the page:
        E = min( max(base, below, above/2), pitch/3 )
"""
import re
import sys
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

PAGE = 14
SIZE = 12.96
MM = '/tmp/repo-fonts/mm3_05-Jan-2011.ttf'
CAL = '/tmp/repo-fonts/calibri.ttf'
PDF = '/tmp/representative.pdf'


def text_lines():
    txt = open('/tmp/parsed.txt', encoding='utf-8').read()
    pg = re.split(r'--- Page (\d+) ---', txt)
    body = {int(pg[i]): pg[i + 1] for i in range(1, len(pg), 2)}[PAGE]
    return [l.rstrip() for l in body.split('\n') if l.strip()]


def pdf_baselines():
    import pymupdf as fitz
    d = fitz.open(PDF)
    p = d[PAGE - 1]
    rows = {}
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for sp in l['spans']:
                if sp['text'].strip():
                    rows.setdefault(round(sp['origin'][1], 2), []).append(sp['text'])
    out = []
    for y in sorted(rows):
        out.append((y, ''.join(rows[y])))
    return p.rect.width, p.rect.height, out


def extent(path, text):
    ft = TTFont(path)
    upm = ft['head'].unitsPerEm
    glyf = ft['glyf']
    k = SIZE / upm
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


def main():
    W, H, pdfrows = pdf_baselines()
    T = text_lines()
    if len(pdfrows) != len(T):
        print(f"!! {len(pdfrows)} pdf rows vs {len(T)} parser lines")
        return

    # ---- E from the union of every font on the page -------------------
    base_mm = max(extent(MM, c)[0] for c in 'ကခဂဃငစဆဇဉညဋဌဍဎဏတထဒဓနပဖဗဘမယရလဝသဟဠအ')
    base_cal = max(extent(CAL, c)[0] for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') \
        if True else 0
    below = -min(extent(MM, c)[1] for c in 'ျြွှုူ')
    above = max(extent(MM, c)[0] for c in 'ိ ် ံ ့ း ္'.split()) if False else 0
    above = max(extent(MM, s)[0] for s in ['ိ', '်', 'ံ', 'င်္', 'ြ'])

    # pitch from the PDF's own baselines
    gaps = [b - a for (a, _), (b, _) in zip(pdfrows, pdfrows[1:])]
    tally = {}
    for g in gaps:
        tally[round(g, 2)] = tally.get(round(g, 2), 0) + 1
    pitch = max(tally.items(), key=lambda kv: (kv[1], kv[0]))[0]

    need = max(base_mm, base_cal, below, above / 2)
    E = min(need, pitch / 3)

    print(f"page {PAGE}   {W:.2f} x {H:.2f} pt   font {SIZE} pt")
    print(f"  pitch (from the PDF's own baselines)  {pitch:.2f} pt")
    print(f"  base  Myanmar3 base letters           {base_mm:6.2f}")
    print(f"  base  Calibri cap A-Z                 {base_cal:6.2f}   <- binding")
    print(f"  below Myanmar3 ျြွှုူ                   {below:6.2f}")
    print(f"  above Myanmar3 ိ ် ံ ္ ြ                 {above:6.2f}  -> /2 = {above/2:6.2f}")
    print(f"  E = min(need {need:.2f}, pitch/3 {pitch/3:.2f}) = {E:.2f} pt  = {E/SIZE:.3f} em")
    print(f"  slot 3E {3*E:.2f}   gap pitch-3E {pitch-3*E:.2f}   "
          f"({3*E/pitch*100:.0f}% slot / {(pitch-3*E)/pitch*100:.0f}% blank)")

    # ---- place the text, shaped, as outlines --------------------------
    ft = TTFont(MM)
    upm = ft['head'].unitsPerEm
    gs = ft.getGlyphSet()
    k = SIZE / upm
    font = hb.Font(hb.Face(hb.Blob.from_file_path(MM)))
    paths = {}

    def path_for(gid):
        n = ft.getGlyphName(gid)
        if n not in paths:
            pen = SVGPathPen(gs)
            gs[n].draw(pen)
            paths[n] = pen.getCommands()
        return n

    nlines = 8
    body, rules, slots, glyphs = [], [], [], 0
    for (b, _pdftxt), t in list(zip(pdfrows, T))[:nlines]:
        cps = [ord(c) for c in t]
        buf = hb.Buffer()
        buf.add_codepoints(cps)
        buf.guess_segment_properties()
        hb.shape(font, buf, {'kern': True, 'liga': True})
        x = 111.38  # left text edge on this page
        parts = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            if info.codepoint:
                n = path_for(info.codepoint)
                tx = x + pos.x_offset * k
                ty = b - pos.y_offset * k
                parts.append(f'<use xlink:href="#{n}" '
                             f'transform="translate({tx:.2f} {ty:.2f}) '
                             f'scale({k:.6f} {-k:.6f})"/>')
                glyphs += 1
            x += pos.x_advance * k
        body.append("\n".join(parts))
        slots.append(f'<rect x="0" y="{b-2*E:.2f}" width="{W:.2f}" height="{3*E:.2f}" fill="#EAF4FF"/>')
        for yy in (b - 2 * E, b - E, b, b + E):
            rules.append(f'<line x1="0" y1="{yy:.2f}" x2="{W:.2f}" y2="{yy:.2f}"/>')
        rules.append(f'<line x1="0" y1="{b:.2f}" x2="{W:.2f}" y2="{b:.2f}" class="base"/>')

    top = pdfrows[0][0] - 2 * E - 14
    bot = pdfrows[nlines - 1][0] + E + 14
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'version="1.1" width="{W:.2f}" height="{bot-top:.2f}" '
        f'viewBox="0 {top:.2f} {W:.2f} {bot-top:.2f}" '
        f'data-lines="{nlines}" data-glyphs="{glyphs}" data-E="{E:.3f}" '
        f'data-pitch="{pitch:.2f}" data-slot="{3*E:.2f}" data-gap="{pitch-3*E:.2f}">\n'
        f'<rect x="0" y="{top:.2f}" width="{W:.2f}" height="{bot-top:.2f}" fill="#fff"/>\n'
        '<g>' + "".join(slots) + '</g>\n'
        '<defs>' + "".join(f'<path id="{n}" d="{d}"/>' for n, d in paths.items()) + '</defs>\n'
        '<g fill="#000">\n' + "\n".join(body) + '\n</g>\n'
        '<g stroke="#9DC8F5" stroke-width="0.4" fill="none">\n'
        + "\n".join(r for r in rules if 'class' not in r) + '\n</g>\n'
        '<g stroke="#FFB800" stroke-width="0.6" fill="none">\n'
        + "\n".join(r for r in rules if 'class' in r) + '\n</g>\n'
        '</svg>\n'
    )
    out = 'svgout/known/p14-rules.svg'
    open(out, 'w', encoding='utf-8').write(svg)
    print(f"  -> {out}   {len(svg)/1024:.1f} KB   {glyphs} glyphs, {len(paths)} outlines")

    import pymupdf as fitz
    d = fitz.open(out)
    pix = d[0].get_pixmap(matrix=fitz.Matrix(2.2, 2.2))
    pix.save('svgout/known/p14-rules.png')
    print(f"  -> svgout/known/p14-rules.png  {pix.width}x{pix.height}")


if __name__ == '__main__':
    main()
