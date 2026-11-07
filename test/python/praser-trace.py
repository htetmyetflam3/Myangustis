#!/usr/bin/env python3
"""Dump a bit-exact trace of the Python praser core, for JS-parity diffing.

Usage:  python3 .bin/praser-trace.py <out-dir> [pdf] [docx]

Writes  <out>/py_pdf.jsonl      one object per PDF page
        <out>/py_docx.jsonl     one object per DOCX detection chunk
        <out>/py_docx_paras.json  the raw paragraph list

Numbers are stored as the hex of their IEEE-754 double bits (struct.pack('>d')),
so a parity diff compares bit patterns, never decimal formatting. Non-finite
values become the strings "inf" / "-inf" / "nan".

The trace covers, per page: the extracted layout lines, the detector category and
probability, the Rabbit base text, the cleanup text, and the changed-line count.
That single record pins pdf_extract (decoding + layout), detector (Markov scorer),
rabbit (zg2uni) and cleanup (imposters + reorder) at once.
"""
import json
import os
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY_MOD = os.path.join(REPO, "R_Site", "Praser", "Python", "module")
sys.path.insert(0, PY_MOD)

from cleanup import cleanup_text                     # noqa: E402
from docx_extract import extract_docx_paragraphs     # noqa: E402
from pipeline import (_DOCX_CHUNK_PARAGRAPHS, _count_diff_lines, _norm_category,  # noqa: E402
                      _safe_prob, load_detector, stream_pdf_pages)
from rabbit import Rabbit                             # noqa: E402


def num(x):
    if x != x:
        return "nan"
    if x == float("inf"):
        return "inf"
    if x == float("-inf"):
        return "-inf"
    return struct.pack(">d", float(x)).hex()


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def trace_pdf(pdf_path, det):
    log = []
    _, npages, pages = stream_pdf_pages(pdf_path, detector=det, log=log.append)
    rows = []
    for pg in pages:
        raw = pg["text"]
        category, prob = det.detect(raw)
        cat = _norm_category(category)
        base = Rabbit.zg2uni(raw) if cat == "ZAWGYI" else raw
        clean = None if cat == "UNKNOWN" else cleanup_text(base)
        rows.append({
            "idx": pg["idx"],
            "has_img": pg["has_img"],
            "wh": [num(pg["wh"][0]), num(pg["wh"][1])],
            "lines": [[num(x), num(y), num(s), t] for (x, y, s, t) in pg["lines"]],
            "raw": raw,
            "cat": cat,
            "prob": num(_safe_prob(prob)),
            "prob_raw": num(prob),
            "base": base,
            "clean": clean,
            "n_changes": 0 if clean is None or clean == base
                         else _count_diff_lines(base, clean),
        })
    return rows, log, npages


def trace_docx(docx_path, det):
    paragraphs = extract_docx_paragraphs(docx_path)
    rows = []
    per = _DOCX_CHUNK_PARAGRAPHS
    chunks = (["\n".join(paragraphs[i:i + per]) for i in range(0, len(paragraphs), per)]
              if paragraphs else [""])
    for idx, chunk in enumerate(chunks):
        category, prob = det.detect(chunk)
        cat = _norm_category(category)
        base = Rabbit.zg2uni(chunk) if cat == "ZAWGYI" else chunk
        clean = None if cat == "UNKNOWN" else cleanup_text(base)
        rows.append({
            "idx": idx,
            "raw": chunk,
            "cat": cat,
            "prob": num(_safe_prob(prob)),
            "base": base,
            "clean": clean,
            "n_changes": 0 if clean is None or clean == base
                         else _count_diff_lines(base, clean),
        })
    return rows, paragraphs


def main():
    out_dir = sys.argv[1]
    pdf_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        REPO, "R_Site", "Praser", "Python", "upload", "input", "pdf", "test.pdf")
    docx_path = sys.argv[3] if len(sys.argv) > 3 else os.path.join(
        REPO, "R_Site", "Praser", "Python", "upload", "input", "docx",
        "zawgyi_fixture.docx")
    os.makedirs(out_dir, exist_ok=True)

    det = load_detector()
    rows, log, npages = trace_pdf(pdf_path, det)
    write_jsonl(os.path.join(out_dir, "py_pdf.jsonl"), rows)
    with open(os.path.join(out_dir, "py_pdf_log.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(log) + "\n")

    drows, paras = trace_docx(docx_path, det)
    write_jsonl(os.path.join(out_dir, "py_docx.jsonl"), drows)
    with open(os.path.join(out_dir, "py_docx_paras.json"), "w", encoding="utf-8") as f:
        json.dump(paras, f, ensure_ascii=False)

    cats = {}
    for r in rows:
        cats[r["cat"]] = cats.get(r["cat"], 0) + 1
    print(f"[+] pdf: {npages} pages -> {out_dir}/py_pdf.jsonl  cats={cats}")
    print(f"[+] pdf log: {len(log)} lines -> py_pdf_log.txt")
    print(f"[+] docx: {len(drows)} chunks, {len(paras)} paragraphs")


if __name__ == "__main__":
    main()
