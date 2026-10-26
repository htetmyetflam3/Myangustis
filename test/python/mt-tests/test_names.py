"""Tests for the name list: parsing, looking up, checking text, appending.

The real file (`content/reference/EtoBnames.txt`) is never written here. Every
test that appends works on a temporary copy.
"""
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "mt"))

import names  # noqa: E402

SAMPLE = """\
Ye Nin = ယဲ့နင်
Liu Jin = လျိုချင်း
Xianmen = အင်မော်တယ်ဂိုဏ်း
Ascension sect = အင်မော်တယ်ဂိုဏ်း
Lui Jin was a man.
ဟဲရွမ် = Heyun
"""


def _entries(text: str = SAMPLE) -> list[names.Entry]:
    return names.parse(text).entries


class ParseTests(unittest.TestCase):
    def test_reads_key_value_pairs_and_skips_prose(self):
        result = names.parse(SAMPLE)
        self.assertEqual(len(result.entries), 5)
        self.assertEqual([e.key for e in result.entries][:2], ["Ye Nin", "Liu Jin"])
        self.assertEqual(len(result.warnings), 1)
        self.assertIn("Lui Jin was a man", result.warnings[0])

    def test_detects_a_reversed_line(self):
        result = names.parse(SAMPLE)
        reversed_entries = [e for e in result.entries if e.reversed]
        self.assertEqual(len(reversed_entries), 1)
        self.assertEqual(reversed_entries[0].key, "Heyun")
        self.assertEqual(reversed_entries[0].value, "ဟဲရွမ်")

    def test_two_keys_may_share_one_form(self):
        entries = _entries()
        owners = names.canonical(entries)
        self.assertEqual(len(owners[names.normalize("အင်မော်တယ်ဂိုဏ်း")]), 2)

    def test_line_numbers_are_one_based(self):
        first = names.parse(SAMPLE).entries[0]
        self.assertEqual(first.line, 1)


class LookupTests(unittest.TestCase):
    def test_by_english_key(self):
        found = names.lookup(_entries(), "Liu Jin")
        self.assertEqual([e.value for e in found], ["လျိုချင်း"])

    def test_by_burmese_form(self):
        found = names.lookup(_entries(), "လျိုချင်း")
        self.assertEqual([e.key for e in found], ["Liu Jin"])

    def test_case_and_space_insensitive(self):
        self.assertTrue(names.lookup(_entries(), "liu  jin"))

    def test_unknown_term_is_empty(self):
        self.assertEqual(names.lookup(_entries(), "Nobody"), [])


class CheckTests(unittest.TestCase):
    def test_exact_hits(self):
        found = names.hits("ယဲ့နင် နန်းတော်ထဲ ဝင်တယ်။", _entries())
        self.assertEqual({row["burmese"] for row in found}, {"ယဲ့နင်"})

    def test_variant_with_one_wrong_syllable(self):
        suspects = names.variants("ယဲ့နိန် က စကားပြောတယ်။", _entries())
        self.assertEqual(len(suspects), 1)
        self.assertEqual(suspects[0]["found"], "ယဲ့နိန်")
        self.assertEqual(suspects[0]["canonical"], "ယဲ့နင်")
        self.assertEqual(suspects[0]["keys"], ["Ye Nin"])

    def test_canonical_text_has_no_variants(self):
        self.assertEqual(names.variants("ယဲ့နင် နဲ့ လျိုချင်း", _entries()), [])

    def test_a_variant_is_not_also_reported_as_a_hit(self):
        found = names.hits("ယဲ့နိန်", _entries())
        self.assertEqual(found, [])


class AddTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "EtoBnames.txt"
        self.path.write_text(SAMPLE, encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_appends_and_is_readable_again(self):
        entry = names.add(self.path, "Shen Ji", "ရှန်းကျီ", "ch194")
        text = self.path.read_text(encoding="utf-8")
        self.assertTrue(text.startswith(SAMPLE))
        self.assertIn("Shen Ji = ရှန်းကျီ", text)
        self.assertIn("ch194", text)
        self.assertEqual(entry.key, "Shen Ji")
        self.assertEqual(len(names.load(self.path).entries), 6)

    def test_refuses_a_second_spelling_for_one_key(self):
        with self.assertRaises(ValueError):
            names.add(self.path, "Liu Jin", "လျိုကျင်း")

    def test_refuses_a_form_owned_by_another_key(self):
        with self.assertRaises(ValueError):
            names.add(self.path, "Shen Ji", "လျိုချင်း")

    def test_a_failed_add_leaves_the_file_alone(self):
        before = self.path.read_text(encoding="utf-8")
        with self.assertRaises(ValueError):
            names.add(self.path, "Liu Jin", "လျိုကျင်း")
        self.assertEqual(self.path.read_text(encoding="utf-8"), before)

    def test_a_note_is_not_part_of_the_form(self):
        """`--add --note` used to poison the entry it wrote."""
        names.add(self.path, "Golden Eagle Saber", "ရွှေလင်းတဓား", "ch194 first use")
        entry = [item for item in names.load(self.path).entries
                 if item.key == "Golden Eagle Saber"][0]
        self.assertEqual(entry.value, "ရွှေလင်းတဓား")
        self.assertEqual(entry.note, "ch194 first use")
        self.assertTrue(names.hits("ရွှေလင်းတဓား နဲ့ ခုတ်တယ်။",
                                   names.load(self.path).entries))

    def test_a_weapon_or_technique_registers_like_a_person(self):
        """Not only human names: a saber, a manual, a bloodline ability.

        No category is stored — the file is one English term and one Burmese
        form — and none is needed. The entry has to survive a round trip and
        match the text it was added for.
        """
        for key, form in (("Golden Eagle Saber", "ရွှေလင်းတဓား"),
                          ("Nine Yang Manual", "နဝ ယန်းကျမ်း"),
                          ("Undying Bloodline", "မသေသွေးရိုး")):
            names.add(self.path, key, form)
            found = names.lookup(names.load(self.path).entries, key)
            self.assertEqual([entry.value for entry in found], [form])
            self.assertFalse(hasattr(found[0], "kind"))
        self.assertEqual(len(names.load(self.path).entries), 8)

    def test_same_entry_twice_is_a_no_op(self):
        first = names.add(self.path, "Shen Ji", "ရှန်းကျီ")
        second = names.add(self.path, "Shen Ji", "ရှန်းကျီ")
        self.assertEqual(first.key, second.key)
        self.assertEqual(len(names.load(self.path).entries), 6)


class RealFileTests(unittest.TestCase):
    """The shipped list, read-only."""

    def setUp(self):
        if not names.NAMES_FILE.is_file():
            self.skipTest("EtoBnames.txt not present")
        self.result = names.load()

    def test_parses_to_entries(self):
        self.assertGreater(len(self.result.entries), 100)

    def test_known_entries(self):
        self.assertTrue(names.lookup(self.result.entries, "Liu Jin"))
        self.assertTrue(names.lookup(self.result.entries, "Ye Nin"))

    def test_a_shared_form_is_reported_not_an_error(self):
        owners = names.canonical(self.result.entries)
        shared = [key for key, rows in owners.items() if len(rows) > 1]
        self.assertTrue(shared, "the file has at least one shared Burmese form")


if __name__ == "__main__":
    unittest.main()
