# PDF → SVG vectorisation

Two things live here, with different status.

| | |
|---|---|
| **the frame** — four equally spaced rules per line, one SVG per line or per sheet | **final** |
| `trace_raster.py` — photo of ink → stroke geometry | **experimental, OCR lane only** |

The reasoning, the traceback of the vector lane already on `main`, the
keep/update/retire list for the voting and matching rules, and the lane verdict
this feeds are all in [`../AGENT-NOTE-vector-svg.md`](../AGENT-NOTE-vector-svg.md).

## The frame

`E = size / 2`. Four equally spaced rules with the baseline on the third:

```
r1 = b - 2E      r2 = b - E      r3 = b      r4 = b + E
```

Canvas width is locked to the page width so any two sheets overlay; coordinates
stay in page space; `<defs>` is shared per sheet. The constant comes from
Myanmar3's ink (`ိ` 0.9389 em above, `ု` 0.4000 em below), not from a font file
at runtime.

### Two languages, one behaviour

The parser exists in JS and Python, so the frame does too. Each is standalone —
neither shells out to the other.

| | JS | Python |
|---|---|---|
| frame | `scan-frame.js` | `scan_frame.py` |
| runner | `make-line.js` | `make_line.py` |

They are byte-identical, not merely equivalent. `toFixed` and `.2f` disagree on
ties, and `String(12.0)` vs `str(12.0)` disagree on integral floats, so both
sides route every number through `fixed()` and `num()`.

```bash
python3 svgout/test_frame_parity.py     # must print N/N byte-identical
```

## Usage

The runner reads a page exported from the original content stream, not the
parser's text, so every outline is the page's own.

```bash
# whole page -> SVG + the page's line boundaries (needs pymupdf + pillow)
python3 svgout/pdf2svg.py --file book.pdf --pages 14
#   writes page-14.svg  and  page-14.lines.json

# same input, either language, same bytes out
node    svgout/make-line.js page-14.svg 14 "" 1-8
python3 svgout/make_line.py page-14.svg 14 "" 1-8
```

`pdf2svg.py` writes a companion `*.lines.json`: one row per baseline, taken from
the PDF's own text layer — `[x, baseline, size, text]`, with several text-layer
lines merged when they share a baseline. The runner uses it as the authority for
where lines start and end, so no baseline tolerance is guessed. Without it the
runner still works but warns and falls back to grouping glyphs by a baseline
tolerance, which merges real lines on pages whose sub-headings interleave with
the body.

Arguments: `<page-svg> <seed> <suffix> <lines>`.

- `seed` picks the random line for the single-line sample
- `suffix` is appended to the output name, so both languages can run without
  overwriting each other
- `lines` selects which lines go on the sheet: `1-8`, `1,3,5`, or empty for all

Outputs `line-sample*.svg` (one random line, page-width canvas) and
`frame-sheet*.svg` (the selected lines, one sheet, page-space coordinates).

The four rules come from the line's own size: `E = size/2`, rules at
`b-2E, b-E, b, b+E`. Size is read per glyph from the page export — the glyph
matrices are in em units, so their scale factor is the font size in points, and
a page that mixes 11 pt and 12.96 pt is framed correctly line by line.

`BAND = 0.5` is a **floor**, not the whole answer. Each line's own outlines are
measured and the band is raised only where the ink needs it, so a page the
calibration did not cover still frames correctly instead of reporting a fit
failure. `E` for that line is then `size * band`. The four rules stay equally
spaced — only the spacing scales.

`pitch` is the page's modal baseline gap, and it is reported as `— (not
uniform)` when the page has none: a signature block stacks names 0.4 to 1.9 pt
apart, and a number there would be invented. `data-pitch` is omitted in that
case rather than written as `0`.

Rules are drawn inset by half their stroke, so the round cap sits inside the
canvas instead of being cut off by its edge. The canvas stays exactly page
width, so sheets still overlay.

Every output carries the frame in its own attributes, so a consumer never has
to recompute it:

```
data-rules="394.99,401.47,407.95,414.43"  data-E="6.480"
data-size="12.96"  data-pitch="30.12"  data-blank="10.68"
```

## In the parser

```js
import { framesOf, pitchOf, overflow, lineSvg, sheetSvg } from "./scan-frame.js";
import { PdfPagePieces } from "../read/pdf-page-pieces.js";

const pieces = new PdfPagePieces(dir);
// ... pieces.add(...) / pieces.finish(...)
const frames = framesOf(pieces.lines());   // [x, y, size, text] -> frames
const pitch  = pitchOf(frames);            // from the PDF, never assumed
```

`overflow(frame, uses)` reports whether a row's ink stays inside its four rules,
using the page's own outlines — no font file needed.

## Measured

Page 14 of the representative PDF, 595.32 × 841.92 pt, at 200 dpi:

| metric | value |
|---|---|
| ink, PDF → SVG | 4.395 % → 4.438 % (ratio 1.0096) |
| IoU | 87.58 % |
| identical pixels | 95.87 % |
| blurred mean difference | 1.03 / 255 |
| pixels off by > 32 | 0.1316 % |
| SVG size | 361 KB (1482 `<use>`, 113 `<def>`) |
| PNG at the same visual weight | 372 KB @ 200 dpi |
| lines inside their rules | 22 / 22 |

After one page export, slicing a line costs 0.1–0.6 ms. Def sharing across
13 lines saves 83 %.

## Known limits

- The frame is calibrated for **Burmese text faces + Latin**. 79 of the 104
  Unicode faces in `Junk/fonts` fit at `E = 0.5 em`; the worst real shaped text
  needs 0.582 em. `E = 0.6 em` would cover the corpus but costs 0.2 em of blank
  per line.
- **Latin capitals set the frame when a page mixes scripts**: at the same size
  a Latin cap is ~8.2 pt against a Burmese base letter ~6.65 pt at 12.96 pt.
- `pdf2svg.py` is the only Python dependency left in the JS path. It can be
  ported to `pdfjs-dist` `getOperatorList`; until then JS needs the export.
