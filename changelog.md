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
- Follow-up: PDFs are grouped into bounded Parquet shards instead of one file per PDF. Eleven archive tests passed, including signal interruption, recovery and byte-for-byte round trips using a local fake SSH transport.
- Follow-up: the archive consolidates the original one-PDF Parquet files without downloading them again, verifies each row before removing its old shard, uses a recoverable append journal, and caps each Parquet file at 25 GB. Sixteen archive tests passed, including migration of 210 shards and interrupted/disk-full recovery; real SSH remains untested.

## [1.0.2] - 2026-11-25

### Changed
- Consolidate the original single-PDF Parquet shards into files of at most 25 GB without re-downloading already archived PDFs; verify each copy before deleting its old shard and journal appends for recovery.
- Add a read-only remote PDF count and stop when there is not enough space to safely append.

### Test record
- Parser-chain guard: 5 passed. Parser discovery: 301 tests, with 7 failing DOCX font-evidence and PDF page-routing subcases and 4 skips, matching the previous record.
- Engine: 45 tests, 1 skipped. Translation: 240 passed. Scraper: 12 passed. Shared: 15 tests, 1 skipped. Tools: 30 passed, including 16 archive tests.
- Archive tests include 210-shard migration, recovery, disk-full handling, and a fake SSH transport. The actual hosting server was not tested.

## [1.0.3] - 2026-11-25

### Changed
- Simplify the SSH PDF archive to start a fresh dataset with PDF bytes and filenames as Parquet rows, rolling over at 25 GB. Preserve interrupted progress and skip PDFs already saved in this new archive.
- Remove old-archive consolidation and the count option; no Hugging Face upload is performed. The new default output is separate from the earlier archive.

### Test record
- Parser-chain guard: 5 passed. Parser discovery: 301 tests, 7 previously recorded failing DOCX font-evidence and PDF page-routing subcases, 4 skipped.
- Engine: 45 tests, 1 skipped. Translation: 240 passed. Scraper: 12 passed. Shared: 15 tests, 1 skipped. Tools: 28 passed, including 14 archive tests.
- Archive tests cover Ctrl+C, journal recovery, disk-full handling, byte-for-byte Parquet contents and fake SSH. The actual shared-host SSH connection was not tested.
