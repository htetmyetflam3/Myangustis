"""Zoomed crop comparison: same region of PDF render and SVG render at 2x."""
from PIL import Image, ImageDraw, ImageFont

OUT = "svgout"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# region of the page (x, y, w, h) in the 150 dpi raster
CROPS = {
    1: (150, 260, 700, 260),
    3: (150, 300, 700, 260),
}

for page, (x, y, w, h) in CROPS.items():
    a = Image.open(f"{OUT}/page-{page}-pdf.png").convert("RGB").crop((x, y, x + w, y + h))
    b = Image.open(f"{OUT}/page-{page}-svg.png").convert("RGB").crop((x, y, x + w, y + h))

    z = 2
    a = a.resize((w * z, h * z), Image.LANCZOS)
    b = b.resize((w * z, h * z), Image.LANCZOS)

    pad, bar = 14, 32
    canvas = Image.new("RGB", (w * z * 2 + pad * 3, h * z + bar + pad * 2), "#141414")
    draw = ImageDraw.Draw(canvas)
    try:
        f = ImageFont.truetype(FONT, 16)
    except Exception:
        f = ImageFont.load_default()

    canvas.paste(a, (pad, bar + pad))
    canvas.paste(b, (pad * 2 + w * z, bar + pad))
    draw.text((pad + 2, 9), "PDF", font=f, fill="#DDD")
    draw.text((pad * 2 + w * z + 2, 9), "SVG", font=f, fill="#DDD")
    canvas.save(f"{OUT}/zoom-page-{page}.png")
    print(f"page {page}: {OUT}/zoom-page-{page}.png  {canvas.size}")
