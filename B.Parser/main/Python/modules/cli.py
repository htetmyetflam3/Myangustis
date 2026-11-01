# Separate JavaScript and Python parsers were planned and may be revisited;
# currently the Python CLI invokes the JavaScript Manager in a Node child.
"""CLI for the JavaScript Manager: PDF/DOCX extraction and OCR routing."""

import argparse
import os
import sys
import tempfile
from pathlib import Path

from paths import DEFAULT_OUTPUT_DIR
from node_manager import ManagerError, dispatch_path, render_text


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Convert PDF or DOCX through the JavaScript Manager.")
    parser.add_argument("pdf", nargs="?", help="Input PDF, DOCX, or text file")
    parser.add_argument("out", nargs="?", default="", help="Output file or directory")
    parser.add_argument("--cleanup", choices=["ask", "yes", "no"], default="ask",
                        help="Apply the Manager's existing cleanup stage")
    parser.add_argument("--method", choices=["manual", "default"], default=None,
                        help="PDF defaults to manual page routing; DOCX defaults to default")
    parser.add_argument("--source-encoding", choices=["auto", "unicode", "zawgyi-one"], default="auto",
                        help="Declare the input encoding when the font is not labelled")
    parser.add_argument("--content", action="store_true", help="Print only the extracted body")
    parser.add_argument("--scan", nargs="?", const="auto", default="", metavar="LOG",
                        help="Run the existing optional text scan after conversion")
    parser.add_argument("--dict", default="", metavar="PATH", help="Dictionary for --scan")
    parser.add_argument("--serve", action="store_true", help="Run the Flask API")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5000)
    return parser.parse_args(argv)


def ask_cleanup_once():
    print("[?] Apply cleanup? [y/N]: ", end="", file=sys.stderr, flush=True)
    return sys.stdin.readline().strip().lower() in ("y", "yes")


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
    if not args.pdf:
        raise ValueError("an input PDF, DOCX, or text file is required")
    source = Path(args.pdf)
    if not source.is_file():
        raise FileNotFoundError(f"Input not found: {source}")
    suffix = source.suffix.lower()
    if suffix not in (".pdf", ".docx", ".doc", ".txt"):
        raise ValueError("input must be PDF, DOCX, or TXT")

    out_arg = args.out or str(DEFAULT_OUTPUT_DIR)
    out_ext = Path(out_arg).suffix.lower()
    if out_ext in (".txt", ".docx", ".pdf"):
        out_path = Path(out_arg)
    else:
        out_path = Path(out_arg) / (source.stem + ".txt")
        out_ext = ".txt"
    if suffix == ".txt":
        if args.content:
            sys.stdout.write(source.read_text(encoding="utf-8"))
            return
        if out_ext != ".docx":
            raise ValueError("TXT input supports DOCX output only")
        result = render_text(source, out_path)
    else:
        apply_cleanup = (ask_cleanup_once() if args.cleanup == "ask" else args.cleanup == "yes")
        kind = "pdf" if suffix == ".pdf" else "docx"
        if args.content:
            with tempfile.TemporaryDirectory(prefix="myangustis-content-") as directory:
                result = dispatch_path(source, Path(directory) / "content.txt", kind=kind,
                                       method=args.method, apply_cleanup=apply_cleanup,
                                       source_encoding=args.source_encoding)
            sys.stdout.write(result.get("text", ""))
            return
        result = dispatch_path(source, out_path, kind=kind, method=args.method,
                               apply_cleanup=apply_cleanup, include_text=True,
                               source_encoding=args.source_encoding)

    if result.get("skipped"):
        raise ManagerError(result.get("reason") or "Manager skipped the input")
    print(f"[+] Saved: {result['file']}")
    if args.scan:
        _run_scan(args.scan, str(out_path), [{"text": result.get("text", "")}], args.dict)
    print("[+] Done.")


def main(argv=None):
    args = parse_args(argv)
    if args.serve:
        from api import create_app
        app = create_app()
        print(f"[+] API listening on http://{args.host}:{args.port}")
        app.run(host=args.host, port=args.port, debug=False, threaded=True)
        return 0
    try:
        run_cli(args)
    except (ManagerError, OSError, ValueError) as exc:
        print(f"[-] {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
