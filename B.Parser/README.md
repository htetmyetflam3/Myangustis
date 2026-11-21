# Parser

The parser extracts Myanmar text from PDF, DOCX, TXT, and image inputs. Its CLI
is `B.Parser/main.py`; Python imports are provided by the workspace package
`myangustis_parser`. It uses the Engine data in `A.Engine`.

## Install

From the repository root:

```sh
uv sync --package myangustis-parser
cd B.Parser
uv run main.py parse --help
```

The bundled parser maps are in `architecture/resources/maps_data/`. Set
`PRASER_MAP_DIR` only when using an external map directory; legacy PDF parsing
also needs `legacy-subset-profiles.json` there. Engine master and tree setup is
documented in [`A.Engine/README.md`](../A.Engine/README.md).

## Independent parser and OCR runner

Use `parse` for text extraction and `ocr` to OCR an entire input. `prase` is an
accepted alias for `parse`.

```sh
cd B.Parser

# Parse one PDF; output defaults to Junk/Parser/output/.
uv run main.py parse /input/book.pdf

# Parse a directory, preserving its nested paths.
uv run main.py parse /input/books /Parser/output/txt/

# OCR a local directory.
uv run main.py ocr /input/scans /Parser/output/ocr/

# Watch a local directory continuously in this terminal.
uv run main.py ocr /input/scans /Parser/output/ocr/ --continuous --foreground

# Run the configured remote text or OCR queue in this terminal.
uv run main.py parse --ssh --foreground
uv run main.py ocr --ssh --foreground
```

Local parsing without an input defaults to `Junk/Parser/pdf-parts/`; set
`PARSER_INPUT_DIR` to change it. OCR needs an input path or
`PARSER_OCR_INPUT_DIR`. A single input may be PDF, DOC/DOCX, TXT, or an image.
For TXT input, choose a `.docx` output. For batches, the output must be a
folder.

Inputs may be explicit paths or bare filenames; bare PDF and DOCX names are
looked up under `Junk/Parser/upload/`. Outputs default to
`Junk/Parser/output/{txt,docx,pdf}/`. Explicit output paths must be under the
repository's `Junk` directory or a directory configured in `.env`; the parser
refuses to overwrite an existing output. The CLI works from any current
working directory.

For a systemd host, `--service` explicitly installs a continuous worker.
Continuous runs started as root on a systemd host use the independent
`myangustis-parse.service` or `myangustis-ocr.service` unless `--foreground` is
specified. OCR requires Tesseract and Myanmar language data; PDF OCR renders
with PDFium before recognition.

## Remote queues

Configure `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_KEY`, and `SSH_DIR` in the
root `.env`. The text queue is the `REMOTE_PRASER_DIR` child of `SSH_DIR`
(default `convertable`); the OCR queue is `REMOTE_OCR_DIR` (default `scanned`).
Remote source files are read-only. Text parsing writes
`Junk/Parser/output/parquet/books.parquet` and
`Junk/Parser/output/txt/parsed-books.txt`; OCR writes a separate
`ocr-books.parquet`. The queues have separate state and locks.

## PDF diagnostics and encoding

To investigate a garbled PDF, enable `PARSER_LOG_ENABLED=on` and
`PARSER_DIAGNOSTICS=on` in the root `.env`, then parse a copy of the input.
Diagnostics report page-level counts and decisions, not full page text by
default. `PARSER_DIAGNOSTIC_SAMPLES=on` adds text excerpts; treat those logs as
private book content. Restart a service after changing its environment.

When a PDF contains known Zawgyi text but no usable font evidence, try
`--source-encoding zawgyi-one`. Unknown glyphs may remain visible as
placeholders; a successful parse does not guarantee readable text. PDF
passwords requiring a non-empty user password are not supported.

Paths in `.env` are project-root anchored: `/Junk/Parser/upload/` means the
repository's `Junk/Parser/upload/`. Use `~/path` or `abs:/path` for a host path.
See [`.env.example`](../.env.example) for parser settings.
