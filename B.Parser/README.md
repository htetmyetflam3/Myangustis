# Parser

`architecture/` groups the parser by responsibility. The Python import name
remains `myangustis_parser`, so callers do not need to change:

- `entry/`: CLI, API, manager, JSON job contract and public `index`.
- `extract/`: PDF, font, DOCX and decryption handling.
- `normalize/`: encoding detection, Zawgyi conversion, cleanup and scanning.
- `workflow/`: parsing pipeline and OCR lane.
- `output/`: formatting and document writers.
- `resources/`: parser JSON maps, paths and in-process Engine data access.

Install from the repository workspace:

```sh
uv sync --package myangustis-parser
uv run --package myangustis-parser myangustis-parse --help
```

The parser reads its bundled maps from `resources/maps_data/`; set
`PRASER_MAP_DIR` to use an external directory. Plain JSON is read directly and
sealed JSON/master data is read through `myangustis_engine.secure_data` in the
same process. An external map directory must also include the bundled
`legacy-subset-profiles.json` when parsing legacy-font PDFs. Supply the Engine master, key and prebuilt trees as documented in
`A.Engine/README.md`. No Node engine-data bridge is used.

OCR uses the external Tesseract CLI; configure language data through
`PRASER_OCR_LANG_PATH`. PDF OCR renders the complete page with the installed
PDFium Python package at scale 3 (216 DPI) before recognition. The former
`PRASER_OCR_DPI` Poppler-fallback setting no longer changes PDF page OCR.
SVG helper scripts and their golden fixtures are in `tools/svg/`.

PDF decryption and object-stream expansion use the pure-Python `pypdf` library,
not the qpdf executable. Password-protected files requiring a non-empty user
password are not supported. Caller-specific input and page quotas are absent;
image-pixel, PDF stream and DOCX decompression safety limits still apply to all callers.

Unlabelled or mixed-encoding DOCX text can be ambiguous: Myanmar and Zawgyi
share code points. For known Zawgyi content without direct font evidence, use
`source_encoding="zawgyi-one"` (or `--source-encoding zawgyi-one`). OCR quality
depends on the scans and traineddata; no accuracy guarantee is implied.


## PDF lane decision log

Set `PARSER_LOG_ENABLED=on` in the repository-root `.env` (or process
environment) to append lane decisions to `B.Parser/logs/lane-decisions.log`.
The default is off; `PARSER_LOG_FILE` optionally selects another file path.
The continuous scraper service loads the root `.env` on the VPS. Restart the parser or combined service after changing it. The file is created with owner-only permissions when
new, and is ignored by Git. Manage its rotation and backups as needed.

Decision messages always go to the console's standard error (and thus the
service journal) even with file logging off. File write errors do not stop
parsing. The log contains the book filename and page numbers, not page text.

* **STEM lane-switch** is emitted only when the actual Myanmar text decoding
  changes between `unicode` and `legacy`, including a switch within a page;
  repeated characters in the same lane do not generate messages. The initial
  lane is not logged. Latin-only runs and unresolved codes are not reported.
* **BEAUTIFY decision** is emitted once for each consecutive page range using
  the same finishing decision, with one-based inclusive page numbers. Thus a
  whole 100-page book using `zawcode` produces one entry; pages 1–20 using
  `rabbit` (Zawgyi conversion) and 21–100 using `zawcode` produce two. A
  later switch back starts a new range. `aligned`/`legacy` indicate no
  ZawCode or Rabbit finishing conversion. These are actual parser decisions,
  not a guarantee that detection or conversion was correct.

A repeated parse creates new entries. The beautify range is emitted when it
ends or the page iterator closes; an abruptly terminated process may lose the
last pending range. Neither this file nor the console log is a per-page or
per-character dump.


## Independent parser and OCR runner

From `B.Parser`, use `uv run main.py parse ...` (`prase` is also accepted),
or `uv run main.py ocr ...`. These commands do not import the scraper. The
older one-file `main.py book.pdf --txt` form is also supported.

```sh
# A single file, with an explicit output under repository Junk:
uv run main.py parse /input/book.pdf Parser/output/docx/book.docx
# No output argument: use Junk/Parser/output/ and the source extension.
uv run main.py parse /input/book.pdf
# A folder runs a batch, retaining nested folder names. Output ending / is a directory.
uv run main.py ocr /input/scans Parser/output/ocr/
# Watch a local folder continuously (default source can be set in .env).
uv run main.py ocr /input/scans Parser/output/ocr/ --continuous
# Remote queue; output locations are fixed and no positional paths are allowed.
uv run main.py parse --ssh
uv run main.py ocr --ssh
```

For a single output path without an extension, the source extension is appended.
All explicit output paths must resolve inside the repository's `Junk` directory:
relative output paths are relative to `Junk`, and absolute paths outside it are
rejected. Input files are never deleted. Existing output files are not
intentionally overwritten. Set `PARSER_INPUT_DIR` or `PARSER_OCR_INPUT_DIR` in
root `.env` to provide a default local input when the input argument is omitted.

Continuous runs started as root on a systemd host install and start their own
`myangustis-parse.service` or `myangustis-ocr.service`. Add `--foreground` to
run in the current process instead, or `--service` to explicitly require a
systemd host. The service installer refuses to replace a running service and
never stops scraper or other units. Check `journalctl -u myangustis-parse.service
-f` (or `myangustis-ocr.service`). OCR requires Tesseract and Myanmar language
data; it is not started by the scraper or combined root service.

