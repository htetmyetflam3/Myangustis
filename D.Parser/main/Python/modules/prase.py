#!/usr/bin/env python3
"""
Description: Extracts Burmese text from PDFs with embedded CID fonts, preserves PDF
layout (line breaks, positioning), then converts Zawgyi encoding to standard Myanmar
Unicode using embedded Rabbit rules. After detection/conversion a single new cleanup
step (imposter cleanup + canonical mark reorder) can be previewed/approved.

This is the entry point for the pipeline. The implementation is split across sibling
modules in this directory:

    paths.py       path resolution (models, fonts, output)
    fonts.py       Burmese/Latin font profiles + role-based font resolution
    rabbit.py      Rabbit Zawgyi -> Unicode converter
    cleanup.py     imposter cleanup + canonical mark reorder
    pdf_extract.py low-level PDF / FontFile2 / cmap / layout parsing
    pdf_fonts.py   per-/Font-resource decoders (encodings, CMaps, ToUnicode)
    pipeline.py    shared service layer (detect, convert, changes, dispatch)
    render.py      .txt / .docx / .pdf writers
    api.py         Flask JSON API
    cli.py         command-line interface

Burmese text defaults to the MyanmarSagar font; stylish faces from ./fonts/Unicode/ are
used only for confidently-detected roles (title/heading/meta), falling back to
MyanmarSagar otherwise — for both PDF and DOCX output.

Two callers share the same pipeline:

  TERMINAL (CLI):
      python module/prase.py <input.pdf|input.docx> [output_path]
      python module/prase.py input.pdf out.txt
      python module/prase.py input.pdf out.docx
      python module/prase.py input.pdf out.pdf
      python module/prase.py input.docx out.txt          # docx in: txt out only
      python module/prase.py input.pdf out.txt --cleanup ask   # (default) y/N once
      python module/prase.py input.pdf out.txt --cleanup yes   # always apply
      python module/prase.py input.pdf out.txt --cleanup no    # never apply

  BARE JSON API (Flask) — meant to be called by a Node.js backend:
      python module/prase.py --serve [--host 0.0.0.0] [--port 5000]

      GET  /health                                            -> {"ok": true}
      POST /api/preview   multipart: file=<pdf>               -> JSON preview
      POST /api/finalize  form: job_id=..., apply=0|1, fmt=txt|docx|pdf -> download

Decoding is model-first and fonts are only a last resort.  Most Burmese PDFs
(Zawgyi-One and modern Unicode fonts alike) use an Identity-H / direct encoding
where the content-stream code IS the code point, so the codes are decoded
directly and the Zawgyi/Unicode model confirms the result — no font file or CMap
is touched.  Only when the model finds no Myanmar do we fall back to the PDF's
/ToUnicode CMap and (if needed) the embedded font's cmap (FontFile/FontFile2/
FontFile3).

Whichever source wins, it is the DOCUMENT-LEVEL FALLBACK, never a page-wide
decoder: each /Font resource of a page gets its own decoder (pdf_fonts.py) and
the Tf operator decides which one every shown string goes through.  A page
that mixes a Myanmar /Identity-H resource with a Latin /WinAnsiEncoding one —
even when both point at the same embedded font program — is the normal case,
and reading the Latin character codes as Myanmar glyph ids is what used to
turn "God of Slaughter" into "dod of plaughter".

Flask is only needed for --serve; fpdf only for PDF output.
"""

import os
import sys

# Make the sibling modules (and detector.py) importable regardless of how this
# entry point is invoked (e.g. `python module/prase.py` or `python prase.py`).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cli import main  # noqa: E402


if __name__ == "__main__":
    main()
