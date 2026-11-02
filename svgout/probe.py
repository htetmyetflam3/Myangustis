"""Probe the PDFs: page count, text density, fonts, image count."""
import sys
import pymupdf

files = [
    "pdf-part/part-1.pdf",
    "pdf-part/part-2.pdf",
    "pdf-part/part-3.pdf",
    "pdf-part/part-4.pdf",
    "pdf-part/part-9.pdf",
    "pdf-parts/part-5.pdf",
    "pdf-parts/part-6.pdf",
    "pdf-parts/part-7.pdf",
    "pdf-parts/part-8.pdf",
]

for path in files:
    try:
        doc = pymupdf.open(path)
    except Exception as e:
        print(f"{path}: ERROR {e}")
        continue
    n = doc.page_count
    # sample up to the first 5 pages for text density
    rows = []
    for i in range(min(n, 5)):
        p = doc[i]
        txt = p.get_text("text")
        rows.append((i, len(txt.strip()), len(p.get_images(full=True))))
    doc.close()
    print(f"\n{path}  pages={n}")
    for i, chars, imgs in rows:
        print(f"   p{i:<3} chars={chars:<6} images={imgs}")
