"""Every bundled map is loaded by something, and the scanner reads its own.

Two maps here were copies of tables the modules already carried, and both had
gone stale in different directions: ``mm-score.json`` was a byte-identical
duplicate of ``mm_score.MARKS``/``MARK_ORDER`` (which are documented as the
engine's table verbatim, so the module is the authority), and
``zawcode-draft-glyphs.json`` fed a decoder branch whose two inputs are never
assigned by anything. A map nothing loads is not data waiting to be used, it is
a second opinion nobody reads -- and the next reader has to guess which one the
code follows.

The damage map is named ``damage-rules.json`` and not after the module that first
read it: its entries are the shapes a Burmese page cannot produce, and more than
one module consults them. A name built on the word "scan" would have said
"repair-circle file" to everyone and "the scanner's private copy" to nobody.

Two guards below: a map that no source file names fails the suite, so the pile
cannot quietly grow back; and the ``impossible`` rules may be consulted by one
decision only, so the veto cannot leak into a lane gate that the JS oracle does
not have.
"""
import ast
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARCHITECTURE = ROOT / 'B.Parser/architecture'
MAPS = ARCHITECTURE / 'resources/maps_data'


def source_names():
    for path in sorted(ARCHITECTURE.rglob('*.py')):
        if '__pycache__' in path.parts:
            continue
        yield path, path.read_text(encoding='utf-8')


class BundledMapTests(unittest.TestCase):
    def test_no_bundled_map_is_unreferenced(self):
        for map_file in sorted(MAPS.glob('*.json')):
            with self.subTest(map=map_file.name):
                users = [path.relative_to(ROOT).as_posix()
                         for path, text in source_names() if map_file.name in text]
                self.assertTrue(users,
                                f'{map_file.name} is shipped but no source file names it: '
                                f'delete it, or load it where it belongs')

    def test_the_scanner_vocabulary_comes_from_the_map(self):
        from myangustis_parser.normalize import scan
        data = json.loads((MAPS / 'damage-rules.json').read_text(encoding='utf-8'))
        self.assertEqual(set(scan._BASES), set(data['base']))
        self.assertEqual(set(scan._STRAY_MARKS), set(data['strayMarks']))
        self.assertEqual([tuple(rule) for rule in scan._IMPOSSIBLE],
                         [tuple(rule) for rule in data['impossible']])
        for ch in data['letterOrMark']:
            self.assertTrue(scan._LETTER_OR_MARK(ch), ch)

    def test_the_map_does_not_silently_lose_a_rule(self):
        """The count is the point: an edited map with a rule dropped must fail here."""
        data = json.loads((MAPS / 'damage-rules.json').read_text(encoding='utf-8'))
        self.assertEqual(len(data['impossible']), 7)
        self.assertEqual({rule[0] for rule in scan_rules()},
                         {rule[0] for rule in data['impossible']})

    def test_the_shared_glyph_pairs_come_from_the_map(self):
        # homoglyphs.json is the JS @jason-map file, carried over because the
        # rule that reads it is now part of the judgement and a rule needs its
        # table in the package, not in a module's literals.
        from myangustis_parser.normalize import legacy_order
        data = json.loads((MAPS / 'homoglyphs.json').read_text(encoding='utf-8'))
        self.assertEqual([list(pair) for pair in legacy_order.homoglyph_pairs()],
                         data['pairs'])
        self.assertEqual(len(data['pairs']), 3)
        # Two of the three are letter-vs-numeral, and that is what the number
        # test can decide. ``ဉ``/``ဥ`` shares a glyph between two letters, so it
        # stays out of every count -- a dictionary or nothing separates those.
        numeral = [(letter, digit) for letter, digit, _ in data['pairs']
                   if '\u1040' <= digit <= '\u1049']
        self.assertEqual(numeral, [('\u101d', '\u1040'), ('\u101b', '\u1047')])
        self.assertEqual([pair[:2] for pair in legacy_order.numeral_pairs()], numeral)
        self.assertEqual(len(legacy_order.homoglyph_pairs()), 3)
        self.assertTrue(legacy_order.is_burmese_number('\u1040\u1041\u1042'))
        self.assertFalse(legacy_order.is_burmese_number('\u101d\u102c\u1040'),
                         'a digit inside a word is not a number')
        self.assertEqual(legacy_order.number_in_word_sites('\u101d\u102c\u1040'),
                         [(2, '\u101d\u102c\u1040')])
        self.assertEqual(legacy_order.number_in_word_sites('\u1040\u1041'), [],
                         'a number on its own proves nothing')
        self.assertEqual(legacy_order.number_in_word_sites('\u1009\u1025\u103a'), [],
                         'the letter pair is never a digit inside a word')

    def test_the_impossible_rules_are_consulted_by_one_decision(self):
        # The veto belongs to the Ayar-or-WinInnwa choice. Anywhere else it would
        # be a page-level judgement the JS side never makes, and the parity tests
        # would silently start disagreeing with the oracle over a weight.
        users = sorted(path.relative_to(ROOT).as_posix()
                       for path in ARCHITECTURE.rglob('*.py')
                       if '__pycache__' not in path.parts
                       and 'impossible_hits' in path.read_text(encoding='utf-8'))
        self.assertEqual(users, [
            'B.Parser/architecture/extract/legacy_judgement.py',
            'B.Parser/architecture/normalize/scan.py',
        ])

    def test_the_scorer_keeps_its_engine_table_rather_than_a_copy(self):
        # mm_score's marks/order are the grammar engine's own, and the scanner's
        # sets are deliberately wider (they count U+1039 and the independent
        # vowels). Reading the scan map into the scorer would change every score
        # in the parser, so this pins the difference instead of blurring it.
        from myangustis_parser.normalize import mm_score
        from myangustis_parser.normalize import scan
        data = json.loads((MAPS / 'damage-rules.json').read_text(encoding='utf-8'))
        self.assertNotEqual(set(mm_score.MARKS), set(data['strayMarks']))
        self.assertTrue(set(mm_score.MARKS) < set(data['strayMarks']))
        self.assertFalse(scan._is_base('\u1039'), 'the virama is not a base for either')
        for ch in mm_score.MARKS:
            self.assertFalse(mm_score.is_index(ch), ch)


def scan_rules():
    from myangustis_parser.normalize import scan
    return scan._IMPOSSIBLE


if __name__ == '__main__':
    unittest.main()
