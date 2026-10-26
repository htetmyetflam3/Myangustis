#!/usr/bin/env python3
"""Produce the PDF-output parity case: one input, written by BOTH engines.

Writes  <out>/pdfcase.json    {"texts": [...], "pdf_path": ..., "npages": ..., "metadata": {}}
        <out>/case_py.pdf     render._write_pdf(...) with the real fpdf2

The JS side (.bin/praser-pdf-check.mjs) writes the same case with its own port and
compares the CONTENT STREAMS. Text is taken from the fixture so it carries real
Myanmar runs (mixed-script lines are the case that exercises font substitution).
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY_MOD = os.path.join(REPO, "R_Site", "Praser", "Python", "module")
sys.path.insert(0, PY_MOD)

from pipeline import load_detector, process_pdf_stream   # noqa: E402
import render                                              # noqa: E402


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/linga_ref"
    os.makedirs(out_dir, exist_ok=True)
    pdf = os.path.join(REPO, "R_Site", "Praser", "Python",
                       "upload", "input", "pdf", "test.pdf")
    det = load_detector()
    _, _, reports = process_pdf_stream(pdf, det, False, log=lambda m: None, want_layout=False)
    texts = []
    for i, rep in enumerate(reports):
        if i >= 6:
            break
        if rep["text"].strip():
            texts.append(rep["text"])
    case = {"texts": texts, "pdf_path": "upload/input/pdf/test.pdf",
            "npages": len(texts), "metadata": {}}
    with open(os.path.join(out_dir, "pdfcase.json"), "w", encoding="utf-8") as f:
        json.dump(case, f, ensure_ascii=False)

    out = os.path.join(out_dir, "case_py.pdf")
    render._write_pdf(out, case["texts"], case["metadata"], case["pdf_path"], case["npages"])
    print(f"[+] fpdf2 wrote {os.path.getsize(out)} bytes -> {out}")
    print(f"[+] case: {len(texts)} pages")


if __name__ == "__main__":
    main()
