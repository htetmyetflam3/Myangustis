#!/usr/bin/env python3
"""Precompute the four rules from font size alone. E = size / 2.

THE MATH, TAKEN FROM THE FONT, NOT FROM THE SCRIPT
    Two glyphs carry the extremes, so nothing has to be classified as a
    "base" or a "mark":

        ိ  U+102D   highest ink above the baseline   0.9389 em
        ု  U+102F   deepest ink below the baseline   0.4000 em

    Four equally spaced rules with the baseline on the third one:

        r1 = b - 2E     r2 = b - E     r3 = b     r4 = b + E

    so the slot is 3E tall, 2E of it above the baseline and E below. Each
    band has to hold what lands in it:

        band 1  r1..r2   ိ must fit      2E >= 0.9389  ->  E >= 0.4694
        band 3  r3..r4   ု must fit       E >= 0.4000  ->  E >= 0.4000

    binding E = 0.4694 em, and both glyphs are 0.4978 em wide, so the round
    unit is half an em:

        E = size / 2

    Check at E = 0.5: above room 1.0 em >= 0.9389 (0.061 spare),
    below room 0.5 em >= 0.4000 (0.100 spare). Nothing clips.

WHY THIS IS A TABLE AND NOT A MEASUREMENT PER LINE
    E depends on the size only. The frame is therefore identical for every
    font at that size -- which is the point of the sketch: the second font is
    inline, the first one runs above the lines, and neither changes the rules.
    E is taken from a common font (Myanmar3), never from a display or italic
    face, because those reach higher and would inflate every sheet.

    The vertical pitch is separate and comes from the PDF: page 14 sets at
    12.96 pt with 30.12 pt between baselines. Slot 3E = 19.44 pt, blank 10.68.
"""
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

REF = '/tmp/repo-fonts/mm3_05-Jan-2011.ttf'   # the common font
E_EM = 0.5                                     # size / 2


def ink_em(path, text):
    ft = TTFont(path)
    upm = ft['head'].unitsPerEm
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
            tops.append((i.codepoint, g.yMax / upm, g.yMin / upm))
    return tops


def probe(path, chars):
    hi = max((ink_em(path, c)[0][1] for c in chars if ink_em(path, c)), default=0)
    lo = min((ink_em(path, c)[0][2] for c in chars if ink_em(path, c)), default=0)
    return hi, lo


def table(sizes):
    print(f"{'size':>7} {'E=S/2':>8} {'3E':>8} {'r1':>9} {'r2':>9} {'r3':>8} {'r4':>8}")
    rows = []
    for S in sizes:
        E = S * E_EM
        print(f"{S:7.2f} {E:8.2f} {3*E:8.2f} {-2*E:9.2f} {-E:9.2f} {0.0:8.2f} {E:8.2f}")
        rows.append((S, E, 3 * E))
    return rows


def main():
    print("extremes measured in Myanmar3, unshaped glyph ink:\n")
    hi_i, _ = probe(REF, [chr(0x102D)])
    _, lo_u = probe(REF, [chr(0x102F)])
    print(f"  ိ  above  {hi_i:.4f} em")
    print(f"  ု  below  {-lo_u:.4f} em")
    need = max(hi_i / 2, -lo_u)
    print(f"\n  binding E = {need:.4f} em   ->  E = {E_EM} em = size/2")
    print(f"  above room 2E = {2*E_EM:.4f} em  spare {2*E_EM-hi_i:+.4f}")
    print(f"  below room  E = {E_EM:.4f} em  spare {E_EM+lo_u:+.4f}\n")

    sizes = [8, 9, 10, 11, 12, 12.96, 14, 16, 18, 20, 24, 28, 32, 36, 48]
    E_tab = table(sizes)

    print("\nsame size, different text fonts -- the frame does not move:")
    print(f"  {'font':26} {'ိ above':>8} {'ု below':>8}  {'band1':>7} {'band3':>7}  verdict")
    files = ['mm3_05-Jan-2011.ttf', 'mm3-multi-os.ttf', 'mm3h.ttf', 'mm3sh.ttf',
             'NotoSansMyanmar-Regular.ttf', 'PADAUK-REGULAR.TTF',
             'PYIDAUNGSU-2.5.2_BOLD.TTF', 'MyanmarSansPro.ttf']
    for name in files:
        p = '/tmp/repo-fonts/' + name
        try:
            a, b = probe(p, [chr(0x102D)])
            c, d = probe(p, [chr(0x102F)])
        except Exception as e:
            print(f"  {name:26} {e}")
            continue
        ok1 = a <= 2 * E_EM
        ok3 = -d <= E_EM
        v = 'inline' if ok1 and ok3 else ('above' if not ok1 else 'below')
        print(f"  {name:26} {a:8.4f} {-d:8.4f}  {2*E_EM:7.4f} {E_EM:7.4f}  {v}")


if __name__ == '__main__':
    main()
