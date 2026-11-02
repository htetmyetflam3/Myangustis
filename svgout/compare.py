"""Compare PDF render vs SVG render, pixel by pixel, and build a side-by-side."""
import os
from PIL import Image, ImageChops, ImageDraw, ImageFont

PAGES = [1, 3]
OUT = "svgout"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

for i in PAGES:
    a = Image.open(f"{OUT}/page-{i}-pdf.png").convert("RGB")
    b = Image.open(f"{OUT}/page-{i}-svg.png").convert("RGB")
    if a.size != b.size:
        b = b.resize(a.size, Image.LANCZOS)

    diff = ImageChops.difference(a, b).convert("L")
    hist = diff.histogram()
    total = a.size[0] * a.size[1]

    identical = hist[0]
    near = sum(hist[0:6])            # <=5 grey levels off
    visible = sum(hist[16:])         # >=16 off = clearly different pixel
    maxdiff = max(i for i, v in enumerate(hist) if v)

    print(f"page {i}: {a.size[0]}x{a.size[1]}")
    print(f"   identical pixels : {identical/total*100:6.3f}%")
    print(f"   near-identical   : {near/total*100:6.3f}%  (<=5/255 off)")
    print(f"   clearly diff     : {visible/total*100:6.3f}%  (>=16/255 off)")
    print(f"   max channel diff : {maxdiff}/255")

    # side-by-side, downscaled for viewing
    scale = 1100 / a.size[0]
    w, h = int(a.size[0] * scale), int(a.size[1] * scale)
    a_s = a.resize((w, h), Image.LANCZOS)
    b_s = b.resize((w, h), Image.LANCZOS)
    d_s = diff.resize((w, h), Image.LANCZOS).point(lambda v: 255 if v > 24 else 0)

    pad, bar = 16, 34
    canvas = Image.new("RGB", (w * 3 + pad * 4, h + bar + pad * 2), "#141414")
    draw = ImageDraw.Draw(canvas)
    try:
        f = ImageFont.truetype(FONT, 17)
    except Exception:
        f = ImageFont.load_default()

    for idx, (img, label) in enumerate([(a_s, "PDF page"), (b_s, "SVG vectorised"), (d_s, "pixel diff")]):
        x = pad + idx * (w + pad)
        canvas.paste(img, (x, bar + pad))
        draw.text((x + 4, 10), label, font=f, fill="#DDDDDD")

    canvas.save(f"{OUT}/compare-page-{i}.png")
    print(f"   -> {OUT}/compare-page-{i}.png  ({canvas.size[0]}x{canvas.size[1]})")
