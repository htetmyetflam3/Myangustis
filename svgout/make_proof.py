"""Downscale the comparison images to JPEG so they are cheap to commit."""
import os
from PIL import Image

OUT = "svgout"
PROOF = "svgout/proof"

os.makedirs(PROOF, exist_ok=True)

JOBS = [
    ("compare-page-1.png", "compare-page-1.jpg", 1800),
    ("compare-page-3.png", "compare-page-3.jpg", 1800),
    ("zoom-page-1.png", "zoom-page-1.jpg", 1600),
    ("zoom-page-3.png", "zoom-page-3.jpg", 1600),
]

for src, dst, width in JOBS:
    img = Image.open(os.path.join(OUT, src)).convert("RGB")
    scale = width / img.width
    img = img.resize((width, int(img.height * scale)), Image.LANCZOS)
    img.save(os.path.join(PROOF, dst), "JPEG", quality=82, optimize=True)
    print(f"{dst}: {img.width}x{img.height}  {os.path.getsize(os.path.join(PROOF, dst))/1024:.0f} KiB")
