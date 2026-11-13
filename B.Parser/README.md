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
same process. Supply the Engine master, key and prebuilt trees as documented in
`A.Engine/README.md`. No Node engine-data bridge is used.

OCR uses the external Tesseract CLI (and may need Poppler for PDF page
rendering); configure language data through `PRASER_OCR_LANG_PATH`. SVG helper
scripts and their golden fixtures are in `tools/svg/`.

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
  ZawCode or Rabbit finishing conversion; `zawcode-draft` indicates the
  font-scoped draft ordering used during extraction. A `+rabbit` suffix means
  both draft ordering and Rabbit were applied. These are actual parser
  decisions, not a guarantee that detection or conversion was correct.

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
# Remote queue, always Parquet; no input/output positional arguments allowed.
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
modified. All SSH output is `Junk/Parser/output/parquet/books.parquet` for parsing and
`ocr-books.parquet` for OCR, with separate progress and local staging under
`Junk/Parser/state/ssh/parse/` and `Junk/Parser/state/ssh/ocr/`. The collections contain text and
Engine segmentation, and requires the Engine runtime, master and prebuilt trees.
An interrupted Parquet export is rebuilt from its SQLite ledger; failed local
staging is retained. Downloads pause when less than 5 GiB is free. The two modes have separate
locks, ledgers and collections, so OCR does not block parsing. The former
scraper-side collection and ledger are **not migrated automatically**: keep them
and plan a migration before removing them; the new queue may process the remote
files again. This new SSH workflow does not send email. VPS/systemd and actual
SSH deployment still need testing on the destination host.
