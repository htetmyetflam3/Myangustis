"""Regression checks for source-supported legacy slots and visual order."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "B.Parser", "main", "Python", "modules"))

from pdf_extract import legacy_ayar_to_unicode  # noqa: E402
from pdf_fonts import (  # noqa: E402
    AYAR_LEGACY_CODE_PAGE,
    WININNWA_LEGACY_CODE_PAGE,
    WININNWA_UNRESOLVED_SLOTS,
    DocumentDecoding,
    FontDecoder,
)


class LegacyCodepageTests(unittest.TestCase):
    def test_ayar_combined_kinzi_keeps_vowel(self):
        doc = DocumentDecoding("legacy", {}, AYAR_LEGACY_CODE_PAGE)
        # Grammar p235 /TT41: 23 42 88 2F -> A k Ç ¥.
        font = FontDecoder("TT41", to_unicode={0x23: "A", 0x42: "k", 0x88: "Ç", 0x2f: "¥"}, doc=doc)
        self.assertEqual(AYAR_LEGACY_CODE_PAGE[0xc7], "င်္ီ")
        self.assertEqual(AYAR_LEGACY_CODE_PAGE[0xe7], "င်္")
        self.assertEqual(legacy_ayar_to_unicode(font.decode(bytes([0x23, 0x42, 0x88, 0x2f]))), "အင်္ကျီ")
        self.assertEqual(legacy_ayar_to_unicode("သိဂင်္ီ"), "သိင်္ဂီ")
        self.assertEqual(legacy_ayar_to_unicode("သချင်္ာ"), "သင်္ချာ")
        self.assertEqual(legacy_ayar_to_unicode("အင်္ကျီ"), "အင်္ကျီ")

    def test_wininnwa_global_stacks_and_compounds(self):
        table = WININNWA_LEGACY_CODE_PAGE
        for slots, expected in [
            ("uwÅm;", "ကတ္တား"), ("uwåm;", "ကတ္တား"),
            ("rEÅav;", "မန္တလေး"), ("rEåav;", "မန္တလေး"),
            ("o'´g", "သဒ္ဒါ"), ("orÁE¨", "သမ္ဗန္ဓ"),
            ("tu©&m", "အက္ခရာ"), ("ypönf;", "ပစ္စည်း"),
            ("a>rBuD;", "မြွေကြီး"), ("acG;", "ခွေး"),
            ("jyKpk", "ပြုစု"), ("'ku©", "ဒုက္ခ"),
            ("od*Ð", "သိင်္ဂီ"), ("wð", "တိံ"),
        ]:
            decoded = "".join(table[ord(ch)] for ch in slots)
            self.assertEqual(legacy_ayar_to_unicode(decoded), expected, slots)
        self.assertEqual(table[0xc9], "္တွ")
        self.assertEqual(table[0xd8], "င်္ိ")
        self.assertEqual(table[0xf8], "င်္ံ")

    def test_earlier_single_entry_stack_and_space_are_preserved(self):
        table = WININNWA_LEGACY_CODE_PAGE
        self.assertEqual(table[32], " ")
        self.assertEqual(table[80], "ဏ")
        self.assertEqual(table[192], "ဏ္ဏ")
        self.assertEqual(table[197], "္တ")
        self.assertEqual(table[214], "္ဏ")
        self.assertNotIn(192, WININNWA_UNRESOLVED_SLOTS)
        self.assertNotIn(37, table)
        self.assertIn(37, WININNWA_UNRESOLVED_SLOTS)
        doc = DocumentDecoding("legacy", {}, table)
        font = FontDecoder("F", to_unicode={0x30: "À", 0x31: "P", 0x32: " ", 0x33: "%"}, doc=doc)
        self.assertEqual(font.decode(bytes([0x30])), "ဏ္ဏ")
        self.assertEqual(font.decode(bytes([0x31, 0x32, 0x30])), "ဏ ဏ္ဏ")
        self.assertEqual(font.decode(bytes([0x33])), "%")
        self.assertEqual(legacy_ayar_to_unicode(table[80] + table[214]), "ဏ္ဏ")

    def test_unresolved_slot_and_zero_width_are_preserved(self):
        doc = DocumentDecoding("legacy", {}, WININNWA_LEGACY_CODE_PAGE)
        font = FontDecoder("F", to_unicode={0x30: "|"}, doc=doc)
        self.assertIn(0x7c, WININNWA_UNRESOLVED_SLOTS)
        self.assertNotIn(0x7c, WININNWA_LEGACY_CODE_PAGE)
        self.assertEqual(font.decode(bytes([0x30])), "|")
        self.assertEqual(legacy_ayar_to_unicode("သချင်္ာ\u200b"), "သင်္ချာ\u200b")


if __name__ == "__main__":
    unittest.main()
