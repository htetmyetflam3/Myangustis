"""Every .env path is anchored to the project root, never the filesystem root.

A value a human writes in the root `.env` thinks in workspace terms:

    PARSER_LOG_ENABLED=on
    PARSER_LOG_FILE=/log/
    PARSER_INPUT_DIR=/Junk/Parser/upload/
    PARSER_OCR_INPUT_DIR=/Junk/Parser/upload/
    PARSER_DIAGNOSTICS=on

The leading slash means the project, otherwise `/Junk/Parser/upload/` resolves
against `/` on disk and nothing is found. These tests pin that rule for the
shared loader (`index-path.py`), the parser's path module, and the CLI.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN_MAIN_PATH = ROOT / "B.Parser" / "main.py"

sys.path.insert(0, str(ROOT / "A.Engine" / "architecture"))
from myangustis_parser.resources import paths  # noqa: E402


def _import_index_path():
    """The workspace loader, loaded the same way the parser loads it."""
    module = sys.modules.get("index-path")
    if module is not None:
        return module
    spec = importlib.util.spec_from_file_location("index-path", ROOT / "index-path.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["index-path"] = module
    spec.loader.exec_module(module)
    return module


INDEX_PATH = _import_index_path()

PARSER_BOOTSTRAP = (
    "import importlib.util, json, os, sys; "
    f"sys.path.insert(0, {str(ROOT / 'A.Engine' / 'architecture')!r}); "
    f"spec = importlib.util.spec_from_file_location('myangustis_parser', "
    f"{str(ROOT / 'B.Parser' / 'architecture' / '__init__.py')!r}, "
    f"submodule_search_locations=[{str(ROOT / 'B.Parser' / 'architecture')!r}]); "
    "package = importlib.util.module_from_spec(spec); "
    "sys.modules['myangustis_parser'] = package; spec.loader.exec_module(package); "
)


class SharedAnchorTests(unittest.TestCase):
    """index-path.py and paths.py agree on one anchoring rule."""

    def test_slash_leading_values_are_project_paths(self):
        for module, resolve in ((INDEX_PATH, INDEX_PATH.anchor), (paths, paths.project_path)):
            with self.subTest(module=module.__name__):
                self.assertEqual(resolve("/Junk/Parser/upload/"),
                                 ROOT / "Junk" / "Parser" / "upload")
                self.assertEqual(resolve("/log/"), ROOT / "log")
                self.assertEqual(resolve("./output/"), ROOT / "output")
                self.assertEqual(resolve("log/debug.log"), ROOT / "log" / "debug.log")
                self.assertIsNone(resolve(""))
                self.assertIsNone(resolve("   "))

    def test_explicit_escapes_are_kept(self):
        home = Path("~/parser").expanduser()
        for resolve in (INDEX_PATH.anchor, paths.project_path):
            with self.subTest(resolve=resolve):
                self.assertEqual(resolve("~/parser"), home)
                self.assertEqual(resolve("abs:/srv/parser/out"), Path("/srv/parser/out"))
                self.assertEqual(resolve("file:/srv/parser/out"), Path("/srv/parser/out"))

    def test_an_existing_host_directory_is_a_deployment_path(self):
        with tempfile.TemporaryDirectory() as temp:
            for resolve in (INDEX_PATH.anchor, paths.project_path):
                with self.subTest(resolve=resolve):
                    self.assertEqual(resolve(temp), Path(temp))
                    self.assertEqual(resolve(Path(temp) / "new" / "file.log"),
                                     Path(temp) / "new" / "file.log")

    def test_missing_root_child_is_never_a_filesystem_path(self):
        for resolve in (INDEX_PATH.anchor, paths.project_path):
            with self.subTest(resolve=resolve):
                missing = Path("/") / "myangustis-anchor-does-not-exist"
                self.assertEqual(resolve(str(missing)),
                                 ROOT / "myangustis-anchor-does-not-exist")

    def test_path_root_override_moves_the_anchor(self):
        with tempfile.TemporaryDirectory() as temp:
            saved = os.environ.get("PRASER_PATH_ROOT")
            os.environ["PRASER_PATH_ROOT"] = temp
            try:
                self.assertEqual(paths.project_path("/log/"), Path(temp) / "log")
            finally:
                if saved is None:
                    os.environ.pop("PRASER_PATH_ROOT", None)
                else:
                    os.environ["PRASER_PATH_ROOT"] = saved


class WorkingPathTests(unittest.TestCase):
    """Parser input/output lives under Junk; the value may already say so."""

    def test_relative_and_slash_leading_values_land_in_junk(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            for value in ("output", "./output/", "/output/", "Parser/output"):
                with self.subTest(value=value):
                    expected = base / "Junk" / "output" if "Parser" not in value \
                        else base / "Junk" / "Parser" / "output"
                    self.assertEqual(paths.working_path(value, base=base), expected)

    def test_values_that_already_name_junk_keep_their_place(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            for value in ("Junk/Parser/upload", "/Junk/Parser/upload/"):
                with self.subTest(value=value):
                    self.assertEqual(paths.working_path(value, base=base),
                                     base / "Junk" / "Parser" / "upload")

    def test_output_directory_for_each_format(self):
        self.assertEqual(paths.output_dir_for("txt").name, "txt")
        self.assertEqual(paths.output_dir_for(".DOCX").name, "docx")
        self.assertEqual(paths.output_dir_for("pdf").name, "pdf")
        self.assertEqual(paths.output_dir_for("txt").parent, paths.OUTPUT_DIR)
        with self.assertRaises(ValueError):
            paths.output_dir_for("html")


class ParserEnvironmentTests(unittest.TestCase):
    """The .env a user actually writes resolves into the checkout."""

    def _paths(self, **env):
        code = (
            PARSER_BOOTSTRAP
            + "from myangustis_parser.resources import paths; "
            "from myangustis_parser.workflow import lane_log; "
            "print(json.dumps({'upload': str(paths.UPLOAD_DIR), "
            "'output': str(paths.OUTPUT_DIR), "
            "'input': str(paths.input_dir_from_env('parse')), "
            "'ocr_input': str(paths.input_dir_from_env('ocr')), "
            "'log': str(lane_log.log_file()), "
            "'root': str(paths.REPO_ROOT)}))"
        )
        out = subprocess.check_output(
            [sys.executable, "-c", code],
            env={**os.environ, **env},
            cwd=tempfile.gettempdir(),  # run from elsewhere: cwd must not matter
            text=True,
        )
        return json.loads(out)

    def test_dotenv_values_from_the_report_land_inside_the_project(self):
        got = self._paths(
            PARSER_LOG_ENABLED="on",
            PARSER_LOG_FILE="/log/",
            PARSER_INPUT_DIR="/Junk/Parser/upload/",
            PARSER_OCR_INPUT_DIR="/Junk/Parser/upload/",
            PARSER_DIAGNOSTICS="on",
        )
        root = Path(got["root"])
        self.assertEqual(root, ROOT)
        self.assertEqual(got["input"], str(ROOT / "Junk" / "Parser" / "upload"))
        self.assertEqual(got["ocr_input"], str(ROOT / "Junk" / "Parser" / "upload"))
        # A bare folder means the default decision-log filename inside it.
        self.assertEqual(got["log"], str(ROOT / "log" / "lane-decisions.log"))
        self.assertFalse(Path("/log").exists() and Path("/log").is_symlink())

    def test_relative_output_override_is_anchored_to_junk(self):
        got = self._paths(PRASER_OUTPUT_DIR="./output/")
        self.assertEqual(got["output"], str(ROOT / "Junk" / "output"))

    def test_absolute_upload_override_naming_junk_is_not_doubled(self):
        got = self._paths(PRASER_UPLOAD_DIR="/Junk/Parser/upload/")
        self.assertEqual(got["upload"], str(ROOT / "Junk" / "Parser" / "upload"))

    def test_root_dotenv_is_loaded_for_library_callers(self):
        """.env is read even when only the path module is imported."""
        with tempfile.TemporaryDirectory() as temp:
            dotenv = Path(temp) / ".env"
            dotenv.write_text("PARSER_LOG_ENABLED=on\nPARSER_LOG_FILE=/log/\n")
            code = (
                PARSER_BOOTSTRAP
                + "import shutil; from myangustis_parser.resources import paths; "
                f"shutil.copyfile({str(dotenv)!r}, paths.REPO_ROOT / '.env'); "
                "paths.load_workspace_env(); "
                "from myangustis_parser.workflow import lane_log; "
                "print(json.dumps([str(lane_log.log_file()), str(paths.REPO_ROOT)]))"
            )
            target = ROOT / ".env"
            existed = target.exists()
            backup = target.read_bytes() if existed else b""
            try:
                out = subprocess.check_output(
                    [sys.executable, "-c", code],
                    env={k: v for k, v in os.environ.items()
                         if not k.startswith(("PARSER_", "PRASER_"))},
                    text=True,
                )
            finally:
                if existed:
                    target.write_bytes(backup)
                else:
                    target.unlink(missing_ok=True)
            log_file, root = json.loads(out)
            self.assertEqual(Path(log_file), ROOT / "log" / "lane-decisions.log")
            self.assertEqual(Path(root), ROOT)


class CommandLineAnchoringTests(unittest.TestCase):
    """The CLI resolves env and argument paths the same way."""

    def _run(self, *argv, **env):
        return subprocess.run(
            [sys.executable, str(RUN_MAIN_PATH), *argv],
            capture_output=True, text=True, cwd=tempfile.gettempdir(),
            env={**os.environ, **env},
        )

    def test_bare_filename_is_found_in_the_upload_folder(self):
        written = ROOT / "Junk" / "Parser" / "output" / "txt" / "zawgyi_fixture.docx"
        written.unlink(missing_ok=True)
        proc = self._run("parse", "zawgyi_fixture.docx", "/Parser/output/txt/")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(written.is_file(), proc.stdout + proc.stderr)
        written.unlink()

    def test_env_input_directory_drives_a_batch_run(self):
        with tempfile.TemporaryDirectory() as temp:
            upload = Path(temp) / "upload"
            (upload / "docx").mkdir(parents=True)
            (upload / "docx" / "zawgyi_fixture.docx").write_bytes(
                (ROOT / "Junk" / "Parser" / "upload" / "docx" / "zawgyi_fixture.docx").read_bytes())
            output = Path(temp) / "out"
            output.mkdir()
            proc = self._run("parse", PARSER_INPUT_DIR=str(upload),
                             PRASER_OUTPUT_DIR=str(output))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue(any(output.rglob("*.docx")), proc.stdout + proc.stderr)

    def test_slash_leading_output_never_escapes_to_the_filesystem_root(self):
        proc = self._run("parse", "zawgyi_fixture.docx", "/myangustis-anchor-output/")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(Path("/myangustis-anchor-output").exists())
        written = ROOT / "Junk" / "myangustis-anchor-output" / "zawgyi_fixture.docx"
        self.assertTrue(written.is_file(), proc.stdout + proc.stderr)
        for leftover in written.parent.glob("*"):
            leftover.unlink()
        written.parent.rmdir()

    def test_missing_input_reports_the_upload_path(self):
        proc = self._run("parse", "missing.pdf")
        self.assertEqual(proc.returncode, 1)
        self.assertIn(str(ROOT / "Junk" / "Parser" / "upload" / "pdf" / "missing.pdf"),
                      proc.stderr)


if __name__ == "__main__":
    unittest.main()
