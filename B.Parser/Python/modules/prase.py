#!/usr/bin/env python3
"""Python parser entry point — standalone, no Node.

``B.Parser`` ships two independent parsers: a JavaScript one and this Python
one. Neither runs the other and there is no dependency chain in either
direction. They share data only, as JSON (``B.Parser/@jason-map``), plus the
optional JSON job contract in :mod:`interop`.

OCR is included: image-only PDF pages, embedded DOCX pictures and bare image
input are recognised with the Tesseract CLI (``--no-ocr`` turns it off).
Dictionary/master data comes from the JavaScript *engine* as a child process;
that is the engine's data, not the JS parser.

    python prase.py INPUT.pdf OUTPUT.docx --method manual
    python prase.py INPUT.docx OUTPUT.txt
    python prase.py --job request.json --response response.json
    python prase.py --serve
"""

import os
import sys

# Make the sibling modules importable regardless of how this entry point is
# invoked (e.g. `python modules/prase.py` or `python prase.py`).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cli import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
