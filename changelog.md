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
