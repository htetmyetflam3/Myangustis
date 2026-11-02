#!/usr/bin/env python3
"""Page 14: correct text placed as SVG, four equally spaced rules per line.

WHY FOUR RULES AND NOT THREE
    The four rules are equally spaced, so a single number E settles the frame.
    Reading from the baseline b:

        r1 = b - 2E      above-marks band
        r2 = b - E       top of the base letters
        r3 = b           baseline, the yellow line, shared by both scripts
        r4 = b + E       bottom of the below marks

    Three bands, equal width E. The slot they fill is 3E tall, so the baseline
    sits at 2E from the top of the slot -- exactly 2/3 of the way down. The
    sketch confirms this: its yellow rule lands at 0.6637 and 0.6638 of the
    blue rectangle in both copies.

WHY E IS ONE NUMBER FOR THE WHOLE PAGE, NOT PER LINE
    A line's rules have to overlay the next line's rules. If E differed line
    to line the sheets would not stack. So E is the union over everything the
    page draws, and it is chosen once.

WHAT SETS E
    Every band has to contain what lands in it:

        band 2  r2..r3   base letters          E >= tallest base letter
        band 3  r3..r4   below marks           E >= deepest below mark
        band 1  r1..r2   above marks           2E >= tallest above mark

    Measured on page 14 at 12.96 pt:

        Myanmar3 base letters ကခဂဃငစ...   6.65    <- binding
        Myanmar3 below marks ျြွှုူ          5.31
        Myanmar3 above marks ိ ် ံ ္ ြ        11.98 -> /2 = 5.99

    So E = 6.65 pt and the slot is 19.96 pt tall. The PDF's own line spacing
    is 30.12 pt, so 10.16 pt of blank is left between one slot and the next:
    exactly the white strips in the sketch.

WHY THE TWO-FONT TEST MATTERS
    Page 14 carries no Latin letters at all, so only the Burmese base letter
    constrains E. Put one Latin capital on the line and the union moves:

        Myanmar3 က        6.65
        Calibri  a        6.02    stays under the Burmese letter
        Calibri  A        8.19    <- becomes binding
        DejaVu   A        9.62    <- becomes binding

    Same size, same rule, E grows. That is the whole point of the sketch's
    duplicated slot: the frame is set by whichever font reaches highest, not
    by the font the line happens to be written in.
"""
import re
import uharfbuzz as hb
import pymupdf as fitz
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

PAGE = 14
SIZE = 12.96
PDF = '/tmp/representative.pdf'
MM = '/tmp/repo-fonts/mm3_05-Jan-2011.ttf'
CAL = '/tmp/repo-fonts/calibri.ttf'
DV = '/tmp/repo-fonts/DejaVuSans.ttf'

SLOT_FILL = '#D6EAF8'     # the blue rectangle: one line's slot in the PDF
RULE = '#FF6EAE'          # thin and pale, as asked
BASE = '#FFC300'          # the yellow index line
INK = '#000000'


def page_text():
    txt = open('/tmp/parsed.txt', encoding='utf-8').read()
    pg = re.split(r'--- Page (\d+) ---', txt)
    body = {int(pg[i]): pg[i + 1] for i in range(1, len(pg), 2)}[PAGE]
    return [l.rstrip() for l in body.split('\n') if l.strip()]


def pdf_rows():
    d = fitz.open(PDF)
    p = d[PAGE - 1]
    rows = {}
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for sp in l['spans']:
                if sp['text'].strip():
                    rows.setdefault(round(sp['origin'][1], 2), []).append(sp['text'])
    return p.rect.width, p.rect.height, sorted(rows.items())


def ink_extent(path, text):
    """Ink top and bottom relative to the baseline, in pt at SIZE."""
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


def shaper(path):
    ft = TTFont(path)
    glyf = ft['glyf']
    gs = ft.getGlyphSet()
    k = SIZE / ft['head'].unitsPerEm
    hbf = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
    tag = path.split('/')[-1][:4]

    def run(text, x, baseline, paths):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(hbf, buf, {'kern': True, 'liga': True})
        parts = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            if info.codepoint:
                n = ft.getGlyphName(info.codepoint)
                key = f'{tag}_{n}'
                if key not in paths:
                    pen = SVGPathPen(gs)
                    gs[n].draw(pen)
                    paths[key] = pen.getCommands()
                parts.append(
                    f'<use xlink:href="#{key}" transform="translate('
                    f'{x + pos.x_offset * k:.2f} {baseline - pos.y_offset * k:.2f}) '
                    f'scale({k:.6f} {-k:.6f})"/>')
            x += pos.x_advance * k
        return "".join(parts), x

    return run


