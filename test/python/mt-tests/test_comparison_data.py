"""Comparison data and the engine's current grammar format."""
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ROOT = REPO / "C.Proofreading" / "main"
COMPARE = ROOT / "tools/fallacy-comparison/compare.py"
OLD_EXPORTER = ROOT / "tools/Burmese-Pos/export-comparison-data.js"
DATA_BRIDGE = REPO / "tools-box/js/engine-data.js"
RULES = REPO / "Architecture/Engine/knowledge/isTreasure/mainrules.js"
WASM = REPO / "Architecture/Engine/MonoSyllabism/map/box.wasm"
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
    @unittest.skipIf(shutil.which("node") is None, "node is not installed")
    def test_rules_head_parses_and_reaches_the_active_catalog(self):
        # The old POS_MAP exporter is deliberately unported. Exercise the
        # catalog used by comparison, which reads the master via secure.js.
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
        self.assertEqual(data["wasm_sha256"], hashlib.sha256(WASM.read_bytes()).hexdigest())

        # Ask the same Engine secure loader for its fingerprint rather than
        # opening or recreating a plaintext master in the test.
        info = subprocess.run(
            ["node", str(DATA_BRIDGE), "master-info"], cwd=ROOT,
            capture_output=True, text=True, timeout=30, check=True,
        )
        source = json.loads(info.stdout)
        self.assertEqual(data["sources"]["master"], str(Path(source["master"]).relative_to(REPO)))
        self.assertEqual(data["sources"]["master_sha256"], source["sha256"])

    @unittest.skipIf(shutil.which("node") is None, "node is not installed")
    def test_legacy_exporter_reports_the_unported_pos_view(self):
        with tempfile.TemporaryDirectory() as scratch:
            out = Path(scratch) / "comparison.json"
            result = subprocess.run(
                ["node", str(OLD_EXPORTER), str(out)], cwd=ROOT,
                capture_output=True, text=True, timeout=30,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("comparison POS view is unported", result.stderr)
            self.assertFalse(out.exists())

    def test_rules_are_current_json(self):
        rules = json.loads(RULES.read_text(encoding="utf-8"))
        self.assertTrue(set(SECTIONS).issubset(rules))
        self.assertTrue(all(rules[section] for section in SECTIONS))
        self.assertEqual(len(rules["simple_sentence_patterns"]), 42)


if __name__ == "__main__":
    unittest.main()
