# B.Parser — Python parser

A **standalone** Burmese document parser: PDF/DOCX/images in, clean `.txt` /
`.docx` / `.pdf` out. It is the Python implementation of the same job the
JavaScript parser under `B.Parser/` does, and it has its own OCR lane.

It is not a client of the JavaScript parser. The JavaScript *parser* is never
imported or started from here; the two implementations are peers that share
**data only**. The one JavaScript process this tree may start is the **engine
data bridge** (`Architecture/Engine`, via `tools-box/js/engine-data.js`), which
owns the dictionary/master — that is the engine's data, and re-implementing it
in Python would fork it.

## Run it

```python
import sys
sys.path.insert(0, "B.Parser/Python")      # the tree is flat, like the JS dir
from index import convert

convert("input.pdf", "output.docx")        # the Python twin of B.Parser/index.js
convert("scan.jpg", "scan.txt")            # OCR lane: one page of text
```

```sh
# convert from the command line
python3 B.Parser/Python/modules/prase.py input.pdf output.docx --cleanup yes

# body text only
python3 B.Parser/Python/modules/prase.py input.pdf --content

# OCR controls
python3 B.Parser/Python/modules/prase.py scan.pdf scan.txt          # OCR on by default
python3 B.Parser/Python/modules/prase.py scan.pdf scan.txt --no-ocr # leave image pages empty

# JSON job in / JSON result out (cross-parser contract)
python3 B.Parser/Python/modules/prase.py --job request.json --response response.json

# HTTP API
python3 B.Parser/Python/modules/prase.py --serve --port 5000
```

### Dependencies

| what | when | note |
|---|---|---|
| `fpdf2`, `flask` | PDF output, API | `B.Parser/pyproject.toml` |
| `tesseract` CLI | OCR only | optional; without it the parser logs one line and text lanes are unaffected |
| `pdftoppm` (poppler) | OCR fallback | only when a page image cannot be decoded natively |
| Node + engine data | dictionary/master data | the engine is JavaScript by design |

The bundled model `B.Parser/prised/@core/ocr/model/mya.traineddata` is shared
by both parsers; set `PRASER_TESSERACT_BIN`, `PRASER_OCR_LANG`,
`PRASER_TESSERACT_DIR`/`PRASER_TESSDATA_DIR` to point at another install.

## How it is put together

| file | role |
|---|---|
| `index.py` | public front door: `convert`, `parse_decoding`, `write_output_file` |
| `modules/prase.py` | command-line entry point |
| `modules/cli.py` | command line, `--job` JSON mode, `--no-ocr` |
| `modules/api.py` | Flask API for the site |
| `modules/manager.py` | executor: parse -> OCR -> write |
| `modules/pipeline.py` | detect -> convert -> clean, per page, streaming |
| `modules/ocr.py` | OCR lane: Tesseract CLI, native page-image extraction |
| `modules/pdf_extract.py` | PDF lexing, fonts/CMaps, raster image extraction |
| `modules/docx_extract.py` | DOCX text + embedded pictures (OCR markers) |
| `modules/render.py`, `fonts.py` | `.txt` / markup `.docx` / `.pdf` writers |
| `modules/rabbit.py`, `cleanup.py`, `legacy_order.py`, `mm_score.py` | Zawgyi conversion, imposter cleanup, mark order |
| `modules/judgement.py` | lane judgement: English evidence, page evidence, lane selection (mirror of `@rule/judgement.js`) |
| `modules/unicode_evidence.py` | regional (Mon/extended) runs preserved around ordering/cleanup |
| `modules/markup.py` | the marked-up page string: writer and reader halves |
| `modules/font_names.py` | legacy font-name registry (`@jason-map/legacy-font-names.json`) |
| `modules/limits.py` | input/page/text/DOCX caps (`@entry/helper/limit.js`) |
| `modules/scan.py` | structural damage scan for parsed text |
| `modules/engine.py` | **engine bridge** — dictionary/master via the JS engine child |
| `modules/maps.py` | JSON map resolver (`@jason-map`) |
| `modules/interop.py` | JSON job/result contract |
| `modules/paths.py` | fonts, output dir — Python mirror of `_path.js` |

## OCR lane

Mirrors `B.Parser/prised/@core/ocr/ocr.js`:

| input | behaviour |
|---|---|
| image-only PDF page | OCR'd when the page carries an image **and** has fewer than 8 characters of extractable text; a page with real text is never touched |
| page pixels | the page's own image XObject is extracted (DCT/JPX pass through untouched; Flate samples are wrapped as PPM/PGM) — **no re-render**, so a scan is not resampled and blurred before recognition |
| unreadable page image | `pdftoppm` renders just that page, if poppler is installed |
| DOCX picture | extracted to a scratch dir, OCR'd, and its private marker replaced with the text; the marker is removed if OCR is off or fails |
| bare image file | the whole input is one page of OCR text |

Limits and switches: `PRASER_MAX_OCR_PAGES` (default 50), `LOCAL_MAX_OCR_PIXELS`
(default 25,000,000), `PRASER_OCR=off`/`--no-ocr`, `PRASER_OCR_LANG`,
`PRASER_OCR_DPI` (poppler fallback), `PRASER_OCR_TIMEOUT_SECONDS`.

Result field: `ocrPages` lists the 1-based PDF pages (or DOCX image ids) whose
text came from OCR.

## The integration rule

Between JavaScript and Python there is **one** surface for shared behaviour: JSON.

1. **Maps** — `B.Parser/@jason-map/*.json`. Both parsers read the same files.
   If Python needs a new table, it belongs in JSON; never add a `.js` import.
2. **Engine data** — the dictionary/master is JavaScript-owned. Python asks the
   engine as a child process (`node tools-box/js/engine-data.js …`, see
   `modules/engine.py`); it does not decrypt or validate the master itself.
3. **Jobs** — `modules/interop.py` reads a job JSON and writes a result JSON
   with the same field names the JavaScript Manager uses, so one caller can
   drive either parser without a translation layer.

```
JavaScript parser  ──reads──▶  @jason-map/*.json  ◀──reads──  Python parser
        │                            ▲
        └──── job/result JSON ───────┘        (a file exchange, not a call)

Python parser ──child process──▶ Architecture/Engine (dictionary/master data)
```

The JavaScript parser and the Python parser never call each other. The engine
call is data, not parsing.

## Tests

```sh
# frame-builder parity: Python output vs the JSON golden emitted once by JS
python3 B.Parser/Python/test_frame_parity.py

# OCR lane: runs with a stub Tesseract, so no engine install is needed
python3 B.Parser/Python/test_ocr.py

# rule ports: judgement, markup, font names, limits (no JS runtime needed)
python3 B.Parser/Python/test_mirror.py
```

The writers follow the JS design: pages leave parsing as **marked-up
strings** (`<b>`, `<i>`, `<h1>`, `<h2>`, `\n`, `\n\n`) and the writers render
those blocks. The old exact-layout DOCX writer is still available with
`PRASER_DOCX_LAYOUT=1` when reproducing the source page matters more than
matching the JS document shape.

`fixtures/frame-parity/` holds the input page and the golden SVGs; regeneration
instructions are in `fixtures/frame-parity/README.md`.

## Rules that must not be undone

- Python must stay runnable without the JavaScript parser installed.
- No Python module may import a `.js` file, and no `subprocess` call may start
  the JavaScript parser. Starting the **engine** data bridge is allowed and
  expected.
- Shared parser behaviour changes go into JSON (or into both implementations),
  never into a cross-parser call.
