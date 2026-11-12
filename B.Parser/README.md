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
