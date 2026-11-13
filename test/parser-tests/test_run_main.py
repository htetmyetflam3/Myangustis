"""Tests for B.Parser/main.py, Junk/Parser path alignment, and OCR/parse dispatch."""

from __future__ import annotations

import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
RUN_MAIN_PATH = ROOT / "B.Parser" / "main.py"
TEST_PARSER_DIR = Path(__file__).resolve().parent


def _install_test_stubs_if_missing() -> None:
    """Allow running unit tests in environments without optional binary wheels."""
    engine_arch = str(ROOT / "A.Engine" / "architecture")
    if engine_arch not in sys.path:
        sys.path.insert(0, engine_arch)
    if "myangustis_parser" not in sys.modules:
        try:
            import myangustis_parser  # noqa: F401
        except ModuleNotFoundError:
            arch_init = ROOT / "B.Parser" / "architecture" / "__init__.py"
            spec = importlib.util.spec_from_file_location(
                "myangustis_parser",
                arch_init,
                submodule_search_locations=[str(arch_init.parent)],
            )
            package = importlib.util.module_from_spec(spec)
            sys.modules["myangustis_parser"] = package
            spec.loader.exec_module(package)
    try:
        import pypdf  # noqa: F401
    except ModuleNotFoundError:
        pypdf_mod = types.ModuleType("pypdf")
        pypdf_mod.PdfReader = object
        pypdf_mod.PdfWriter = object
        errors_mod = types.ModuleType("pypdf.errors")
        errors_mod.PdfReadError = Exception
        errors_mod.WrongPasswordError = Exception
        sys.modules["pypdf"] = pypdf_mod
        sys.modules["pypdf.errors"] = errors_mod


_install_test_stubs_if_missing()

if str(TEST_PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(TEST_PARSER_DIR))

from myangustis_parser.entry import cli, index, interop, manager  # noqa: E402
from myangustis_parser.normalize import beautify, cleanup, pos_scan  # noqa: E402
from myangustis_parser.resources import paths  # noqa: E402
from myangustis_parser.workflow import ocr  # noqa: E402
import test_ocr  # noqa: E402


