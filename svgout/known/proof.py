#!/usr/bin/env python3
"""Proof sheet for E = size/2, drawn with Myanmar3 and compared across fonts."""
import re
import uharfbuzz as hb
import pymupdf as fitz
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

PAGE, SIZE, PITCH = 14, 12.96, 30.12
MM = '/tmp/repo-fonts/mm3_05-Jan-2011.ttf'
PDF = '/tmp/representative.pdf'

SLOT = '#D6EAF8'
RULE = '#FF6EAE'
BASE = '#FFC300'

FONTS = [('Myanmar3', 'mm3_05-Jan-2011.ttf'),
         ('MM3 multi-os', 'mm3-multi-os.ttf'),
         ('MM3h', 'mm3h.ttf'),
         ('MM3sh', 'mm3sh.ttf'),
         ('MyanmarSansPro', 'MyanmarSansPro.ttf'),
         ('Noto Sans Myanmar', 'NotoSansMyanmar-Regular.ttf'),
         ('Padauk', 'PADAUK-REGULAR.TTF'),
         ('Pyidaungsu Bold', 'PYIDAUNGSU-2.5.2_BOLD.TTF')]


def page_text():
    txt = open('/tmp/parsed.txt', encoding='utf-8').read()
    pg = re.split(r'--- Page (\d+) ---', txt)
    return [l.rstrip() for l in
            {int(pg[i]): pg[i + 1] for i in range(1, len(pg), 2)}[PAGE].split('\n') if l.strip()]


def pdf_rows():
    d = fitz.open(PDF)
    p = d[PAGE - 1]
    rows = {}
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for sp in l['spans']:
                if sp['text'].strip():
                    rows.setdefault(round(sp['origin'][1], 2), []).append(sp['text'])
    return p.rect.width, sorted(rows.items())


class Shaper:
    def __init__(self):
        self.paths = {}

    def run(self, path, text, size, x, baseline):
        ft = TTFont(path)
        upm = ft['head'].unitsPerEm
        gs = ft.getGlyphSet()
        k = size / upm
        hbf = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
        tag = path.split('/')[-1][:6].replace(' ', '_')
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(hbf, buf, {'kern': True, 'liga': True})
        out = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            if info.codepoint:
                n = ft.getGlyphName(info.codepoint)
                key = f'{tag}_{n}'
                if key not in self.paths:
                    pen = SVGPathPen(gs)
                    gs[n].draw(pen)
                    self.paths[key] = pen.getCommands()
                out.append(f'<use xlink:href="#{key}" transform="translate('
                           f'{x + pos.x_offset * k:.2f} {baseline - pos.y_offset * k:.2f}) '
                           f'scale({k:.6f} {-k:.6f})"/>')
            x += pos.x_advance * k
        return "".join(out), x


def frame(E, b, W, parts):
    parts.append(f'<rect x="0" y="{b-2*E:.2f}" width="{W:.2f}" height="{3*E:.2f}" fill="{SLOT}"/>')
    for yy in (b - 2 * E, b - E, b + E):
        parts.append(f'<line x1="0" y1="{yy:.2f}" x2="{W:.2f}" y2="{yy:.2f}" '
                     f'stroke="{RULE}" stroke-width="0.5"/>')
    parts.append(f'<line x1="0" y1="{b:.2f}" x2="{W:.2f}" y2="{b:.2f}" '
                 f'stroke="{BASE}" stroke-width="0.7"/>')


def main():
    W, rows = pdf_rows()
    T = page_text()
    sh = Shaper()
    deco, body, labels = [], [], []
    W = 620.0
    y = 34.0

    # ---------- 1. page 14, first six lines ---------------------------
    labels.append((y - 8, 'page 14   12.96 pt   E = 6.48 (size/2)   pitch 30.12 from the PDF', '#333'))
    for (b0, _t), t in list(zip(rows, T))[:6]:
        b = y + 12.96
        frame(12.96 / 2, b, W, deco)
        r, _ = sh.run(MM, t, 12.96, 111.38, b)
        body.append(r)
        y = b + 12.96 / 2 + (PITCH - 1.5 * 12.96)
    y += 40

    # ---------- 2. size ladder ---------------------------------------
    labels.append((y - 8, 'E follows the size, nothing else:  E = size/2, rules at b-1em / b-0.5em / b / b+0.5em', '#333'))
    y += 12
    for S in (10.0, 12.96, 18.0, 26.0):
        E = S / 2
        b = y + 2 * E
        frame(E, b, W, deco)
        r, _ = sh.run(MM, 'ကိုကို့ကောင်း', S, 40, b)
        body.append(r)
        labels.append((b + E + 9, f'{S:.2f} pt    E {E:.2f}    3E {3*E:.2f}', '#888'))
        y = b + E + 26
    y += 22

    # ---------- 3. one frame, eight fonts ----------------------------
    labels.append((y - 8, 'one fixed frame at 12.96 pt, eight fonts — the rules never move', '#333'))
    y += 12
    for name, fn in FONTS:
        E = 12.96 / 2
        b = y + 2 * E
        frame(E, b, W, deco)
        try:
            r, _ = sh.run('/tmp/repo-fonts/' + fn, 'ကို', 12.96, 44, b)
            body.append(r)
        except Exception as e:
            labels.append((b, f'{name}: {e}', '#c00'))
        labels.append((b + E + 9, name, '#888'))
        y = b + E + 22

    bot = y + 16
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'version="1.1" width="{W}" height="{bot:.2f}" viewBox="0 0 {W} {bot:.2f}" '
        f'data-E_em="0.5" data-ref="{MM.split("/")[-1]}">\n'
        f'<rect width="{W}" height="{bot:.2f}" fill="#fff"/>\n'
        '<defs>' + "".join(f'<path id="{n}" d="{d}"/>' for n, d in sh.paths.items()) + '</defs>\n'
        f'<g fill="{SLOT}">' + "".join(d for d in deco if d.startswith('<rect')) + '</g>\n'
        '<g fill="none">' + "".join(d for d in deco if d.startswith('<line')) + '</g>\n'
        '<g fill="#000">' + "".join(body) + '</g>\n'
        '<g font-family="DejaVu Sans" font-size="8">'
        + "".join(f'<text x="6" y="{yy:.1f}" fill="{c}">{n}</text>' for yy, n, c in labels)
        + '</g>\n</svg>\n')
    out = 'svgout/known/p14-bands.svg'
    open(out, 'w', encoding='utf-8').write(svg)
    d = fitz.open(out)
    pix = d[0].get_pixmap(matrix=fitz.Matrix(2.4, 2.4))
    pix.save('svgout/known/p14-bands.png')
    print(f'-> {out}   {len(svg)/1024:.1f} KB')
    print(f'-> svgout/known/p14-bands.png  {pix.width} x {pix.height}')


if __name__ == '__main__':
    main()
