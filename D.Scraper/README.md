# Scraper engine integration

`architecture/result/text_collect.py` segments through the in-process Python
Engine; `pdf_classify.py` routes image-only PDFs to OCR and leaves all other PDFs to the Python Parser. Configure the external
master, key and prebuilt trees as described in `A.Engine/README.md`.
`run/deploy/engine_ready.py` verifies these inputs and never builds trees.

Continuous OCR uses the Python Parser OCR and finishing stages, followed by
its Engine POS scan. Vector repair is not wired. Tesseract with Myanmar
traineddata is required; Poppler may be needed for PDF rendering. The service
has not yet been verified on the production VPS.

## Continuous parse from the shared host

In the **repository-root `.env` on the VPS**, configure the existing shared-host
`SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_KEY` and `SSH_DIR`, then select a
single direct child with `REMOTE_PRASER_DIR`. For example:

```env
SSH_DIR=~/domains/site/pdfs/
REMOTE_PRASER_DIR=/old/
```

The queue is `~/domains/site/pdfs/old/` on the **shared host**; `/old/` is
intentionally treated as a child, not an absolute path. An unset key defaults
to `convertable` for compatibility. The service recursively reads PDFs only
inside that child and does not alter the remote originals. `SSH_KEY` is a path
to a private key on the VPS. The host connection must already support key-based
SSH without an interactive prompt.

From `D.Scraper/run` on the systemd VPS, `uv run parse.py` installs and starts
`scraper-parse.service`. If it is already running, stop it before restarting
with the new configuration. The service writes on the VPS:

- `D.Scraper/run/pdfs/parquet/books.parquet` — the existing shared Parquet
  collection, with its existing duplicate guard.
- `D.Scraper/run/pdfs/parquet/parsed-books.txt` — combined UTF-8 extracted
  text, one section per processed source with its PDF filename as the heading.

The TXT is plain parsed text; Parquet also contains segmented text. TXT sections
are recorded in `D.Scraper/run/scan/parse/state.sqlite3`, allowing the service
to rebuild the file after a restart or deletion. Keep the ledger with the TXT;
the service refuses to overwrite an existing untracked TXT collection. Existing
successful books in the selected folder can be backfilled from Parquet. A PDF
is only released from local staging after both outputs succeed; failed inputs
are retained and are not automatically retried. Image-only PDFs are not sent to
this text-parser service; use the separate OCR workflow for those.

### Parser lane decision logging

Set `PARSER_LOG_ENABLED=on` in the VPS repository-root `.env` and restart
`scraper-parse.service` to append lane decisions to
`B.Parser/logs/lane-decisions.log`. `PARSER_LOG_FILE` can select another path.
When off (the default), decision messages still appear in the service journal.
See [Parser lane logging](../B.Parser/README.md#pdf-lane-decision-log) for
page ranges, lane-switch behavior, and log-file handling.
