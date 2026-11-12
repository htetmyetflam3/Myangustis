# Continuous OCR

The Python service uses the Parser's Tesseract OCR, shared finishing and
Engine POS scan. It has no separate dictionary or vector repair. Configure
`PRASER_OCR_LANG_PATH` or system tessdata for Myanmar; Poppler (`pdftoppm`)
may be needed for PDF pages without a directly extractable image.

Configure Engine master/key and prebuilt trees per `A.Engine/README.md`, then
run `uv run ocr.py` from `D.Scraper/run` on the systemd VPS. The service pulls
scanned PDFs read-only from SSH, retains local inputs on failure, and commits
finished text and native Engine segmentation into the existing Parquet.

Local validation covered real Myanmar Tesseract, SSH, Parquet commit/recovery,
and systemd unit syntax. Production VPS configuration, throughput and OCR
accuracy on the actual collection still need deployment validation; the old
JavaScript overlay verification does not apply.
