# Scraper engine integration

`architecture/result/text_collect.py` segments through the in-process Python
Engine; `pdf_classify.py` routes image-only PDFs to OCR and leaves all other PDFs to the Python Parser. Configure the external
master, key and prebuilt trees as described in `A.Engine/README.md`.
`run/deploy/engine_ready.py` verifies these inputs and never builds trees.

Continuous OCR uses the Python Parser OCR and finishing stages, followed by
its Engine POS scan. Vector repair is not wired. Tesseract with Myanmar
traineddata is required; Poppler may be needed for PDF rendering. The service
has not yet been verified on the production VPS.
