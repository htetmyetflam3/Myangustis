"""Command-line interface for the Burmese PDF extraction pipeline.

    python module/prase.py <input.pdf> [output_path]
    python module/prase.py input.pdf out.txt --cleanup ask   # (default) y/N once
    python module/prase.py input.pdf out.docx --cleanup yes  # always apply
    python module/prase.py input.pdf out.pdf  --cleanup no   # never apply
    python module/prase.py --serve [--host 0.0.0.0] [--port 5000]
"""

import os
import sys
import argparse

from paths import DEFAULT_OUTPUT_DIR
from pipeline import (
    load_detector,
    process_pdf_stream,
    process_docx_bytes,
    build_content,
    render_texts,
)


def parse_args():
    p = argparse.ArgumentParser(
        description="Extract Burmese text from PDF (CID fonts), detect Zawgyi/Unicode "
                    "per page, convert Zawgyi, and optionally run the imposter+reorder "
                    "cleanup step. Runs as CLI or as a Flask API (--serve).")
    p.add_argument("pdf", nargs="?", help="Input PDF file path")
    p.add_argument("out", nargs="?", default="", help="Output file/dir path (ext .txt/.docx/.pdf)")
    p.add_argument("--cleanup", choices=["ask", "yes", "no"], default="ask",
                   help="Imposter+reorder cleanup: 'ask' (default, y/N once before "
                        "conversion), 'yes' always apply, 'no' never apply.")
    p.add_argument("--content", action="store_true",
                   help="Print ONLY the extracted document body to stdout — one "
                        "plain text, no banner, no page markers, no HTML. "
                        "Progress logging moves to stderr.")
    p.add_argument("--scan", nargs="?", const="auto", default="",
                   metavar="LOG",
                   help="After writing the output, scan it for structural "
                        "damage a score cannot see (orphan marks, impossible "
                        "pairs, shadow debris, digit/consonant confusion) and "
                        "write the clusters to LOG (default: <output>.scan.txt).")
    p.add_argument("--dict", default="", metavar="PATH",
                   help="With --scan: a scripts.db (master_json table) or a "
                        "JSON word list. Adds an 'unknown word' rule and a "
                        "dictionary-coverage figure.")
    p.add_argument("--serve", action="store_true", help="Run as Flask HTTP API instead of CLI")
    p.add_argument("--host", default="0.0.0.0", help="API bind host (default 0.0.0.0)")
    p.add_argument("--port", type=int, default=5000, help="API bind port (default 5000)")
    return p.parse_args()


def ask_cleanup_once():
    """Single global y/N prompt (Yes = apply, No = skip). Default No."""
    try:
        ans = input("\n[?] Apply imposter cleanup + mark reorder? [y/N]: ").strip().lower()
    except EOFError:
        return False
    return ans in ("y", "yes")


def _run_scan(scan_arg, out_path, pages, dict_path=""):
    """Scan the text we just produced and write the cluster log.

    Reads the pages in memory rather than the output file, so it works for
    .docx and .pdf output too.
    """
    from scan import scan_text, format_report, load_dictionary, clause_model, RULES

    body = "\n\n".join(pg.get("text", "") for pg in pages)
    words = load_dictionary(dict_path) if dict_path else None
    standalone = clause_model(dict_path)[0] if dict_path else ()
    log_path = (os.path.splitext(out_path)[0] + ".scan.txt"
                if scan_arg == "auto" else scan_arg)
    report = scan_text(body, words=words, standalone=standalone)
    with open(log_path, "w", encoding="utf-8") as fh:
        fh.write(format_report(report, source=os.path.basename(out_path),
                               total_chars=len(body)))
    hits = {k: report[k]["total"] for k, _t, _f in RULES}
    if "unknown" in report:
        u = report["unknown"]
        known = u["tokens"] - u["total"]
        print(f"[+] Dictionary coverage: {known:,}/{u['tokens']:,} tokens "
              f"= {100.0 * known / u['tokens']:.2f}%")
        hits["unknown"] = u["total"]
    worst = ", ".join(f"{k} {n}" for k, n in hits.items() if n)
    print(f"[+] Scan: {worst or 'clean'}")
    print(f"[+] Scan log: {log_path}")


