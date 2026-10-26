"""The ZawCode Keymagic layout table (Python twin of the JS artifact).

JS source of truth: Praser/parser/codepage/zawcode-layout.mjs, built from
codepage/zawcode.kms integrated with the INPUT cmap (Myanmar3/MyanmarText
subsets) of the 4,414-page merged source book. This pins that Python
carries the same 92-slot table and the same keying -- as a layout
artifact, not as a routed candidate: ZawCode is identified by the
readable Unicode/cmap result (JS worker today), never by a font name.

Run:  python3 -m unittest discover -s .bin/python/parser-tests -v
"""

import os
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "Parser", "main", "Python", "modules"))
sys.path.insert(0, _HERE)

from pdf_fonts import LEGACY_CODE_PAGES, ZAWCODE_LEGACY_CODE_PAGE  # noqa: E402


class TestZawCodeLayout(unittest.TestCase):
    def test_layout_artifact_not_a_routed_candidate(self):
        # ungated it out-scores wininnwa on a WinInnwa book (0.979 vs
        # 0.978, bg-mlc-1-1), and a /BaseFont gate would trust names that
        # lie -- so it is in no competition and no face helper exists.
        self.assertEqual(sorted(LEGACY_CODE_PAGES), ["ayar", "wininnwa"])
        self.assertEqual(len(ZAWCODE_LEGACY_CODE_PAGE), 92)
        import pipeline
        self.assertFalse(hasattr(pipeline, "_document_has_zawcode_face"))

    def test_slot_decoding_matches_kms_keying(self):
        table = ZAWCODE_LEGACY_CODE_PAGE
        decode = lambda s: "".join(table[ord(c)] for c in s)  # noqa: E731
        # မြေ keyed a-j-r (ေ ြ မ typed order), ကျေ keyed a-u-s
        self.assertEqual(decode("ajr"), "\u1031\u103c\u1019")
        self.assertEqual(decode("aus"), "\u1031\u1000\u103b")
        for text in table.values():
            self.assertNotIn("\u200a", text)  # composition placeholder is not content


if __name__ == "__main__":
    unittest.main()
