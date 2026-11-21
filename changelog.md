## [Unreleased] - 2026-11-19

## Changed / Fixed / Removed
- Consolidated parser CLI execution in `B.Parser/main.py`, removed the duplicate `architecture/entry/cli.py` and its installed-script mapping, and routed the SVG PDF helper through the main entry point.
- Kept `uv run main.py prase`, local parsing, the default `Junk/Parser/pdf-parts/` input directory, and extension-based output file/directory handling.
- Added bounded legacy-font probe accounting and privacy-preserving codepage diagnostics for unnamed faces.

## Verification
- Previous full-suite record: 661 cases, 612 passed, 48 skipped, and one error because `Junk/fonts/zawgyi one/ZAWGYI-ONE_V3.1.TTF` was absent.
- Current repository Python suites: 665 cases, 615 passed, 49 skipped, and one error in `test/scraper/test_continuous_parse.py::test_real_generated_zawgyi_font_pdf_both_outputs`, for the same absent font.
