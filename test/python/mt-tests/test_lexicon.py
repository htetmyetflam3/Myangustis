"""Dictionary/segmentation probes used by the agent tools."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "Proofreading" / "main"
sys.path.insert(0, str(ROOT / "mt"))
from lexicon import lookup, suggest, coverage

class Lexicon(unittest.TestCase):
    def test_entry(self):
        r = lookup("အခြေအနေ")
        self.assertTrue(r["reachable"]); self.assertEqual(r["families"], ["NOUN"])

    def test_damage_absent(self):
        self.assertFalse(lookup("အေခြအေန")["in_dictionary"])

    def test_repairs_proved(self):
        for bad, good in [("အေခြအေန","အခြေအနေ"), ("အေတွ့","အတွေ့"),
                          ("အေပျာ်","အပျော်"), ("ေချာ","ချော"), ("ဘ၀","ဘဝ")]:
            texts = [x["text"] for x in suggest(bad)["suggestions"]]
            self.assertIn(good, texts, f"{bad} should repair to {good}")

    def test_no_false_repair(self):
        # whole words
        for good in ("ကြေမွ", "ရေရွတ်", "သက်သောင့်သက်သာ"):
            r = suggest(good)
            self.assertEqual(r["verdict"], "already a word", good)
            self.assertEqual(r["suggestions"], [], good)
        # phrases: not one entry, but still must never produce a repair
        for phrase in ("သေလျှင်", "နေကြ", "သေသွား"):
            self.assertEqual(suggest(phrase)["suggestions"], [], phrase)

    def test_coverage_ignores_punctuation(self):
        self.assertEqual(coverage("မြန်မာစာသည် ရေးထားသည်။")["uncovered_count"], 0)

    def test_coverage_does_not_jump_word_boundaries(self):
        # Greedy longest-match used to take "ကိုက" out of "ကို" + "က" and leave a
        # stray ြ and ် behind, reporting 0.89 for a perfectly clean sentence.
        for text in ("ဗုဒ္ဓကိုကြည်ညိုတယ်", "ကမ္ဘာသစ် အန္တရာယ်", "သဒ္ဒါနဲ့ ဝိပဿနာ"):
            self.assertEqual(coverage(text)["uncovered_count"], 0, text)

if __name__ == "__main__":
    unittest.main(argv=["x", "-q"])
