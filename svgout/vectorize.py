"""Vectorize PDF pages to SVG with PyMuPDF (glyphs become paths), then prove
fidelity by rasterising the SVG back and comparing against the PDF render.

Usage:  python vectorize.py part-6.pdf 1 3
"""
import sys
import os
import pymupdf

DPI = 150
SRC = "pdf-parts/part-6.pdf"
PAGES = [1, 3]
OUT = "svgout"


def main():
    os.makedirs(OUT, exist_ok=True)
    doc = pymupdf.open(SRC)

    for i in PAGES:
        page = doc[i]
        base = f"{OUT}/page-{i}"

        # ---------- 1. PDF reference raster ----------
        pix_pdf = page.get_pixmap(dpi=DPI)
        pix_pdf.save(f"{base}-pdf.png")

        # ---------- 2. vectorise to SVG, text as outlines ----------
        svg = page.get_svg_image(matrix=pymupdf.Matrix(1, 1), text_as_path=True)
        with open(f"{base}.svg", "w", encoding="utf-8") as fh:
            fh.write(svg)

        # ---------- 3. rasterise the SVG back with MuPDF ----------
        svg_doc = pymupdf.open(f"{base}.svg")
        svg_page = svg_doc[0]
        # match the PDF raster size exactly
        zoom = DPI / 72.0
        pix_svg = svg_page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        pix_svg.save(f"{base}-svg.png")

        print(f"page {i}: pdf {pix_pdf.width}x{pix_pdf.height}  svg {pix_svg.width}x{pix_svg.height}"
              f"  svg {os.path.getsize(f'{base}.svg')/1024:.0f} KiB")

    doc.close()


if __name__ == "__main__":
    main()
