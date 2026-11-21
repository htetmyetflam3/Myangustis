# Parser

`architecture/` groups the parser by responsibility. The Python import name
remains `myangustis_parser`, so callers do not need to change:

- `entry/`: API, manager, JSON job contract and public `index`.
- `extract/`: PDF, font, DOCX and decryption handling.
- `normalize/`: encoding detection, Zawgyi conversion, cleanup and scanning.
- `workflow/`: parsing pipeline and OCR lane.
- `output/`: formatting and document writers.
- `resources/`: parser JSON maps, paths and in-process Engine data access.

Install from the repository workspace, then run the parser through its single entry point in `B.Parser`:

```sh
uv sync --package myangustis-parser
cd B.Parser
uv run main.py prase --help
```

The parser reads its bundled maps from `resources/maps_data/`; set
`PRASER_MAP_DIR` to use an external directory (see [Path anchoring](#path-anchoring)). Plain JSON is read directly and
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


## Path anchoring

Every path read from the root `.env` is anchored to the **project root**, never
to the filesystem root. A leading `/` or `./` means the checkout, so these
values work as written:

```ini
PARSER_LOG_ENABLED=on
PARSER_LOG_FILE=/log/                    # <repo>/log/lane-decisions.log
PARSER_INPUT_DIR=/Junk/Parser/upload/    # <repo>/Junk/Parser/upload
PRASER_UPLOAD_DIR=./upload/              # <repo>/Junk/upload
PRASER_OUTPUT_DIR=/output/               # <repo>/Junk/output
```

The rule, applied to `PARSER_INPUT_DIR`, `PARSER_OCR_INPUT_DIR`,
`PRASER_UPLOAD_DIR`, `PRASER_OUTPUT_DIR`, `PARSER_LOG_FILE`, `PRASER_MAP_DIR`,
`PRASER_FONT_DIR`, `PRASER_OUTPUT_FONT_DIR`, `PRASER_OCR_LANG_PATH`,
`PRASER_TESSDATA_DIR`, `PRASER_TESSERACT_BIN` and `SSH_KEY`:

| value | resolves to |
| --- | --- |
| `""` | the built-in default |
| `~/parser` | the user's home directory |
| `abs:/srv/parser`, `file:/srv/parser` | that host path, exactly |
| `C:\Parser\out` | that Windows path, exactly |
| `output`, `./output/`, `/output/` | `<repo>/Junk/output` for input/output, `<repo>/output` for logs and maps |
| `Junk/Parser/upload`, `/Junk/Parser/upload/` | `<repo>/Junk/Parser/upload` |
| `/tmp/out` (an existing host directory) | `/tmp/out` — a deployment location is honoured |

A value that would resolve against `/` is treated as a project path instead, so
nothing silently reads or writes outside the checkout. `PARSER_INPUT_DIR` and
`PARSER_OCR_INPUT_DIR` accept a file or a folder; a value ending with `/` is a
folder, and `PARSER_LOG_FILE` ending with `/` (or naming an existing directory)
puts `lane-decisions.log` inside it. `PRASER_PATH_ROOT` moves the anchor for
every setting at once. `SSH_DIR` and the `REMOTE_*` queue folders are paths on
the remote host and are deliberately not anchored locally.

The same rule is used by the shared loader `index-path.py`, so importing the
parser as a library reads the root `.env` too — the parser is not isolated from
the workspace configuration.


## PDF lane decision log

Set `PARSER_LOG_ENABLED=on` in the repository-root `.env` (or process
environment) to append lane decisions to `B.Parser/logs/lane-decisions.log`.
The default is off; `PARSER_LOG_FILE` optionally selects another file path,
anchored to the project root as described above.
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
last pending range. Without diagnostics, the lane log is not a per-page dump;
opt-in diagnostics add page-level counts and probe evidence, never a character
stream by default.


### Diagnosing garbled PDF text

For a fresh parse of an affected PDF, set these in the root `.env` and restart
the parser/combined service:

```sh
PARSER_DIAGNOSTICS=on
PARSER_LOG_ENABLED=on
# Optional: PARSER_LOG_FILE=/path/to/private/parser.log
# Optional, sensitive: PARSER_DIAGNOSTIC_SAMPLES=on
```

Diagnostics are off by default. When enabled, `PDFDIAG page` records one event
per page (one-based) in stderr/service journal and, if file logging is enabled,
the same log file as lane decisions. Existing file permissions are not changed;
protect and rotate both the log and journal. This can create substantial logs
for large books. The SSH queue skips already processed books; test a copy with
the local parser or reset/back up queue outputs and state together before
reprocessing. Do not delete production output merely to collect diagnostics.

Each page records the chosen decoding lane and reason, actual finishing rule,
category, cleanup setting, image flag and warning codes. When an unnamed legacy
font is probed, the file also gets a `[PDFDIAG] codepage` event for each attempt;
it includes per-candidate marks/scores and asked/used/failed page counts. This
event is file-only and requires both `PARSER_DIAGNOSTICS=on` and
`PARSER_LOG_ENABLED=on`. It never includes decoded sample strings or exception
messages; the separate sensitive `PARSER_DIAGNOSTIC_SAMPLES=on` option can still
add page-stage samples to the verbose page event. `extraction.fonts` contains up
to 12 resource entries plus an `<other>` aggregate: base font,
subtype, CID flag, ToUnicode/embedded glyph-map entry counts, encoding and
legacy/visual flags, input bytes, runs, decoded characters, Myanmar characters,
single-character runs, and exact unmapped-code, fallback-byte and dropped-control
counts. A fallback byte can be normal for a simple Latin font; an unmapped code
means this decoder emitted a hex placeholder, not necessarily why its map failed.
Counters for `<unset>` use its separate fallback decoder. Resource facts for
`<other>` describe only the first merged resource. `adjacent_duplicate_runs`
counts identical consecutive decoded runs of 4–512 characters; legitimate
repetition is possible. Piece counts and characters before/after overprint
removal help identify layout loss; decoded counts are before piece assembly,
visual recovery, ordering and layout, and are not directly comparable one to
one with final text. Some fonts may have inaccurate maps without any unmapped
codes. These are clues, not correctness scores.

`layout`, `finished`, `base`, `clean` and `stream_output` contain character/line counts,
Myanmar and replacement-character counts, single-character and consecutive
identical line counts, and `[HEX]`-looking pattern counts (which can be literal
text). The change flags show which finishing stages changed the page; `clean`
is a candidate even when cleanup is off, while `stream_output` is the text
selected by the streaming step. The CLI/SSH byte-based job initially selects
base there but later exports `clean`; OCR-supplied pages may be replaced later.
Compare symptoms stage by stage: if decoded runs already contain
unmapped codes or an opt-in decoded sample is wrong, investigate font mapping;
if runs look reasonable but layout breaks or repeats them, investigate assembly
and positioning; if layout looks right but finished/base/clean differ, inspect
the indicated conversion or cleanup. For SSH parse, a separate book-level
`PDFDIAG segmentation` event compares exported `text` with `segmented`. The TXT
collection and Parquet `text` contain the former, not the segmented field.

By default diagnostics contain no page text or raw bytes, but filenames, font
names and statistics may still be sensitive. Only if explicitly enabled,
`PARSER_DIAGNOSTIC_SAMPLES=on` adds the first **160 characters per page per
stage**, including pre-layout decoded runs, to both sinks; samples may contain
private or copyrighted book content. Turn it off and handle/delete collected
logs appropriately. A sample of the beginning of a page may miss a defect
elsewhere; share an affected PDF, its page number, relevant logs and PDF.js
output (if permissible) to verify the cause. These diagnostics do not make this
parser PDF.js or prove that the extraction problem is fixed.


## Independent parser and OCR runner

From `B.Parser`, use `uv run main.py prase ...` (or `parse`; both names select
local parsing), or `uv run main.py ocr ...`. These commands do not import the
scraper. The older one-file `main.py book.pdf --txt` form is also supported.

```sh
# With no input path, parse the local PDF parts folder by default.
uv run main.py prase
# A single file, writing an explicit output file under repository Junk:
uv run main.py prase /input/book.pdf Parser/output/txt/book.txt
# A second argument without an extension is an output directory.
uv run main.py prase /input/book.pdf Parser/output/txt
# No output argument: use Junk/Parser/output/ and the source extension.
uv run main.py prase /input/book.pdf
# A folder runs a batch and retains nested paths; its output must be a directory.
uv run main.py ocr /input/scans Parser/output/ocr
# Watch a local folder continuously.
uv run main.py ocr /input/scans Parser/output/ocr --continuous
# Remote queue; output locations are fixed and no positional paths are allowed.
uv run main.py parse --ssh
uv run main.py ocr --ssh
```

The no-input local parse defaults to `Junk/Parser/pdf-parts/`; `PARSER_INPUT_DIR`
in root `.env` can override it. OCR uses `PARSER_OCR_INPUT_DIR` when its input is
omitted. A second positional output path with no extension is treated as a
folder; a supported `.txt`, `.docx`, or `.pdf` extension makes it an exact file
path. For a batch, the second argument must be a folder. All explicit output
paths must resolve inside the repository's `Junk` directory (or the
upload/output directory set in `.env`): relative output paths are relative to
`Junk`, a leading slash is still a project path (`/Parser/output/txt/` is
`Junk/Parser/output/txt/`), and paths outside those directories are rejected.
Input paths follow the same anchoring, and a bare filename is looked up in
`Junk/Parser/upload/pdf/` or `upload/docx/`. Input files are never deleted.
Existing output files are not intentionally overwritten. The CLI works from
any current working directory.

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
against real source pages. A file-by-file scope and evidence inventory is in
[`AUDIT.md`](AUDIT.md).

For DOCX, unknown-font text is left in its stored order and direct bold/italic
run marks are retained, and the DOCX conversion keeps working on Zawgyi and on
explicitly Unicode input.

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
