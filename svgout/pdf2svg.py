"""PDF page(s) -> SVG with glyphs as paths, plus a fidelity check.

For each page:
  1. write <stem>-p<N>.svg   (text converted to outlines, images embedded)
     and  <stem>-p<N>.lines.json  (the page's own line boundaries)
  2. rasterise the PDF and the SVG at the same DPI
  3. diff them (raw, and 1.2 px blurred to remove anti-aliasing noise)
  4. write proof/<compare|zoom>-<stem>-p<N>.jpg

Pages are 1-based, matching what you see in any PDF viewer.

Usage:
    python pdf2svg.py --file pdf-part/part-2.pdf --pages 341,342
    python pdf2svg.py --file pdf-parts/part-6.pdf --pages 2,4 --dpi 150
"""
import argparse
import json
import os
import re
import shutil
import sys

import pymupdf
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
PROOF = os.path.join(OUT, "proof")
WORK = os.path.join(OUT, ".work")
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def parse_pages(spec):
    pages = []
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            a, b = chunk.split("-", 1)
            pages.extend(range(int(a), int(b) + 1))
        else:
            pages.append(int(chunk))
    return pages


def png_stats(pdf_png, svg_png):
    a = Image.open(pdf_png).convert("RGB")
    b = Image.open(svg_png).convert("RGB")
    if a.size != b.size:
        b = b.resize(a.size, Image.LANCZOS)

    diff = ImageChops.difference(a, b).convert("L")
    hist = diff.histogram()
    total = a.size[0] * a.size[1]

    ga = a.convert("L")
    gb = b.convert("L")
    da = ImageChops.difference(ga.filter(ImageFilter.GaussianBlur(1.2)),
                               gb.filter(ImageFilter.GaussianBlur(1.2)))
    dh = da.histogram()

    # fraction of pixels darker than mid-grey
    ink_a = sum(ga.histogram()[0:128]) / total
    ink_b = sum(gb.histogram()[0:128]) / total

    return {
        "size": a.size,
        "identical_pct": hist[0] / total * 100,
        "near_pct": sum(hist[0:6]) / total * 100,
        "clear_pct": sum(hist[16:]) / total * 100,
        "max_diff": max(i for i, v in enumerate(hist) if v),
        "blur_mean": sum(v * c for v, c in enumerate(dh)) / total,
        "blur_over32_pct": sum(dh[33:]) / total * 100,
        "ink_pdf_pct": ink_a * 100,
        "ink_svg_pct": ink_b * 100,
        "ink_ratio": (ink_b / ink_a) if ink_a else 0.0,
    }


def text_band(page, frac=0.55):
    """Pick a text-heavy strip for the zoom proof (2x crop)."""
    blocks = [b for b in page.get_text("blocks") if b[4].strip()]
    if not blocks:
        r = page.rect
        w = r.width * frac
        return (r.x0 + 20, r.y0 + 40, w, r.height * 0.18)

    blocks.sort(key=lambda b: len(b[4]), reverse=True)
    x0, y0, x1, y1 = blocks[0][:4]
    w = min(page.rect.width - x0 - 10, max(x1 - x0, page.rect.width * frac))
    h = min(page.rect.height - y0 - 10, max(y1 - y0, page.rect.height * 0.12))
    return (x0, y0, w, h)


def make_proofs(pdf_png, svg_png, band, dpi_scale, out_compare, out_zoom, label):
    a = Image.open(pdf_png).convert("RGB")
    b = Image.open(svg_png).convert("RGB")
    if a.size != b.size:
        b = b.resize(a.size, Image.LANCZOS)

    # ---- side by side with diff ----
    scale = 1800 / a.size[0]
    w, h = int(a.size[0] * scale), int(a.size[1] * scale)
    a_s, b_s = a.resize((w, h), Image.LANCZOS), b.resize((w, h), Image.LANCZOS)
    d_s = ImageChops.difference(a, b).convert("L").resize((w, h), Image.LANCZOS)
    d_s = d_s.point(lambda v: 255 if v > 24 else 0)

    pad, bar = 14, 30
    canvas = Image.new("RGB", (w * 3 + pad * 4, h + bar + pad * 2), "#141414")
    draw = ImageDraw.Draw(canvas)
    try:
        f = ImageFont.truetype(FONT_BOLD, 15)
    except Exception:
        f = ImageFont.load_default()
    for idx, (img, text) in enumerate([(a_s, "PDF"), (b_s, "SVG"), (d_s, "diff >24/255")]):
        x = pad + idx * (w + pad)
        canvas.paste(img, (x, bar + pad))
        draw.text((x + 3, 8), text, font=f, fill="#DDDDDD")
    canvas.save(out_compare, "JPEG", quality=82, optimize=True)

    # ---- zoomed crop ----
    x, y, cw, ch = band
    box = (int(x * dpi_scale), int(y * dpi_scale),
           int((x + cw) * dpi_scale), int((y + ch) * dpi_scale))
    box = (max(0, box[0]), max(0, box[1]),
           min(a.size[0], box[2]), min(a.size[1], box[3]))
    ca, cb = a.crop(box), b.crop(box)
    if ca.width < 50 or ca.height < 20:
        ca, cb = a.crop((0, 0, a.width, min(300, a.height))), b.crop((0, 0, b.width, min(300, b.height)))
    z = 2
    ca = ca.resize((ca.width * z, ca.height * z), Image.LANCZOS)
    cb = cb.resize((cb.width * z, cb.height * z), Image.LANCZOS)

    zc = Image.new("RGB", (ca.width * 2 + 42, ca.height + 44), "#141414")
    zd = ImageDraw.Draw(zc)
    zc.paste(ca, (14, 34))
    zc.paste(cb, (28 + ca.width, 34))
    try:
        f2 = ImageFont.truetype(FONT_BOLD, 15)
    except Exception:
        f2 = ImageFont.load_default()
    zd.text((16, 10), "PDF", font=f2, fill="#DDD")
    zd.text((30 + ca.width, 10), "SVG", font=f2, fill="#DDD")
    zc.save(out_zoom, "JPEG", quality=85, optimize=True)


