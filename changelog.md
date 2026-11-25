# Changelog

## [1.0.0] - 2026-11-20

### Added
- A parser-chain test observes the covered PDF, DOCX and standalone OCR paths from instruction or extraction through finalization. It checks stage order and data flow without pinning exact output text. Automatic PDF OCR and embedded DOCX image OCR are excluded by request and remain follow-ups in `do.MD`.
- Historical Python SVG framing tools were restored as standalone helpers.

### Changed
- The parser uses a shared clean phase and a separate beautify stage. The no-rule decision is called `pass-through`; legacy ordering uses the identified code page.
- Parser notes describe the current chain, repair status and OCR follow-ups.

### Removed
- Python-versus-JavaScript comparison tests and tests requiring unavailable supplied fixtures. Renamed test files were retained.

### Test record
- Before removing comparison tests: parser discovery ran 293 tests, with 18 failures, 2 errors and 26 skips. The two errors were import-path setup issues; two failures were the OCR follow-ups now excluded from the chain guard.
- After the scope change: the chain guard passed 5 tests. Full parser discovery ran 291 tests, with 7 failing subcases and 4 skips; the failures concern DOCX font evidence and PDF page routing.
- Engine: 44 tests ran, 1 skipped. Shared tests: 15 ran, 1 skipped. Translation tests: 240 passed. Queue tests: 12 passed after removal of a test requiring an unavailable supplied font. Tools: 14 passed with `resvg-py` installed for the run.
- The 16-page `IMB Final.pdf` text extraction matched the saved baseline byte-for-byte.

## [Unreleased] - 2026-11-19

### Changed / Fixed / Removed
- Consolidated parser CLI execution in `B.Parser/main.py`, removed the duplicate `architecture/entry/cli.py` and its installed-script mapping, and routed the SVG PDF helper through the main entry point.
- Kept `uv run main.py prase`, local parsing, the default `Junk/Parser/pdf-parts/` input directory, and extension-based output file/directory handling.

### Test record
- Previous full-suite record: 661 cases, 612 passed, 48 skipped, and one error because `Junk/fonts/zawgyi one/ZAWGYI-ONE_V3.1.TTF` was absent.
- Current repository Python suites after merging `python`: 620 cases, 607 passed, 6 skipped, and 7 failing parser subcases. These are the existing DOCX font-evidence and PDF page-routing failures recorded above.
- The required parser-chain guard passed all 5 tests.

## [1.0.1] - 2026-11-25

### Added
- A resumable SSH PDF archive tool that stores original PDF bytes and relative filenames in a Parquet dataset without deleting remote files.

### Test record
- Parser-chain guard: 5 passed. Full parser discovery: 301 tests, 7 failing subcases and 4 skips; the DOCX font-evidence and PDF page-routing failures match the previous record above.
- Engine: 45 tests, 1 skipped. Translation: 240 passed. Scraper: 12 passed. Shared: 15 tests, 1 skipped. Tools: 22 passed, including 8 archive tests. The archive's SSH integration used a local fake SSH transport, not the actual hosting server.
