"""`--engine cmd`: any installed translator behind a command template."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "Proofreading" / "main"
sys.path.insert(0, str(ROOT / "mt"))

import translate  # noqa: E402


class CommandEngineTests(unittest.TestCase):
    def test_stdin_template(self):
        engine = translate.CommandEngine("zh", "my", "sed 's/^/MY:/'")
        self.assertEqual(engine.available(), (True, "sed 's/^/MY:/'"))
        self.assertEqual(engine.translate(["你好", "再见"], "zh", "my"),
                         ["MY:你好", "MY:再见"])

    def test_text_placeholder(self):
        engine = translate.CommandEngine("zh", "my", "printf '%s' {text}")
        self.assertEqual(engine.translate(["你好"], "zh", "my"), ["你好"])

    def test_codes_substituted(self):
        engine = translate.CommandEngine("zh", "my",
                                         "printf '%s-%s:%s' {source} {target} {text}")
        self.assertEqual(engine.translate(["x"], "zh", "my"), ["zh-my:x"])

    def test_missing_template_is_unavailable(self):
        ok, detail = translate.CommandEngine("zh", "my", "").available()
        self.assertFalse(ok)
        self.assertIn("MT-RESTORE.md", detail)

    def test_failure_is_loud(self):
        engine = translate.CommandEngine("zh", "my", "false")
        with self.assertRaises(RuntimeError) as raised:
            engine.translate(["你好"], "zh", "my")
        self.assertIn("exited", str(raised.exception))

    def test_resolve_routes_cmd(self):
        engine = translate.resolve("cmd", "en", "my", "cat")
        self.assertIsInstance(engine, translate.CommandEngine)
        self.assertEqual((engine.source, engine.target), ("en", "my"))


if __name__ == "__main__":
    unittest.main()
