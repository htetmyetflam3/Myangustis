"""Comparison data and the engine's current grammar format."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROOT = REPO / "C.Proofreading" / "architecture"
COMPARE = ROOT / "tools/fallacy-comparison/compare.py"
RULES = REPO / "A.Engine/architecture/myangustis_engine/knowledge/isTreasure/mainrules.json"
spec = importlib.util.spec_from_file_location("comparison_catalog_for_test", COMPARE)
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)

# The nine sections of the JSON head that the active catalog must carry through.
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
    def test_rules_head_parses_and_reaches_the_active_catalog(self):
        # Exercise the native comparison catalog and secure Engine loader.
        with tempfile.TemporaryDirectory() as scratch:
            data = comparison.knowledge(Path(scratch))

        sizes = data["grammar_section_sizes"]
        self.assertTrue(set(SECTIONS).issubset(sizes))
        self.assertTrue(all(sizes.values()), sizes)
        self.assertEqual(sizes["simple_sentence_patterns"], 42)
        self.assertIn("resolution", data)
        self.assertNotIn("pos_codes", data)
        self.assertTrue(data["bindings"])
        self.assertTrue(all("pos_code" not in binding for binding in data["bindings"]))
        self.assertIsNone(data["wasm_sha256"])

        source = comparison.engine_data("master-info")
        self.assertEqual(data["sources"]["master"], source["master"])
        self.assertEqual(data["sources"]["master_sha256"], source["sha256"])

    def test_rules_are_current_json(self):
        rules = json.loads(RULES.read_text(encoding="utf-8"))
        self.assertTrue(set(SECTIONS).issubset(rules))
        self.assertTrue(all(rules[section] for section in SECTIONS))
        self.assertEqual(len(rules["simple_sentence_patterns"]), 42)


if __name__ == "__main__":
    unittest.main()