def run_cli(args):
    pdf_path = args.pdf
    if not pdf_path:
        print("Usage: python module/prase.py <input.pdf> [output_path] [--cleanup ask|yes|no]")
        sys.exit(1)
    if not os.path.exists(pdf_path):
        print(f"[-] Input not found: {pdf_path}")
        sys.exit(1)

    detector = load_detector()

    # --content: print ONLY the document body (one plain text, no banner,
    # no page markers, no HTML) to stdout; progress goes to stderr. This is
    # the shape the Node backend consumes (single content as whole body).
    if args.content:
        import contextlib

        def _log_stderr(msg):
            print(msg, file=sys.stderr)

        is_docx = pdf_path.lower().endswith(".docx")
        if is_docx:
            with open(pdf_path, "rb") as fh:
                job = process_docx_bytes(fh.read(), detector,
                                         filename=os.path.basename(pdf_path),
                                         log=_log_stderr)
            body = build_content(job, args.cleanup in ("yes",))
        else:
            apply_cleanup = args.cleanup != "no"
            if args.cleanup == "ask":
                apply_cleanup = ask_cleanup_once()
            _, _, reports = process_pdf_stream(pdf_path, detector, apply_cleanup,
                                               log=_log_stderr, want_layout=False)
            body = "\n\n".join(rep["text"] for rep in reports)
        sys.stdout.write(body)
        return

    # Resolve the output path FIRST: DOCX output needs the per-line layout
    # (x/y/font-size + MediaBox) carried through the streaming pass.
    out_arg = args.out or str(DEFAULT_OUTPUT_DIR)
    out_ext = os.path.splitext(out_arg)[1].lower()
    base_name = os.path.splitext(os.path.basename(pdf_path))[0]
    if out_ext in (".txt", ".docx", ".pdf"):
        out_path = out_arg
    else:
        os.makedirs(out_arg, exist_ok=True)
        out_path = os.path.join(out_arg, base_name + ".txt")
        out_ext = ".txt"
    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    want_layout = out_ext == ".docx"

    # DOCX input runs the same pipeline. It carries no PDF geometry, so DOCX
    # output flows the text as simple paragraphs (no bold/italic/weight kept)
    # via the shared PDF-path DOCX writer. .txt/.docx/.pdf output all work.

    # Plain .txt input = the RESULT-REWRITE path: text (e.g. the Engine's
    # processed output) -> .docx for delivery. No extraction, no detection.
    if pdf_path.lower().endswith(".txt"):
        if out_ext != ".docx":
            print("[-] .txt input supports .docx output only (use out.docx)")
            sys.exit(1)
        from render import write_docx_plain
        with open(pdf_path, "r", encoding="utf-8") as fh:
            body = fh.read()
        write_docx_plain(out_path, body)
        print(f"[+] Saved: {out_path}")
        print("[+] Done.")
        return

    # --- The ONE global gate, asked BEFORE any page is touched ---
    if args.cleanup == "ask":
        apply_cleanup = ask_cleanup_once()
    elif args.cleanup == "yes":
        apply_cleanup = True
    else:
        apply_cleanup = False
    print(f"[+] Cleanup step (imposter + reorder): {'APPLY' if apply_cleanup else 'SKIP'}")

    # Single-pass streaming pipeline: extract -> detect -> convert -> cleanup,
    # ONE PAGE AT A TIME. Only final page texts (+ layout for docx) are kept.
    print("[+] Processing pages (single-pass stream)...")
    if pdf_path.lower().endswith(".docx"):
        # DOCX input — same detect/Rabbit/cleanup pipeline, zip container.
        with open(pdf_path, "rb") as fh:
            job = process_docx_bytes(fh.read(), detector,
                                     filename=os.path.basename(pdf_path),
                                     log=print)
        counts = job["counts"]
        pages = []
        for pg, rep in zip(job["pages"], job["reports"]):
            text = (rep["clean"]
                    if (apply_cleanup and rep["clean"] is not None)
                    else pg["text"])
            pages.append({"text": text})
        total_changes = len(job["changes"])
    else:
        metadata, npages, reports = process_pdf_stream(pdf_path, detector,
                                                       apply_cleanup, log=print,
                                                       want_layout=want_layout)
        counts = {"ZAWGYI": 0, "UNICODE": 0, "UNKNOWN": 0}
        pages = []
        total_changes = 0
        for rep in reports:
            counts[rep["category"]] = counts.get(rep["category"], 0) + 1
            pages.append({k: rep[k] for k in ("text", "lines", "wh", "has_img") if k in rep})
            total_changes += rep["n_changes"]

    print(f"[+] Detection done: {counts.get('ZAWGYI',0)} Zawgyi, "
          f"{counts.get('UNICODE',0)} Unicode, {counts.get('UNKNOWN',0)} unknown")
    if apply_cleanup and total_changes:
        print(f"[+] Cleanup applied: {total_changes} line(s) reordered/cleaned")
    elif total_changes:
        print(f"[i] {total_changes} line(s) would have changed (cleanup skipped)")

    render_texts(out_path, pages, counts, pdf_path)
    print(f"[+] Saved: {out_path}")
    if args.scan:
        _run_scan(args.scan, out_path, pages, getattr(args, "dict", ""))
    print("[+] Done.")


def main():
    args = parse_args()
    if args.serve:
        from api import create_app
        app = create_app()
        print(f"[+] API listening on http://{args.host}:{args.port}  (endpoints: /health, /api/preview, /api/finalize)")
        app.run(host=args.host, port=args.port, debug=False, threaded=True)
    else:
        run_cli(args)


if __name__ == "__main__":
    main()
