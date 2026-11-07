#!/usr/bin/env python3
# Separate JavaScript and Python parsers were planned and may be revisited;
# currently Python invokes the JavaScript Manager in a Node child process.
"""Python CLI/API entry point for the shared JavaScript Manager.

Use ``python prase.py INPUT.pdf OUTPUT.docx --method manual`` for automatic
per-page selection of the text extraction or OCR lane. ``--serve`` runs the
Flask API; the Manager remains the parser for both interfaces.
"""

import os
import sys

# Make the sibling modules (and detector.py) importable regardless of how this
# entry point is invoked (e.g. `python module/prase.py` or `python prase.py`).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cli import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