def page_lines(page):
    """The page's own line boundaries, from the PDF text layer.

    One record per non-empty line: [x, baseline, size, text]. This is the
    authority the runners use instead of guessing a baseline tolerance — on a
    page with interleaved sub-headings a fixed tolerance merges three real
    lines into one frame.
    """
    out = []
    for blk in page.get_text("dict")["blocks"]:
        if blk["type"] != 0:
            continue
        for ln in blk["lines"]:
            spans = [sp for sp in ln["spans"] if sp["text"].strip()]
            if not spans:
                continue
            text = "".join(sp["text"] for sp in ln["spans"])
            size = max(sp["size"] for sp in spans)
            out.append([round(ln["bbox"][0], 2),
                        round(spans[0]["origin"][1], 2),
                        round(size, 2),
                        text])
    # Several text-layer lines can share one baseline (a heading and the body
    # beside it, two columns, a line split by a gap). One baseline is one row:
    # the frame is page-wide, so every glyph sitting on that baseline belongs to
    # the same frame. Merging is what keeps rows from colliding.
    merged: dict[float, list] = {}
    for x, y, size, text in out:
        m = merged.get(y)
        if m is None:
            merged[y] = [x, y, size, text]
        else:
            m[0] = min(m[0], x)
            m[2] = max(m[2], size)
            m[3] = (m[3] + " " + text).strip() if text.strip() else m[3]
    return sorted(merged.values(), key=lambda r: (r[1], r[0]))


def process(path, page_no, dpi):
    doc = pymupdf.open(path)
    if not 1 <= page_no <= doc.page_count:
        raise SystemExit(f"{path}: page {page_no} out of range 1..{doc.page_count}")
    page = doc[page_no - 1]

    stem = re.sub(r"[^A-Za-z0-9]+", "-", os.path.splitext(os.path.basename(path))[0]).strip("-")
    base = f"{stem}-p{page_no}"

    os.makedirs(PROOF, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)

    svg_path = os.path.join(OUT, base + ".svg")
    with open(svg_path, "w", encoding="utf-8") as fh:
        fh.write(page.get_svg_image(matrix=pymupdf.Matrix(1, 1), text_as_path=True))

    lines_path = os.path.join(OUT, base + ".lines.json")
    with open(lines_path, "w", encoding="utf-8") as fh:
        json.dump({"width": round(page.rect.width, 2),
                   "height": round(page.rect.height, 2),
                   "lines": page_lines(page)}, fh, ensure_ascii=False)

    scale = dpi / 72.0
    pdf_png = os.path.join(WORK, base + "-pdf.png")
    svg_png = os.path.join(WORK, base + "-svg.png")
    page.get_pixmap(dpi=dpi).save(pdf_png)

    svg_doc = pymupdf.open(svg_path)
    svg_doc[0].get_pixmap(matrix=pymupdf.Matrix(scale, scale)).save(svg_png)
    svg_doc.close()

    stats = png_stats(pdf_png, svg_png)
    band = text_band(page)

    make_proofs(pdf_png, svg_png, band, scale,
                os.path.join(PROOF, f"compare-{base}.jpg"),
                os.path.join(PROOF, f"zoom-{base}.jpg"),
                base)

    chars = len(page.get_text("text").strip())
    imgs = len(page.get_images(full=True))
    fonts = sorted({f[3] for f in page.get_fonts(full=True)})
    page_pt = f"{page.rect.width:.0f}x{page.rect.height:.0f}"

    doc.close()

    return {
        "source": path,
        "page": page_no,
        "svg": os.path.basename(svg_path),
        "lines_json": os.path.basename(lines_path),
        "lines": len(page_lines(page)),
        "svg_kib": os.path.getsize(svg_path) / 1024,
        "page_pt": page_pt,
        "chars": chars,
        "images": imgs,
        "fonts": fonts,
        **stats,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--pages", required=True, help="1-based, e.g. 341,342 or 341-342")
    ap.add_argument("--dpi", type=int, default=150)
    args = ap.parse_args()

    results = []
    for p in parse_pages(args.pages):
        r = process(args.file, p, args.dpi)
        results.append(r)
        print(f"\n{r['source']}  page {r['page']}  ({r['page_pt']} pt, {r['chars']} chars, "
              f"{r['images']} images)")
        print(f"   {r['svg']}  {r['svg_kib']:.0f} KiB"
              f"  + {r['lines_json']} ({r['lines']} lines)")
        print(f"   ink coverage : pdf {r['ink_pdf_pct']:.3f}%  svg {r['ink_svg_pct']:.3f}%"
              f"  ratio {r['ink_ratio']:.4f}")
        print(f"   raw diff     : identical {r['identical_pct']:.2f}%  "
              f"clear {r['clear_pct']:.2f}%  max {r['max_diff']}/255")
        print(f"   blurred 1.2px: mean {r['blur_mean']:.2f}/255  "
              f">32: {r['blur_over32_pct']:.4f}%")

    with open(os.path.join(OUT, "metrics.json"), "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2)
    print("\nmetrics -> svgout/metrics.json")


if __name__ == "__main__":
    main()
