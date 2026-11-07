"""Regression coverage for the split proofreading test import paths."""

import os
import subprocess
import sys
import unittest
from pathlib import Path

import _paths


class ProofreadingTestPaths(unittest.TestCase):
    def test_paths_point_to_the_current_sources(self):
        self.assertEqual(_paths.ROOT, Path(__file__).resolve().parents[3] / "C.Proofreading" / "main")
        for relative in ("translate/translate.py", "tools/api/rapidapi_translator.py",
                         "tools/quickread/chapter_map.py", "tools/mcp.py"):
            self.assertTrue((_paths.ROOT / relative).is_file(), relative)

    def test_subprocess_imports_share_paths_without_changing_parent_environment(self):
        old = os.environ.get("PYTHONPATH")
        env = _paths.subprocess_env(dict(os.environ, TEST_MARKER="retained"))
        result = subprocess.run(
            [sys.executable, "-c", "import rapidapi_translator, translate, chapter_map"],
            env=env, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(env["TEST_MARKER"], "retained")
        self.assertEqual(os.environ.get("PYTHONPATH"), old)


if __name__ == "__main__":
    unittest.main()
