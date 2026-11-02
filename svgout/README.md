# PDF → SVG vectorisation test

Two pages from `pdf-parts/part-6.pdf` (a 85-page, A3-landscape Myanmar magazine
scan-with-text-layer), converted to SVG with every glyph emitted as a path.

## Result

| page | svg | paths | `<use>` | `<image>` | ink coverage vs PDF |
|---|---|---|---|---|---|
| 1 (magazine pp. 14–15) | `page-1.svg` 904 KB | 313 | 6,232 | 0 | 0.187% → 0.187% (ratio 1.0000) |
| 3 (magazine pp. 18–19) | `page-3.svg` 1.5 MB | — | — | 0 | 0.187% → 0.187% (ratio 1.0000) |

Fidelity after 1.2 px blur (removes anti-aliasing noise):

- mean channel difference **1.8 / 255**
- pixels off by more than 32/255: **0.005 %**

That is: geometry identical, only rasteriser anti-aliasing differs.

## Files

| file | what |
|---|---|
| `page-1.svg`, `page-3.svg` | the vector pages, text as outlines, self-contained |
| `proof/compare-page-*.jpg` | PDF \| SVG \| pixel-diff, side by side |
| `proof/zoom-page-*.jpg` | 2× crop, PDF vs SVG |
| `probe.py` | page count, text density, image count per page |
| `vectorize.py` | PDF → SVG (text as paths) + SVG → raster for checking |
| `compare.py` | pixel metrics + side-by-side sheet |
| `zoom.py` | 2× crop comparison |

## Regenerate

```bash
python -m venv .venv && .venv/bin/pip install pymupdf pillow
.venv/bin/python svgout/probe.py
.venv/bin/python svgout/vectorize.py
.venv/bin/python svgout/compare.py
.venv/bin/python svgout/zoom.py
.venv/bin/python svgout/make_proof.py
```

## Known gaps vs "exact vector like PDF"

1. **No text layer** — `text_as_path=True` emits outlines, so the SVG has no
   `<text>`; copy/search/accessibility are gone. 6,232 `<use>` elements reference
   glyph paths in `<defs>`.
2. **Raster images dropped** — this source has `images=0` on these pages, so
   nothing was lost here. Other pages in the file carry up to 78 embedded images;
   those would need `page.get_images()` extraction and re-embedding.
3. **Anti-aliasing differs by 7 % of pixels** at 150 dpi; the blur test shows it
   is rasteriser-only, not geometry.
