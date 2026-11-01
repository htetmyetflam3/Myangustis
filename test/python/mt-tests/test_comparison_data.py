"""Comparison data and the engine's current grammar format."""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "C.Proofreading" / "main"
SCRIPT = ROOT / "tools/Burmese-Pos/export-comparison-data.js"
RULES = Path(__file__).resolve().parents[3] / "Architecture/Engine/knowledge/isTreasure/mainrules.js"

# The nine sections of the JSON head that the adapter must carry through.
SECTIONS = (
    "minimal_sentence_patterns",
    "clause_types",
    "clause_taxonom",
    "sentence_classification",
    "simple_sentence_patterns",
    "complex_sentence_connection",
    "word_order_constraints",
    "compound_sentence_patterns",
    "analysis_procedure",
)


class ComparisonData(unittest.TestCase):
    @unittest.skipIf(shutil.which("node") is None, "node is not installed")
    def test_rules_head_parses_and_reaches_the_output(self):
        with tempfile.TemporaryDirectory() as scratch:
            out = Path(scratch) / "comparison.json"
            run = subprocess.run(
                ["node", str(SCRIPT), str(out)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=300,
            )
            self.assertEqual(run.returncode, 0, run.stderr[-2000:])
            data = json.loads(out.read_text(encoding="utf-8"))

        sizes = data["grammar_section_sizes"]
        self.assertTrue(set(SECTIONS).issubset(sizes))
        self.assertTrue(all(sizes.values()), sizes)
        self.assertEqual(sizes["simple_sentence_patterns"], 42)
        self.assertIn("resolution", data)

    def test_rules_are_current_json(self):
        rules = json.loads(RULES.read_text(encoding="utf-8"))
        self.assertTrue(set(SECTIONS).issubset(rules))
        self.assertTrue(all(rules[section] for section in SECTIONS))
        self.assertEqual(len(rules["simple_sentence_patterns"]), 42)


if __name__ == "__main__":
    unittest.main()