def _load_run_main():
    spec = importlib.util.spec_from_file_location("b_parser_run_main", RUN_MAIN_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["b_parser_run_main"] = module
    spec.loader.exec_module(module)
    return module


run_main = _load_run_main()


class ParserPathsTests(unittest.TestCase):
    def test_default_paths_match_junk_parser_tree(self):
        expected_root = ROOT / "Junk" / "Parser"
        self.assertEqual(paths.RUNTIME_ROOT, expected_root)
        if not os.environ.get("PRASER_UPLOAD_DIR"):
            self.assertEqual(paths.UPLOAD_DIR, expected_root / "upload")
            self.assertEqual(paths.PDF_INPUT_DIR, expected_root / "upload" / "pdf")
            self.assertEqual(paths.DOCX_INPUT_DIR, expected_root / "upload" / "docx")
        if not os.environ.get("PRASER_OUTPUT_DIR"):
            self.assertEqual(paths.OUTPUT_DIR, expected_root / "output")
            self.assertEqual(paths.DEFAULT_OUTPUT_DIR, expected_root / "output")
            self.assertEqual(paths.TXT_OUTPUT_DIR, expected_root / "output" / "txt")
            self.assertEqual(paths.DOCX_OUTPUT_DIR, expected_root / "output" / "docx")
            self.assertEqual(paths.PDF_OUTPUT_DIR, expected_root / "output" / "pdf")

        self.assertEqual(paths.input_dir_for(".pdf"), paths.PDF_INPUT_DIR)
        self.assertEqual(paths.input_dir_for(".docx"), paths.DOCX_INPUT_DIR)
        self.assertEqual(paths.input_dir_for(".doc"), paths.DOCX_INPUT_DIR)
        self.assertEqual(paths.input_dir_for(".png"), paths.UPLOAD_DIR)
        self.assertEqual(paths.output_dir_for("txt"), paths.TXT_OUTPUT_DIR)
        self.assertEqual(paths.output_dir_for("docx"), paths.DOCX_OUTPUT_DIR)
        self.assertEqual(paths.output_dir_for("pdf"), paths.PDF_OUTPUT_DIR)
        with self.assertRaises(ValueError):
            paths.output_dir_for("html")

    def test_env_overrides_work_for_upload_and_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {
                **os.environ,
                "PRASER_UPLOAD_DIR": str(Path(tmp) / "up"),
                "PRASER_OUTPUT_DIR": str(Path(tmp) / "out"),
            }
            code = (
                "import importlib.util, json, sys; "
                f"sys.path.insert(0, {str(ROOT / 'A.Engine' / 'architecture')!r}); "
                f"s = importlib.util.spec_from_file_location('myangustis_parser', {str(ROOT / 'B.Parser' / 'architecture' / '__init__.py')!r}, submodule_search_locations=[{str(ROOT / 'B.Parser' / 'architecture')!r}]); "
                "p = importlib.util.module_from_spec(s); sys.modules['myangustis_parser'] = p; s.loader.exec_module(p); "
                "from myangustis_parser.resources import paths; "
                "print(json.dumps([str(paths.PDF_INPUT_DIR), str(paths.DOCX_INPUT_DIR), str(paths.TXT_OUTPUT_DIR), str(paths.DOCX_OUTPUT_DIR), str(paths.PDF_OUTPUT_DIR)]))"
            )
            out = subprocess.check_output([sys.executable, "-c", code], env=env, text=True)
            import json
            got = json.loads(out)
            self.assertEqual(got, [
                str(Path(tmp) / "up" / "pdf"),
                str(Path(tmp) / "up" / "docx"),
                str(Path(tmp) / "out" / "txt"),
                str(Path(tmp) / "out" / "docx"),
                str(Path(tmp) / "out" / "pdf"),
            ])


class RunnerCliTests(unittest.TestCase):
    def test_no_args_prints_help_and_exits_zero(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = run_main.main([])
        self.assertEqual(rc, 0)
        self.assertIn("usage: main.py", buf.getvalue())

        cli_buf = io.StringIO()
        with redirect_stdout(cli_buf):
            cli_rc = cli.main([])
        self.assertEqual(cli_rc, 0)
        self.assertIn("usage:", cli_buf.getvalue())

        help_buf = io.StringIO()
        with redirect_stdout(help_buf):
            with self.assertRaises(SystemExit) as ctx:
                run_main.main(["--help"])
        self.assertEqual(ctx.exception.code, 0)
        self.assertIn("usage: main.py", help_buf.getvalue())

    def test_rejects_out_of_scope_flags_and_conflicting_formats(self):
        for bad_argv in (
            ["--ocr"],
            ["--txt"],
            ["book.pdf", "--txt", "--pdf"],
            ["book.pdf", "--docx", "--txt"],
            ["book.pdf", "--method", "manual"],
            ["book.pdf", "--cleanup", "yes"],
            ["book.pdf", "--out", "out.txt"],
        ):
            with self.subTest(argv=bad_argv), redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as ctx:
                    run_main.main(bad_argv)
                self.assertEqual(ctx.exception.code, 2)

        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cli.main(["book.pdf", "--cleanup", "yes"])
            self.assertEqual(ctx.exception.code, 2)
        self.assertFalse(hasattr(cli, "ask_cleanup_once"))

        pdf_tool_src = (ROOT / "B.Parser" / "tools" / "svg" / "pdf_tool.py").read_text(encoding="utf-8")
        for removed in ("--admin", "--auto-approve", "--cleanup"):
            self.assertNotIn(removed, pdf_tool_src)

    def test_resolves_bare_inputs_and_inherited_output_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            upload_dir = root / "upload"
            pdf_in = upload_dir / "pdf"
            docx_in = upload_dir / "docx"
            out_dir = root / "output"
            txt_out = out_dir / "txt"
            docx_out = out_dir / "docx"
            pdf_out = out_dir / "pdf"
            pdf_in.mkdir(parents=True)
            docx_in.mkdir(parents=True)

            sample_pdf = pdf_in / "book.pdf"
            sample_docx = docx_in / "notes.docx"
            sample_img = upload_dir / "scan.png"
            sample_pdf.write_bytes(b"%PDF-1.4\n")
            sample_docx.write_bytes(b"PK")
            sample_img.write_bytes(b"PNG")

            with patch.object(paths, "UPLOAD_DIR", upload_dir), \
                 patch.object(paths, "PDF_INPUT_DIR", pdf_in), \
                 patch.object(paths, "DOCX_INPUT_DIR", docx_in), \
                 patch.object(paths, "OUTPUT_DIR", out_dir), \
                 patch.object(paths, "TXT_OUTPUT_DIR", txt_out), \
                 patch.object(paths, "DOCX_OUTPUT_DIR", docx_out), \
                 patch.object(paths, "PDF_OUTPUT_DIR", pdf_out):

                # Bare PDF -> omitted format inherits pdf -> output/pdf/book.pdf
                src_pdf = run_main.resolve_input_path("book.pdf")
                self.assertEqual(src_pdf, sample_pdf)
                fmt_pdf = run_main.resolve_output_format(src_pdf, None)
                self.assertEqual(fmt_pdf, "pdf")
                self.assertEqual(run_main.resolve_output_path(src_pdf, fmt_pdf), pdf_out / "book.pdf")

                # Bare PDF with --txt / --docx
                self.assertEqual(
                    run_main.resolve_output_path(src_pdf, run_main.resolve_output_format(src_pdf, "txt")),
                    txt_out / "book.txt",
                )
                self.assertEqual(
                    run_main.resolve_output_path(src_pdf, run_main.resolve_output_format(src_pdf, "docx")),
                    docx_out / "book.docx",
                )

                # Bare DOCX -> omitted format inherits docx -> output/docx/notes.docx
                src_docx = run_main.resolve_input_path("notes.docx")
                self.assertEqual(src_docx, sample_docx)
                fmt_docx = run_main.resolve_output_format(src_docx, None)
                self.assertEqual(fmt_docx, "docx")
                self.assertEqual(run_main.resolve_output_path(src_docx, fmt_docx), docx_out / "notes.docx")

                # Bare image -> omitted format falls back to txt -> output/txt/scan.txt
                src_img = run_main.resolve_input_path("scan.png")
                self.assertEqual(src_img, sample_img)
                fmt_img = run_main.resolve_output_format(src_img, None)
                self.assertEqual(fmt_img, "txt")
                self.assertEqual(run_main.resolve_output_path(src_img, fmt_img), txt_out / "scan.txt")

                # Explicit path bypasses upload dir
                explicit = root / "other" / "custom.pdf"
                explicit.parent.mkdir()
                explicit.write_bytes(b"%PDF-1.4\n")
                self.assertEqual(run_main.resolve_input_path(str(explicit)), explicit)

                # Missing bare PDF fails pointing to upload/pdf/
                with self.assertRaisesRegex(FileNotFoundError, str(pdf_in / "missing.pdf")):
                    run_main.resolve_input_path("missing.pdf")

    def test_dispatches_parse_without_ocr_flag_and_ocr_with_ocr_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf_in = root / "upload" / "pdf"
            docx_in = root / "upload" / "docx"
            out_dir = root / "output"
            pdf_in.mkdir(parents=True)
            docx_in.mkdir(parents=True)

            book_pdf = pdf_in / "story.pdf"
            book_pdf.write_bytes(b"%PDF-1.4\n")
            book_docx = docx_in / "chapter.docx"
            book_docx.write_bytes(b"PK")

            with patch.object(paths, "PDF_INPUT_DIR", pdf_in), \
                 patch.object(paths, "DOCX_INPUT_DIR", docx_in), \
                 patch.object(paths, "TXT_OUTPUT_DIR", out_dir / "txt"), \
                 patch.object(paths, "DOCX_OUTPUT_DIR", out_dir / "docx"), \
                 patch.object(paths, "PDF_OUTPUT_DIR", out_dir / "pdf"):

                # Parsing mode: calls index.convert without forcing method
                with patch.object(index, "convert", return_value={"file": str(out_dir / "pdf" / "story.pdf"), "pages": 2, "counts": {"UNICODE": 2}}) as conv, \
                     patch.object(index, "dispatch_ocr") as ocr_call, \
                     redirect_stdout(io.StringIO()):
                    rc = run_main.main(["story.pdf"])
                self.assertEqual(rc, 0)
                ocr_call.assert_not_called()
                conv.assert_called_once()
                self.assertEqual(conv.call_args.args[0], book_pdf)
                self.assertEqual(conv.call_args.args[1], out_dir / "pdf" / "story.pdf")
                self.assertNotIn("method", conv.call_args.kwargs)
                self.assertNotIn("apply_cleanup", conv.call_args.kwargs)

                # Parsing mode on DOCX with omitted format -> output/docx/chapter.docx
                with patch.object(index, "convert", return_value={"file": str(out_dir / "docx" / "chapter.docx"), "pages": 1, "counts": {"ZAWGYI": 1}}) as conv, \
                     redirect_stdout(io.StringIO()):
                    rc = run_main.main(["chapter.docx"])
                self.assertEqual(rc, 0)
                self.assertEqual(conv.call_args.args[0], book_docx)
                self.assertEqual(conv.call_args.args[1], out_dir / "docx" / "chapter.docx")
                self.assertNotIn("apply_cleanup", conv.call_args.kwargs)

                # OCR mode: calls index.dispatch_ocr (not convert)
                with patch.object(index, "convert") as conv, \
                     patch.object(index, "dispatch_ocr", return_value={"file": str(out_dir / "txt" / "story.txt"), "pages": 2, "counts": {"UNKNOWN": 2}, "ocrPages": [1, 2]}) as ocr_call, \
                     redirect_stdout(io.StringIO()):
                    rc = run_main.main(["story.pdf", "--ocr", "--txt"])
                self.assertEqual(rc, 0)
                conv.assert_not_called()
                ocr_call.assert_called_once()
                self.assertEqual(ocr_call.call_args.args[0], book_pdf)
                self.assertEqual(ocr_call.call_args.args[1], out_dir / "txt" / "story.txt")
                self.assertNotIn("apply_cleanup", ocr_call.call_args.kwargs)

    def test_public_entry_apis_expose_no_cleanup_toggle(self):
        import inspect

        for fn in (
            index.convert,
            index.parse_decoding,
            index.write_output_file,
            index.dispatch_ocr,
            manager.dispatch_path,
            manager.dispatch_bytes,
            manager.dispatch_stream,
            manager.dispatch_ocr,
        ):
            self.assertNotIn("apply_cleanup", inspect.signature(fn).parameters, fn.__name__)

        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            out = work / "out.txt"
            src = work / "in.pdf"
            src.write_bytes(b"%PDF-1.4\n")
            with patch.object(manager, "dispatch_path", return_value={"file": str(out), "pages": 1, "counts": {}}) as dp:
                interop.run_job({
                    "inPath": str(src),
                    "outPath": str(out),
                    "applyCleanup": False,
                })
            self.assertNotIn("apply_cleanup", dp.call_args.kwargs)


class ManagerOcrAndDocxTests(unittest.TestCase):
    def setUp(self):
        self.patches = [
            patch.object(beautify, "_bases", return_value=frozenset("ကခဂ")),
            patch.object(cleanup, "_glue", return_value=frozenset("\u200b")),
            patch.object(cleanup, "_imposter_matcher", return_value=({}, {})),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in reversed(self.patches)])

    def test_docx_can_write_docx_and_txt_and_passes_pages_to_pos_scan(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            binary = test_ocr.make_stub(work)
            docx_path = work / "sample.docx"
            test_ocr.image_docx(docx_path, test_ocr.jpeg_bytes())

            seen_scan_args = []

            def fake_scan(pages):
                seen_scan_args.append(pages)
                return {"memory": [], "unknownCount": 0, "contextCount": 0}

            with patch.dict(os.environ, {
                "PATH": str(work) + os.pathsep + os.environ.get("PATH", ""),
                "PRASER_TESSERACT_BIN": str(binary),
                "PRASER_OCR_LANG": "mya",
            }), patch.object(pos_scan, "scan_pages_sync", side_effect=fake_scan):
                out_docx = work / "nested" / "sample.docx"
                res_docx = index.convert(docx_path, out_docx, include_text=True)
                self.assertTrue(out_docx.is_file())
                self.assertEqual(res_docx["from"], "docx")
                self.assertEqual(res_docx["to"], "docx")
                self.assertEqual(res_docx["ocrPages"], ["0001"])
                self.assertNotIn("applyCleanup", res_docx)
                # Engine POS scan receives in-memory page dicts, never an output file path.
                self.assertEqual(len(seen_scan_args), 1)
                self.assertIsInstance(seen_scan_args[0], list)
                self.assertIn("text", seen_scan_args[0][0])

                out_txt = work / "nested" / "sample.txt"
                res_txt = index.convert(docx_path, out_txt, include_text=True)
                self.assertTrue(out_txt.is_file())
                self.assertEqual(res_txt["to"], "txt")
                self.assertIn("OCR-PAGE-", out_txt.read_text(encoding="utf-8"))

    def test_dispatch_ocr_runs_across_all_pdf_pages_including_text_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            binary = test_ocr.make_stub(work)
            scan_pdf = work / "mixed.pdf"
            # Page with both raster image and embedded text: --ocr still runs OCR.
            test_ocr.image_pdf(scan_pdf, pages=2, with_text=True)

            with patch.dict(os.environ, {
                "PATH": str(work) + os.pathsep + os.environ.get("PATH", ""),
                "PRASER_TESSERACT_BIN": str(binary),
                "PRASER_OCR_LANG": "mya",
            }), patch.object(pos_scan, "scan_pages_sync", return_value={"memory": [], "unknownCount": 0, "contextCount": 0}):
                out_txt = work / "out" / "mixed.txt"
                result = index.dispatch_ocr(scan_pdf, out_txt, include_text=True)
                self.assertTrue(out_txt.is_file())
                self.assertEqual(result["from"], "ocr")
                self.assertEqual(result["to"], "txt")
                self.assertEqual(result["pages"], 2)
                self.assertEqual(result["ocrPages"], [1, 2])
                self.assertNotIn("applyCleanup", result)
                self.assertIn("OCR-PAGE-", out_txt.read_text(encoding="utf-8"))

                out_docx = work / "out" / "mixed.docx"
                docx_res = index.dispatch_ocr(scan_pdf, out_docx, include_text=False)
                self.assertTrue(out_docx.is_file())
                self.assertEqual(docx_res["to"], "docx")

    def test_dispatch_ocr_rejects_docx_and_main_surfaces_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            docx_in = work / "upload" / "docx"
            docx_in.mkdir(parents=True)
            sample = docx_in / "doc.docx"
            test_ocr.image_docx(sample, test_ocr.jpeg_bytes())
            with patch.object(paths, "DOCX_INPUT_DIR", docx_in), \
                 patch.object(paths, "DOCX_OUTPUT_DIR", work / "output" / "docx"), \
                 redirect_stderr(io.StringIO()) as err:
                rc = run_main.main(["doc.docx", "--ocr"])
            self.assertEqual(rc, 1)
            self.assertIn("OCR mode supports PDF and image inputs", err.getvalue())

    def test_render_text_returns_written_path_without_nameerror(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            src = work / "parsed.txt"
            src.write_text("Hello world\n\nSecond paragraph", encoding="utf-8")
            dst = work / "sub" / "parsed.docx"
            result = manager.render_text(src, dst)
            self.assertEqual(result["file"], str(dst))
            self.assertEqual(result["to"], "docx")
            self.assertTrue(dst.is_file())


if __name__ == "__main__":
    unittest.main()
