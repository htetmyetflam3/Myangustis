#!/usr/bin/env python3
"""Single entry point for B.Parser: one command per run."""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARSER_ROOT = ROOT.parent
REPO_ROOT = PARSER_ROOT.parent


def _load_workspace_env() -> None:
    """Load root and Engine .env files via index-path.py before package import."""
    if "index-path" in sys.modules:
        return
    index_path = REPO_ROOT / "index-path.py"
    if not index_path.is_file():
        return
    spec = importlib.util.spec_from_file_location("index-path", index_path)
    if spec is None or spec.loader is None:
        return
    module = importlib.util.module_from_spec(spec)
    sys.modules["index-path"] = module
    spec.loader.exec_module(module)


def _ensure_packages() -> None:
    """Resolve workspace packages even when run outside an activated venv."""
    engine_arch = REPO_ROOT / "A.Engine" / "architecture"
    if (engine_arch / "myangustis_engine").is_dir():
        engine_str = str(engine_arch)
        if engine_str not in sys.path:
            sys.path.insert(0, engine_str)
    if "myangustis_parser" in sys.modules:
        return
    try:
        import myangustis_parser  # noqa: F401
    except ModuleNotFoundError:
        arch_init = PARSER_ROOT / "architecture" / "__init__.py"
        spec = importlib.util.spec_from_file_location(
            "myangustis_parser",
            arch_init,
            submodule_search_locations=[str(arch_init.parent)],
        )
        if spec is None or spec.loader is None:
            raise
        package = importlib.util.module_from_spec(spec)
        sys.modules["myangustis_parser"] = package
        spec.loader.exec_module(package)


_load_workspace_env()
_ensure_packages()

from myangustis_parser.resources import paths  # noqa: E402

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".gif", ".bmp")
SUPPORTED_INPUT_SUFFIXES = (".pdf", ".docx", ".doc", ".txt", *IMAGE_SUFFIXES)

EXAMPLES = """\
examples:
  uv run main.py book.pdf
  uv run main.py book.pdf --txt
  uv run main.py book.pdf --docx
  uv run main.py book.docx
  uv run main.py book.docx --txt
  uv run main.py book.pdf --ocr
  uv run main.py book.pdf --ocr --txt
  uv run main.py scan.png --ocr --txt

defaults:
  bare PDF filenames   -> Junk/Parser/upload/pdf/<name>
  bare DOCX filenames  -> Junk/Parser/upload/docx/<name>
  output directory     -> Junk/Parser/output/{txt,docx,pdf}/<stem>.<fmt>
  omitted output flag  -> matches the input file format (images default to .txt)

exit codes: 0 ok, 1 failed, 2 usage error, 130 interrupted
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description=(
            "Single entry point for B.Parser: parse or OCR one document.\n"
            "Without --ocr the document is parsed (including OCR on image-only pages);\n"
            "with --ocr the OCR lane runs across the document."
        ),
        epilog=EXAMPLES,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "input",
        nargs="?",
        default=None,
        help=(
            "Input filename (resolved under Junk/Parser/upload/pdf/ or "
            "Junk/Parser/upload/docx/) or an explicit file path."
        ),
    )
    parser.add_argument(
        "--ocr",
        action="store_true",
        help="Run OCR across the input document using B.Parser's OCR lane.",
    )
    formats = parser.add_mutually_exclusive_group()
    formats.add_argument(
        "--txt",
        action="store_const",
        const="txt",
        dest="output_format",
        help="Write .txt output under Junk/Parser/output/txt/.",
    )
    formats.add_argument(
        "--docx",
        action="store_const",
        const="docx",
        dest="output_format",
        help="Write .docx output under Junk/Parser/output/docx/.",
    )
    formats.add_argument(
        "--pdf",
        action="store_const",
        const="pdf",
        dest="output_format",
        help="Write .pdf output under Junk/Parser/output/pdf/.",
    )
    return parser


def resolve_input_path(raw_input: str) -> Path:
    """Resolve an explicit path or a bare filename from Junk/Parser/upload/."""
    text = str(raw_input or "").strip()
    if not text:
        raise ValueError("an input file is required")
    candidate = Path(text)
    has_dir = ("/" in text) or ("\\" in text) or candidate.is_absolute()
    if has_dir:
        if not candidate.is_file():
            raise FileNotFoundError(f"Input not found: {candidate}")
        return candidate

    default_path = paths.input_dir_for(candidate.suffix.lower()) / candidate.name
    if default_path.is_file():
        return default_path
    if candidate.is_file():
        return candidate
    raise FileNotFoundError(f"Input not found: {default_path}")


def resolve_output_format(source: Path, requested: str | None) -> str:
    """Validate input suffix and select output format (defaults to input format)."""
    suffix = source.suffix.lower()
    if suffix not in SUPPORTED_INPUT_SUFFIXES:
        raise ValueError(
            f"Unsupported input file {source.name!r}; "
            "expected .pdf, .docx, .txt, or an image"
        )
    if requested is not None:
        return requested
    if suffix == ".pdf":
        return "pdf"
    if suffix in (".docx", ".doc"):
        return "docx"
    if suffix == ".txt":
        return "txt"
    return "txt"


def resolve_output_path(source: Path, fmt: str) -> Path:
    """Build output path under Junk/Parser/output/{txt,docx,pdf}/."""
    return paths.output_dir_for(fmt) / f"{source.stem}.{fmt}"


def run_document(source: Path, out_path: Path, *, use_ocr: bool = False, log=print) -> dict:
    """Dispatch parsing (`index.convert`) or OCR (`index.dispatch_ocr`)."""
    from myangustis_parser.entry import index

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if use_ocr:
        return index.dispatch_ocr(
            source,
            out_path,
            include_text=True,
            log=log,
        )
    if source.suffix.lower() == ".txt":
        if out_path.suffix.lower() != ".docx":
            raise ValueError("TXT input requires --docx output")
        return index.render_text(source, out_path)
    return index.convert(
        source,
        out_path,
        include_text=True,
        log=log,
    )


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.input is None:
        if args.ocr or args.output_format is not None:
            parser.error("an input file is required")
        parser.print_help()
        return 0
    if not args.input.strip():
        parser.error("an input file is required")

    try:
        source = resolve_input_path(args.input)
        fmt = resolve_output_format(source, args.output_format)
        out_path = resolve_output_path(source, fmt)
        result = run_document(source, out_path, use_ocr=args.ocr, log=print)
    except (OSError, ValueError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n[paused] interrupted.", file=sys.stderr)
        return 130

    counts = " ".join(f"{k}={v}" for k, v in (result.get("counts") or {}).items())
    print(f"[+] Saved: {result['file']}")
    print(f"[+] Pages: {result.get('pages', 0)}" + (f"  ({counts})" if counts else ""))
    if result.get("ocrPages"):
        print(f"[+] OCR pages: {', '.join(str(p) for p in result['ocrPages'])}")
    print("[+] Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