SSH uses `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_KEY`, `SSH_DIR` and the direct
child `REMOTE_PRASER_DIR` (default `convertable`) or `REMOTE_OCR_DIR` (default
`scanned`). Authentication is noninteractive, and the remote originals are never
modified. The text parser writes both:

- `Junk/Parser/output/parquet/books.parquet` — text and Engine segmentation.
- `Junk/Parser/output/txt/parsed-books.txt` — a single UTF-8 file of parsed
  text, with a `===== book name =====` heading for each book.

The OCR queue remains separate and writes `Junk/Parser/output/parquet/ocr-books.parquet`.
Progress and staging are under `Junk/Parser/state/ssh/parse/` and `ssh/ocr/`.
The collections require the Engine runtime, master and prebuilt trees. On its
next scan, the parser can backfill the combined TXT from books already in its
current SQLite ledger, without downloading them again. It also recovers
interrupted exports and refuses to replace an existing untracked TXT. Failed
local staging is retained; a file retained after an interrupted export is not
automatically removed during recovery. Downloads pause when less than 5 GiB is
free. The two modes have separate locks, ledgers and collections, so OCR does
not block parsing. The former
scraper-side collection and ledger are **not migrated automatically**: keep them
and plan a migration before removing them; the new queue may process the remote
files again. This new SSH workflow does not send email. VPS/systemd and actual
SSH deployment still need testing on the destination host.


## PDF decoding and existing SSH results

Normal PDF decoding builds page instructions and font verdicts at the stem
before reading page content, then follows those instructions using each font
resource's own ToUnicode, encoding and embedded cmap. It
does not merge glyph IDs or ToUnicode mappings across the book. Unknown codes
may remain visible as placeholders; this is not a guarantee of readable text.
PDF parsing follows the JS instruction and finishing path without the older
Python-only ZawCode draft probe. The old `text_layout="zawcode"` option and
`PRASER_ZAWCODE_DRAFT=on` now raise an error instead of changing the runtime
path; use automatic routing. Witnessed
visual glyph recovery uses contradictory resource-local mappings plus exact
embedded-outline evidence; changed or unresolved recovery is flagged for
review. Known differences remain: Python still reads the PDF and page content
into memory rather than using JS's file-backed object/page spools. Placed-image
coverage is exposed in PDF page layout records. PDF OCR now renders the whole
page as JS does, but Python uses PDFium and the Tesseract CLI while JS uses
PDF.js/canvas and Tesseract.js, so rasterization and recognition can differ.
Python page and stream limits also apply to workers, whereas JS owner workers
can be uncapped. Python's preview reports still include precomputed PDF clean
text, whereas the JS `parseDecoding` PDF reports use a null `clean` value.

For image pages with fewer than eight trimmed UTF-16 characters, the pinned JS
runtime invokes OCR but its final markup prefers existing extracted lines. As a
result, a page with a short existing line can output that line instead of a
successful OCR reading; Python now mirrors this behavior. `ocrPages` records
successful recognition, not a guarantee that its text became the final output.
Complete JS parity and the accuracy of particular books still need validation
against real source pages.

The parser tests include deterministic differential checks against the JS
font decoder, GSUB logic, witnessed visual recovery, PDF finishing and
end-to-end synthetic PDF pages at main commit `67f02845bcd266ff764fcc167a3337626eb1c75f`.
These checks run Node only as a **test oracle**, never as part of the Python
parser. They skip when Node or the pinned Git commit is unavailable (the
font-decoder, visual and PDF checks require Node 22+). They cover synthetic
cases and two bundled witness fonts, not every PDF or all parser behavior.
Update the pinned reference deliberately when reviewing a newer JS version;
a passing test is not proof of full parity. The optional PDF renderer
comparison additionally needs `pdfjs-dist@6.4.299` and
`@napi-rs/canvas@1.0.10` in an external Node modules directory, supplied via
`JS_RENDER_NODE_MODULES`. It compares geometry and solid-color fixtures;
PDFium and PDF.js can rasterize real documents differently.

Previously committed SSH queue entries are not automatically re-parsed after
an upgrade. Deleting `books.parquet` alone does not restart the queue: it is
rebuilt from `Junk/Parser/state/ssh/parse/books.sqlite3`. Deleting the ledger
and Parquet while leaving the old combined TXT also does not restart it: the
new empty ledger refuses to overwrite that untracked TXT.

To deliberately start a fresh parser collection, after checking the new
parser on representative source pages:

1. Stop every process that can run this parser queue: the independent parser
   service, the combined service if used, and any foreground parser. Stopping
   the combined service also stops its scraper child. Do not stop OCR solely
   for this reset.
2. Preserve the entire `Junk/Parser/state/ssh/parse/` directory (including
   SQLite WAL files and staged inputs), `Junk/Parser/output/parquet/books.parquet`
   and `Junk/Parser/output/txt/parsed-books.txt` together in a new backup
   location. Keep the remote originals unchanged. Archiving these paths out of
   their active locations is safer than deleting the only copy.
3. Start the parser again. It creates a fresh ledger and outputs and scans the
   PDFs currently available in the configured remote queue. Missing remote
   sources cannot be reconstructed from the new queue. Compare the new output
   with the preserved collection before deciding whether to discard the backup.

The OCR queue and scraper state are separate; leave them untouched. The queue
has no built-in versioned reprocessing command and its reading quality is not
validated merely by a successful run.
