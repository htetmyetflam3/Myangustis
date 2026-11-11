"""CLI for the Python parser: PDF/DOCX extraction and text output.

This entry point drives the Python parser's own Manager
(:mod:`manager` -> :mod:`pipeline` -> :mod:`render`). It does not start
Node and does not call the JavaScript parser; the two implementations are
independent. A caller that wants them to agree exchanges JSON job files
(:mod:`interop`, ``--job`` / ``--response``).

    python3 prase.py INPUT.pdf OUTPUT.docx --method manual
    python3 prase.py INPUT.docx OUTPUT.txt --cleanup yes
    python3 prase.py --job request.json --response response.json
    python3 prase.py --serve --port 5000
"""

import argparse
import os
import sys
import tempfile
from pathlib import Path

from paths import DEFAULT_OUTPUT_DIR
from manager import ManagerError, dispatch_path, mute_advisories, render_text


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Convert PDF or DOCX with the standalone Python parser.")
    parser.add_argument("pdf", nargs="?",
                        help="Input PDF, DOCX, text file, or image (OCR)")
    parser.add_argument("out", nargs="?", default="", help="Output file or directory")
    parser.add_argument("--cleanup", choices=["ask", "yes", "no"], default="ask",
                        help="Apply the imposter cleanup stage")
    parser.add_argument("--method", choices=["manual", "default"], default=None,
                        help="PDF defaults to manual page routing; DOCX defaults to default")
    parser.add_argument("--source-encoding", choices=["auto", "unicode", "zawgyi-one"],
                        default="auto",
                        help="Declare the input encoding when the font is not labelled")
    parser.add_argument("--text-layout", choices=["auto", "off", "zawcode"], default=None,
                        help="ZawCode draft-glyph profile selection (default: auto)")
    parser.add_argument("--content", action="store_true", help="Print only the extracted body")
    parser.add_argument("--quiet", action="store_true",
                        help="Accepted for compatibility; this parser has no advisories")
    parser.add_argument("--no-ocr", action="store_true",
                        help="Do not OCR image-only PDF pages or embedded images")
    parser.add_argument("--job", metavar="REQUEST.json", default="",
                        help="Run one JSON job (the cross-parser integration contract)")
    parser.add_argument("--response", metavar="RESPONSE.json", default="",
                        help="Write the job result here (default: job.responsePath)")
    parser.add_argument("--serve", action="store_true", help="Run the Flask API")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5000)
    return parser.parse_args(argv)


def ask_cleanup_once():
    print("[?] Apply cleanup? [y/N]: ", end="", file=sys.stderr, flush=True)
    return sys.stdin.readline().strip().lower() in ("y", "yes")


def run_job_mode(args):
    """Execute the JSON job contract and print/return its result."""
    import json

    from interop import run_job_file

    result = run_job_file(args.job, args.response or None)
    if result.get("status") != "ok":
        print(f"[-] {result.get('error')}", file=sys.stderr)
        return 1
    if not args.response and not result.get("responsePath"):
        print(json.dumps(result, ensure_ascii=False))
    elif args.response:
        print(f"[+] Response: {args.response}")
    if result.get("file"):
        print(f"[+] Saved: {result['file']}")
    return 0


def run_cli(args):
    if not args.pdf:
        raise ValueError("an input PDF, DOCX, or text file is required")
    source = Path(args.pdf)
    if not source.is_file():
        raise FileNotFoundError(f"Input not found: {source}")
    suffix = source.suffix.lower()
    images = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".gif", ".bmp")
    if suffix not in (".pdf", ".docx", ".doc", ".txt", *images):
        raise ValueError("input must be PDF, DOCX, TXT, or an image")

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
        kind = ("pdf" if suffix == ".pdf"
                else "ocr" if suffix in images else "docx")
        # An image has no encoding to clean up, so there is nothing to ask.
        apply_cleanup = (False if kind == "ocr" else
                         ask_cleanup_once() if args.cleanup == "ask"
                         else args.cleanup == "yes")
        if args.content:
            with tempfile.TemporaryDirectory(prefix="myangustis-content-") as directory:
                result = dispatch_path(source, Path(directory) / "content.txt", kind=kind,
                                       method=args.method, apply_cleanup=apply_cleanup,
                                       source_encoding=args.source_encoding,
                                       text_layout=args.text_layout)
            sys.stdout.write(result.get("text", ""))
            return
        result = dispatch_path(source, out_path, kind=kind, method=args.method,
                               apply_cleanup=apply_cleanup, include_text=True,
                               source_encoding=args.source_encoding,
                               text_layout=args.text_layout)

    if result.get("skipped"):
        raise ManagerError(result.get("reason") or "the parser skipped the input")
    print(f"[+] Saved: {result['file']}")
    print(f"[+] Pages: {result.get('pages', 0)}  "
          f"({' '.join(f'{k}={v}' for k, v in (result.get('counts') or {}).items())})")
    print("[+] Done.")


def main(argv=None):
    args = parse_args(argv)
    if args.no_ocr:
        os.environ["PRASER_OCR"] = "off"
    if args.quiet:
        # Kept so scripts that pass --quiet keep working; a no-op by design.
        mute_advisories()
    if args.job:
        return run_job_mode(args)
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
