"""The comparison-data adapter can read `mainrules.js` as it actually is.

`Engine/knowledge/isTreasure/mainrules.js` is a JSON object followed by a
JavaScript block — `const MYANMAR_GRAMMAR_SEQUENCES = [...]`, single-quoted and
commented. The adapter used to call `JSON.parse` on the whole file, so it threw
`Expected double-quoted property name` before writing anything, and every
consumer above it (`mt/mt_compare.py --profile`, `mt/mt_compare.py --input`)
died at the first step.

The head also carries one trailing comma from hand editing, which JSON rejects.
Both are handled in the adapter without evaluating JavaScript: the sequence
array is the engine's business and `mt/mt_compare.py` reads it as text.
"""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "Proofreading" / "main"
SCRIPT = ROOT / "Engine/export-comparison-data.mjs"
GUARD = ROOT / "scraper/wasm/box/runtime-guard.mjs"
RULES = ROOT / "Engine/knowledge/isTreasure/mainrules.js"

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
                ["node", "--import", str(GUARD), str(SCRIPT), str(out)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=300,
            )
            self.assertEqual(run.returncode, 0, run.stderr[-2000:])
            data = json.loads(out.read_text(encoding="utf-8"))

        sizes = data["grammar_section_sizes"]
        self.assertEqual(sorted(sizes), sorted(SECTIONS))
        self.assertTrue(all(sizes.values()), sizes)
        self.assertEqual(sizes["simple_sentence_patterns"], 42)
        self.assertIn("resolution", data)

    def test_the_head_is_not_valid_json_whole(self):
        """Guard the assumption: if the file ever becomes pure JSON, say so."""
        text = RULES.read_text(encoding="utf-8")
        self.assertIn("const MYANMAR_GRAMMAR_SEQUENCES", text)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(text)


if __name__ == "__main__":
    unittest.main()