def main():
    W, H, rows = pdf_rows()
    T = page_text()
    assert len(rows) == len(T), f'{len(rows)} pdf rows vs {len(T)} parser lines'

    # ---- E from the union of everything the page draws ----------------
    base_my = max(ink_extent(MM, c)[0] for c in 'ကခဂဃငစဆဇဉညဋဌဍဎဏတထဒဓနပဖဗဘမယရလဝသဟဠအ')
    below = -min(ink_extent(MM, c)[1] for c in 'ျြွှုူ')
    above = max(ink_extent(MM, s)[0] for s in ['ိ', '်', 'ံ', 'င်္', 'ြ'])
    E = max(base_my, below, above / 2)

    pitch_tally = {}
    for (a, _), (b, _) in zip(rows, rows[1:]):
        pitch_tally[round(b - a, 2)] = pitch_tally.get(round(b - a, 2), 0) + 1
    pitch = max(pitch_tally.items(), key=lambda kv: (kv[1], kv[0]))[0]

    print(f"page {PAGE}   {W:.2f} x {H:.2f} pt   text {SIZE} pt   pitch {pitch:.2f} pt")
    print(f"  base letters  {base_my:6.2f}  <- binding")
    print(f"  below marks   {below:6.2f}")
    print(f"  above marks   {above:6.2f}   /2 = {above/2:6.2f}")
    print(f"  E = {E:.2f} pt = {E/SIZE:.3f} em")
    print(f"  slot 3E {3*E:6.2f}   rules at b{-2*E:+.2f} / b{-E:+.2f} / b+0.00 / b+{E:.2f}")
    print(f"  blank pitch-3E {pitch-3*E:.2f}   slot {3*E/pitch*100:.0f}% / blank {(pitch-3*E)/pitch*100:.0f}%")

    # ---- lay the sheet out -------------------------------------------
    paths = {}
    body, decor, labels = [], [], []
    y = 30.0

    for (b, _pdftxt), t in zip(rows, T):
        slot_top, slot_bot = b - 2 * E, b + E
        decor.append(f'<rect x="0" y="{slot_top:.2f}" width="{W:.2f}" '
                     f'height="{3*E:.2f}" fill="{SLOT_FILL}"/>')
        for yy in (slot_top, b - E, b + E):
            decor.append(f'<line x1="0" y1="{yy:.2f}" x2="{W:.2f}" y2="{yy:.2f}" '
                         f'stroke="{RULE}" stroke-width="0.5"/>')
        decor.append(f'<line x1="0" y1="{b:.2f}" x2="{W:.2f}" y2="{b:.2f}" '
                     f'stroke="{BASE}" stroke-width="0.7"/>')
        run, _ = shaper(MM)(t, 111.38, b, paths)
        body.append(run)

    # ---- the two-font test strip -------------------------------------
    y = rows[-1][0] + E + 60
    demo = [('Myanmar3  က', MM, 'က'), ('Myanmar3  ကျ', MM, 'ကျ'),
            ('Myanmar3  ကင်္', MM, 'င်္က'),
            ('Calibri  a', CAL, 'd'), ('DejaVu  a', DV, 'a'),
            ('DejaVu  A', DV, 'A'), ('DejaVu  g', DV, 'g')]
    b = y + 2 * E
    decor.append(f'<rect x="0" y="{b-2*E:.2f}" width="{W:.2f}" height="{3*E:.2f}" '
                 f'fill="{SLOT_FILL}"/>')
    for yy in (b - 2 * E, b - E, b + E):
        decor.append(f'<line x1="0" y1="{yy:.2f}" x2="{W:.2f}" y2="{yy:.2f}" '
                     f'stroke="{RULE}" stroke-width="0.5"/>')
    decor.append(f'<line x1="0" y1="{b:.2f}" x2="{W:.2f}" y2="{b:.2f}" '
                 f'stroke="{BASE}" stroke-width="0.7"/>')
    for i, (lbl, path, ch) in enumerate(demo):
        x = 46 + i * 78
        r, _ = shaper(path)(ch, x, b, paths)
        body.append(r)
        labels.append(f'<text x="{x:.1f}" y="{b + E + 14:.1f}" font-family="DejaVu Sans" '
                      f'font-size="7.5" fill="#666">{lbl}</text>')

    bot = b + E + 34
    top = 6.0
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'version="1.1" width="{W:.2f}" height="{bot-top:.2f}" '
        f'viewBox="0 {top:.2f} {W:.2f} {bot-top:.2f}" data-page="{PAGE}" '
        f'data-lines="{len(rows)}" data-size="{SIZE}" data-E="{E:.3f}" '
        f'data-pitch="{pitch:.2f}" data-slot="{3*E:.2f}">\n'
        f'<rect x="0" y="{top:.2f}" width="{W:.2f}" height="{bot-top:.2f}" fill="#fff"/>\n'
        '<defs>' + "".join(f'<path id="{n}" d="{d}"/>' for n, d in paths.items()) + '</defs>\n'
        f'<g fill="{SLOT_FILL}">' + "\n".join(d for d in decor if d.startswith('<rect')) + '</g>\n'
        f'<g fill="none">' + "\n".join(d for d in decor if d.startswith('<line')) + '</g>\n'
        f'<g fill="{INK}">\n' + "\n".join(body) + '\n</g>\n'
        '<g>' + "".join(labels) + '</g>\n</svg>\n')
    out = 'svgout/known/p14-sheet.svg'
    open(out, 'w', encoding='utf-8').write(svg)
    print(f"  -> {out}   {len(svg)/1024:.1f} KB   {len(paths)} outlines")

    d = fitz.open(out)
    pix = d[0].get_pixmap(matrix=fitz.Matrix(2.4, 2.4))
    pix.save('svgout/known/p14-sheet.png')
    print(f"  -> svgout/known/p14-sheet.png   {pix.width} x {pix.height}")


if __name__ == '__main__':
    main()
