#!/usr/bin/env python3
"""Single entry point for B.Parser: one command per run."""

from __future__ import annotations

import argparse
import errno
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARSER_ROOT = ROOT
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
DEFAULT_PARSE_INPUT_DIR = paths.RUNTIME_ROOT / "pdf-parts"

EXAMPLES = """\
examples:
  uv run main.py book.pdf
  uv run main.py book.pdf --txt
  uv run main.py Junk/Parser/upload/pdf/ --txt
  uv run main.py parse Junk/Parser/upload/pdf/
  uv run main.py book.docx --txt
  uv run main.py book.pdf --ocr --txt
  uv run main.py scan.png --ocr --txt

defaults:
  bare PDF filenames   -> Junk/Parser/upload/pdf/<name>
  bare DOCX filenames  -> Junk/Parser/upload/docx/<name>
  directory input      -> parses all supported files inside the directory
  output directory     -> Junk/Parser/output/{txt,docx,pdf}/<stem>.<fmt>
  omitted output flag  -> matches the input file format (images default to .txt)

exit codes: 0 ok, 1 failed, 2 usage error, 130 interrupted
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description=(
            "Single entry point for B.Parser: parse or OCR a document or directory.\n"
            "Without --ocr documents are parsed (including OCR on image-only pages);\n"
            "with --ocr the OCR lane runs across each PDF or image."
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
            "Junk/Parser/upload/docx/) or an explicit file or directory path."
        ),
    )
    parser.add_argument(
        "--ocr",
        action="store_true",
        help="Run OCR across the input document(s) using B.Parser's OCR lane.",
    )
    parser.add_argument(
        "--source-encoding",
        choices=("auto", "unicode", "zawgyi-one"),
        default="auto",
        help="Declare the input encoding when the PDF font is not labelled.",
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
    """Resolve an explicit path or a bare filename from Junk/Parser/upload/.

    Paths are anchored to the project root, never the filesystem root: a value
    from .env such as ``/Junk/Parser/upload/`` is ``<repo>/Junk/Parser/upload``
    and ``./upload/`` is ``<repo>/Junk/upload``. A bare filename is looked up in
    the default upload folder for its suffix.
    """
    text = str(raw_input or "").strip()
    if not text:
        raise ValueError("an input file is required")
    resolved = paths.resolve_input(text)
    if resolved is None or not resolved.exists():
        raise FileNotFoundError(f"Input not found: {resolved}")
    return resolved


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


def run_document(source: Path, out_path: Path, *, use_ocr: bool = False,
                 source_encoding: str = "auto", log=print) -> dict:
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
        source_encoding=source_encoding,
        log=log,
    )


def _inside_junk(raw) -> Path:
    """Resolve a caller output path inside the repository Junk directory.

    Output paths follow the same anchoring as .env: a relative value is
    relative to Junk, and a leading slash is a project path rather than a
    filesystem path — ``/output/`` means ``<repo>/Junk/output``.
    """
    resolved = paths.working_path(raw, base=REPO_ROOT)
    if resolved is None:
        raise ValueError('an output path is required')
    path = resolved.expanduser().resolve()
    roots = _output_roots()
    if not any(path.is_relative_to(root) for root in roots):
        raise ValueError('Output must be inside the repository Junk directory '
                         'or the upload/output directory set in .env.')
    return path


def _output_roots():
    """Where output may be written: Junk, plus an .env-configured directory.

    ``PRASER_OUTPUT_DIR``/``PRASER_UPLOAD_DIR`` are the operator's explicit
    choice, so a deployment directory outside the checkout is allowed when it
    is the configured one; ad-hoc paths outside remain refused.
    """
    roots = [(REPO_ROOT / 'Junk').resolve()]
    for directory in (paths.UPLOAD_DIR, paths.OUTPUT_DIR):
        try:
            resolved = Path(directory).resolve()
        except OSError:
            continue
        if resolved not in roots:
            roots.append(resolved)
    return roots


def _new_output(source: Path, raw: str | None, relative: Path | None = None,
                requested_format: str | None = None) -> Path:
    fmt = resolve_output_format(source, requested_format)
    if raw is None:
        directory = _inside_junk(paths.output_dir_for(fmt))
        return directory / (relative.parent if relative else Path()) / (source.stem + '.' + fmt)
    dest = _inside_junk(raw)
    if not dest.suffix:
        return dest / (relative.parent if relative else Path()) / (source.stem + '.' + fmt)
    if dest.suffix.lower() not in ('.pdf', '.docx', '.txt'):
        raise ValueError('Output must be PDF, DOCX, or TXT.')
    if requested_format and dest.suffix.lower().lstrip('.') != requested_format:
        raise ValueError(f'Output extension {dest.suffix} conflicts with --{requested_format}.')
    return dest


def _safe_document(source: Path, output: Path, *, use_ocr: bool,
                   source_encoding: str = "auto"):
    """Publish completed output without overwriting or leaving a partial result."""
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise FileExistsError(errno.EEXIST, os.strerror(errno.EEXIST), str(output))
    fd, name = tempfile.mkstemp(prefix='myangustis-' + output.stem + '.', suffix=output.suffix)
    os.close(fd)
    temporary = Path(name)
    try:
        result = run_document(source, temporary, use_ocr=use_ocr,
                              source_encoding=source_encoding, log=print)
        if output.exists():
            raise FileExistsError(errno.EEXIST, os.strerror(errno.EEXIST), str(output))
        try:
            os.replace(temporary, output)
        except OSError as exc:
            if exc.errno != errno.EXDEV:
                raise
            out_fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666)
            try:
                with os.fdopen(out_fd, 'wb') as dst, temporary.open('rb') as src:
                    shutil.copyfileobj(src, dst)
            except BaseException:
                output.unlink(missing_ok=True)
                raise
        result['file'] = str(output)
        return result
    finally:
        temporary.unlink(missing_ok=True)


def _run_directory_batch(
    source: Path,
    *,
    raw_output: str | None = None,
    requested_format: str | None = None,
    use_ocr: bool = False,
    source_encoding: str = "auto",
    continuous: bool = False,
) -> int:
    output_dir = _inside_junk(raw_output) if raw_output else None
    if output_dir is not None and Path(raw_output).suffix:
        raise ValueError('Batch output must be a directory; omit the extension for a folder.')
    resolved_source = source.resolve()
    candidate_roots = (
        [output_dir] if output_dir is not None else
        [_inside_junk(paths.output_dir_for(fmt)) for fmt in ('txt', 'docx', 'pdf')]
    )
    output_roots = [
        root.resolve() for root in candidate_roots
        if not resolved_source.is_relative_to(root.resolve())
    ]
    while True:
        failed = False
        matched = 0
        for item in sorted(source.rglob('*')):
            if not item.is_file():
                continue
            rel = item.relative_to(source)
            if any(part.startswith('.') for part in rel.parts):
                continue
            suffix = item.suffix.lower()
            if suffix not in SUPPORTED_INPUT_SUFFIXES:
                continue
            if use_ocr and suffix in ('.txt', '.docx', '.doc'):
                continue
            if not use_ocr and suffix == '.txt' and requested_format != 'docx':
                continue
            if any(item.resolve().is_relative_to(root) for root in output_roots):
                continue
            matched += 1
            out = _new_output(item, raw_output, rel, requested_format=requested_format)
            if out.exists() or item.resolve() == out.resolve():
                continue
            try:
                _safe_document(item, out, use_ocr=use_ocr,
                               source_encoding=source_encoding)
                print(f'[+] Saved: {out}', flush=True)
            except (OSError, ValueError, RuntimeError) as exc:
                failed = True
                print(f'[failed] {item}: {exc}', file=sys.stderr, flush=True)
        if not continuous:
            if matched == 0:
                print(f'[i] No supported input files found in {source}', flush=True)
            return 1 if failed else 0
        time.sleep(60)


def _modern_cli(argv):
    parser = argparse.ArgumentParser(
        prog='main.py',
        description=(
            'Independent parser and OCR runner. Local parse defaults to '
            'Junk/Parser/pdf-parts/ unless PARSER_INPUT_DIR is set.'
        ),
    )
    parser.add_argument('mode', choices=('parse', 'prase', 'ocr'))
    parser.add_argument(
        'input', nargs='?',
        help='Local input file or folder; parse defaults to Junk/Parser/pdf-parts/ when omitted.',
    )
    parser.add_argument(
        'output', nargs='?',
        help='Output file when it has a supported extension; otherwise an output directory.',
    )
    parser.add_argument(
        '--source-encoding', choices=('auto', 'unicode', 'zawgyi-one'), default='auto',
        help='Declare the input encoding when the PDF font is not labelled.',
    )
    formats = parser.add_mutually_exclusive_group()
    formats.add_argument('--txt', action='store_const', const='txt', dest='output_format')
    formats.add_argument('--docx', action='store_const', const='docx', dest='output_format')
    formats.add_argument('--pdf', action='store_const', const='pdf', dest='output_format')
    parser.add_argument('--ssh', action='store_true', help='continuously read the remote queue; parser writes Parquet and combined TXT')
    parser.add_argument('--continuous', action='store_true', help='watch a local input directory')
    service = parser.add_mutually_exclusive_group()
    service.add_argument('--service', action='store_true', help='install and start an independent systemd service')
    service.add_argument('--foreground', action='store_true', help='run the continuous worker in this process')
    args = parser.parse_args(argv)
    mode = 'parse' if args.mode == 'prase' else args.mode
    if args.ssh and (args.input is not None or args.output is not None or args.continuous or args.output_format is not None):
        parser.error('--ssh uses the configured remote directory and fixed output locations; no paths or --continuous')
    if args.ssh and args.source_encoding != 'auto':
        parser.error('--source-encoding applies only to local parsing')
    if mode == 'ocr' and args.source_encoding != 'auto':
        parser.error('--source-encoding applies only to parse mode')
    if args.service and not (args.ssh or args.continuous):
        parser.error('--service requires --ssh or --continuous')
    try:
        auto_service = ((args.ssh or args.continuous) and not args.foreground
                        and os.geteuid() == 0 and Path('/run/systemd/system').is_dir())
        if args.service or auto_service:
            if str(REPO_ROOT) not in sys.path:
                sys.path.insert(0, str(REPO_ROOT))
            from systemd_lib import install_and_start
            command = [sys.executable, '-u', str(Path(__file__).resolve()), mode]
            if args.input is not None:
                input_path = Path(args.input).expanduser()
                # The service runs from the repository root, not the shell's cwd.
                command.append(str(input_path.resolve()) if input_path.exists() else args.input)
            if args.output is not None:
                # The service runs from the repository root; keep the resolved
                # path so .env/CLI values cannot drift with the working directory.
                command.append(str(_inside_junk(args.output)))
            if args.output_format is not None:
                command.append(f'--{args.output_format}')
            if args.ssh:
                command.append('--ssh')
            if args.continuous:
                command.append('--continuous')
            if args.source_encoding != 'auto':
                command.extend(('--source-encoding', args.source_encoding))
            command.append('--foreground')
            install_and_start(f'myangustis-{mode}.service', command, REPO_ROOT)
            return 0
        if args.ssh:
            # The text parser queue never starts OCR; OCR has its own runner.
            if mode == 'parse':
                os.environ['PRASER_OCR'] = 'off'
            from myangustis_parser.workflow.remote_queue import run_forever
            def convert(source, output, which):
                return run_document(source, output, use_ocr=which == 'ocr', log=print)
            run_forever(mode, convert)
            return 0
        # PARSER_INPUT_DIR / PARSER_OCR_INPUT_DIR are already anchored to the
        # project root (never /Junk/ on the filesystem root); a bare CLI
        # filename falls back to the Junk upload folder for its suffix.
        configured = paths.input_dir_from_env(mode)
        if args.input is not None:
            source = resolve_input_path(args.input)
        elif configured is not None:
            source = configured
        elif mode == 'parse':
            source = DEFAULT_PARSE_INPUT_DIR
        else:
            raise ValueError('Provide an input file/folder or set PARSER_OCR_INPUT_DIR.')
        if source is None or not source.exists():
            raise FileNotFoundError(f'Input not found: {source}')
        if source.is_file():
            if args.continuous:
                raise ValueError('--continuous requires an input directory.')
            out = _new_output(source, args.output, requested_format=args.output_format)
            if out.resolve() == source.resolve() or out.exists():
                raise ValueError(f'Refusing to overwrite {out}')
            result = _safe_document(source, out, use_ocr=mode == 'ocr',
                                    source_encoding=args.source_encoding)
            print(f"[+] Saved: {result['file']}")
            return 0
        if not source.is_dir():
            raise ValueError('Input must be a file or a directory.')
        return _run_directory_batch(
            source,
            raw_output=args.output,
            requested_format=args.output_format,
            use_ocr=mode == 'ocr',
            source_encoding=args.source_encoding,
            continuous=args.continuous,
        )
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('\n[paused] interrupted.', file=sys.stderr)
        return 130


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ('parse', 'prase', 'ocr'):
        return _modern_cli(argv)
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.input is None:
        if args.ocr or args.output_format is not None or args.source_encoding != "auto":
            parser.error("an input file or directory is required")
        parser.print_help()
        return 0
    if not args.input.strip():
        parser.error("an input file or directory is required")

    try:
        source = resolve_input_path(args.input)
        if source.is_dir():
            return _run_directory_batch(
                source,
                requested_format=args.output_format,
                use_ocr=args.ocr,
                source_encoding=args.source_encoding,
            )
        fmt = resolve_output_format(source, args.output_format)
        out_path = resolve_output_path(source, fmt)
        result = run_document(
            source,
            out_path,
            use_ocr=args.ocr,
            source_encoding=args.source_encoding,
            log=print,
        )
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
