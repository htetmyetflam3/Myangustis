"""The legacy lane's own beautify rule, and where the chain runs it.

The mirror has no legacy reorder (`@core/runtime/finalized-cmap.js`: "There is no
legacy-specific reorder rule: extraction only decodes"), so these pins are what the
JS side has to match when main lands the rule. `test_pdf_finish_js_parity.py`
allows exactly the legacy-decision samples this rule moves.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for shim in (str(ROOT), str(ROOT / 'test' / 'parser-tests')):
    if shim not in sys.path:
        sys.path.insert(0, shim)

from myangustis_parser.normalize.legacy_order import arrange_legacy_order  # noqa: E402
from myangustis_parser.workflow import finish  # noqa: E402


class LegacyOrderTests(unittest.TestCase):
    def test_preposed_vowel_moves_behind_its_base(self):
        self.assertEqual(arrange_legacy_order("\u103c\u1015"), "\u1015\u103c")
        self.assertEqual(arrange_legacy_order("\u1000\u102f\u102d"), "\u1000\u102f\u102d")

    def test_kinzi_jumps_to_the_cluster_it_belongs_to(self):
        self.assertEqual(arrange_legacy_order("\u101e\u1001\u103b\u1004\u103a\u1039\u102c"),
                         "\u101e\u1004\u103a\u1039\u1001\u103b\u102c")
        # a kinzi with a consonant after it is already correctly placed
        self.assertEqual(arrange_legacy_order("\u1015\u102c\u1004\u103a\u1039\u1000"),
                         "\u1015\u102c\u1004\u103a\u1039\u1000")

    def test_zero_width_text_is_preserved(self):
        self.assertEqual(arrange_legacy_order("\u101e\u1001\u103b\u1004\u103a\u1039\u102c\u200b"),
                         "\u101e\u1004\u103a\u1039\u1001\u103b\u102c\u200b")

    def test_the_finish_runs_it_before_the_shared_ordering(self):
        # position, not just effect: the lane rule first, cleanup's ordering after
        reordered = arrange_legacy_order("\u103c\u1015\u102b")
        self.assertEqual(finish.ordered(reordered), finish.order_text(reordered))
        self.assertNotEqual(finish.ordered("\u103c\u1015\u102b"), finish.ordered(reordered))

    def test_only_the_legacy_lane_calls_it(self):
        from myangustis_parser.normalize import legacy_order
        calls = []
        real = legacy_order.arrange_legacy_order
        legacy_order.arrange_legacy_order = lambda text: (calls.append(text), real(text))[1]
        try:
            for decision in ('aligned', 'rabbit', 'zawcode', 'ocr'):
                finish.apply_decision("\u103c\u1015", decision)
            self.assertEqual(calls, [], f'{decision} must not reach the legacy rule')
            finish.apply_decision("\u103c\u1015", 'legacy')
            self.assertEqual(calls, ["\u103c\u1015"])
        finally:
            legacy_order.arrange_legacy_order = real

    def test_extraction_no_longer_reorders(self):
        # the rule left the join: the extraction stage decodes and stops
        from myangustis_parser.extract import pdf_extract
        self.assertFalse(hasattr(pdf_extract, 'legacy_ayar_to_unicode'))
        self.assertFalse(hasattr(pdf_extract, '_aa_vowel_rule_for_legacy'))
        src = Path(str(ROOT / 'B.Parser/architecture/extract/pdf_extract.py')).read_text()
        self.assertNotIn('arrange_legacy_order', src)
        self.assertNotIn('legacy_text_fix', src)


if __name__ == '__main__':
    unittest.main()
