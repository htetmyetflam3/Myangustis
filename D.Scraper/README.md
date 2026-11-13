# Scraper

The scraper runner is `D.Scraper/run/main.py`. It keeps its existing systemd
launch behavior and email notifications. Downloads are classified and uploaded
to the configured shared host; upload no longer parses or segments books. The
parser and OCR are independent runners in `B.Parser/main.py`.

To run scraper and the continuous **text parser** together, use the repository
root `main.py`. OCR is never started by this combined runner:

```sh
# On a root systemd VPS, installs/starts myangustis.service:
uv run main.py
# Pass scraper options after -- (default scraper command is --process):
uv run main.py -- --process -l 2 -i 60
# Run the two processes in the foreground instead:
uv run main.py --foreground
```

The scraper and parser run concurrently. The parser reads the configured remote
`SSH_DIR` / `REMOTE_PRASER_DIR` queue read-only. Configure root `.env` as shown
in `.env.example`; `/old/` denotes `old` inside `SSH_DIR`, not a host-absolute
path. Parser output and its new ledger are under `Junk/Parser`; the previous
scraper Parquet/TXT/ledger are not migrated or deleted. See
[B.Parser README](../B.Parser/README.md#independent-parser-and-ocr-runner)
for parser/OCR flags, output locations and service management.

The old `run/deploy/continuous-*` implementation is retained only as legacy
reference for earlier installations; the new runners do not launch it. Stop
and inspect any old `scraper-parse.service` or `scraper-ocr.service` yourself
before using the new workers, to avoid processing the same queue twice. No
installer here stops other services automatically. The combined service does
not install or run OCR. VPS deployment has not been tested.
