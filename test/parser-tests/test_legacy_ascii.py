"""Legacy ASCII residue: repair what is proven, report what is not.

The witnesses come from ``part-5.pdf`` (Zawgyi-One subsets, 85 pages), where
400 ``A``, 28 ``U`` and 7 ``O`` reached the txt output as Latin letters in
Myanmar words.
"""
import unittest
from types import SimpleNamespace

from myangustis_parser.normalize import legacy_ascii
from myangustis_parser.workflow import diagnostics, finish


class ResidueTests(unittest.TestCase):
    def test_witnessed_slots_are_repaired(self):
        for source, expected in {
            'Aနိမ့်Aမြင့် Aသံလှိုင်းများ': 'အနိမ့်အမြင့် အသံလှိုင်းများ',
            'AကျU်းAကျယ်': 'အကျဥ်းအကျယ်',
            'Aံ့Oချီးကျူးမိပါသည်။': 'အံ့ဩချီးကျူးမိပါသည်။',
            'နှစ်Aကူးမှာ': 'နှစ်အကူးမှာ',
            'Eကန်Eက': 'ဧကန်ဧက',
        }.items():
            text, counts = legacy_ascii.map_residue(source)
            self.assertEqual(text, expected)
            self.assertTrue(counts, source)

    def test_latin_text_is_never_rewritten(self):
        for text in ('Typed by Mg Shwe', 'PDF 4.1 MB', 'A4 စာမျက်နှာ', 'OK ဖြစ်တယ်'):
            self.assertEqual(legacy_ascii.map_residue(text), (text, {}))
            self.assertEqual(legacy_ascii.scan(text), {})

    def test_unproven_slot_is_reported_not_guessed(self):
        text, counts = legacy_ascii.map_residue('Aံ့Vများ')
        self.assertEqual(text, 'အံ့Vများ')          # A repaired, V kept visible
        self.assertEqual(counts, {'A': 1})
        # ...but the scan still names the letter the layout would have to explain.
        self.assertEqual(legacy_ascii.scan('Aံ့Vများ'), {'A': 1, 'V': 1})

    def test_rabbit_receives_myanmar_letters_not_latin(self):
        converted = finish.apply_decision('AကျU်းAကျယ်', 'rabbit')
        self.assertFalse(any(char.isascii() and char.isalpha() for char in converted), converted)

    def test_pdf_finish_reports_the_residue_it_found(self):
        result = finish.finish_pdf_page('Aံ့O AကျU်း', source_encoding='auto')
        self.assertEqual(result['residue'], {'A': 2, 'U': 1, 'O': 1})
        self.assertIn('အ', result['finished'])

    def test_ocr_text_is_left_exactly_as_delivered(self):
        self.assertEqual(finish.apply_decision('Aံ့O', 'ocr'), 'Aံ့O')


def _record(**values):
    record = {'book': 'x.pdf', 'page': 1, 'chars': 100, 'myanmar': 90,
              'nonempty_lines': 4, 'single_char_lines': 0, 'residue': '', 'residue_total': 0,
              'residue_unproven': '', 'unmapped_codes': 0, 'fallback_bytes': 0,
              'replacement_chars': 0, 'duplicate_lines': 0,
              'hex_placeholders': 0, 'repeated_lines': 0, 'detached_marks': 0,
              'image_present': True, 'status': 'ok'}
    record.update(values)
    return record


class VerdictTests(unittest.TestCase):
    def report(self, *records):
        book = diagnostics.BookReport(SimpleNamespace(book='x.pdf', file_event=None))
        for record in records:
            book.page(record)
        return book.verdict()

    def test_residue_is_the_headline_and_names_the_font(self):
        book = diagnostics.BookReport(SimpleNamespace(book='x.pdf', file_event=None))
        book.page(_record(residue='A:11,U:2', residue_total=13, status='repaired'),
                  [('EJBJWX+Zawgyi-One', 783)])
        verdict = book.verdict()
        self.assertEqual(verdict['symptom'], 'legacy-ascii-residue')
        self.assertEqual(verdict['severity'], 'text-corrupted')
        self.assertIn('A:11,U:2', verdict['evidence'])
        self.assertIn('Zawgyi-One', verdict['evidence'])
        self.assertIn('legacy_ascii', verdict['hint'])
        self.assertEqual((verdict['repaired'], verdict['degraded']), (1, 0))

    def test_fragmented_text_is_its_own_syndrome(self):
        verdict = self.report(*[
            _record(chars=3, myanmar=3, nonempty_lines=3, single_char_lines=3) for _ in range(4)])
        self.assertEqual(verdict['symptom'], 'fragmented-lines')
        self.assertIn('chars per non-empty line', verdict['evidence'])

    def test_image_only_book_says_it_needs_ocr(self):
        verdict = self.report(*[
            _record(chars=0, myanmar=0, single_char_lines=0) for _ in range(3)])
        self.assertEqual(verdict['symptom'], 'no-text-layer')
        self.assertIn('OCR', verdict['hint'])
        self.assertEqual(verdict['empty'], 3)

    def test_latin_book_is_information_not_damage(self):
        verdict = self.report(_record(chars=12, myanmar=0, fallback_bytes=12))
        self.assertEqual(verdict['symptom'], 'no-myanmar-text')
        self.assertEqual(verdict['severity'], 'info')
        self.assertEqual(verdict['ok'], 1)

    def test_fallback_in_a_myanmar_book_is_damage(self):
        verdict = self.report(_record(fallback_bytes=12), _record(page=2, fallback_bytes=0))
        self.assertEqual(verdict['symptom'], 'latin-fallback')
        self.assertEqual(verdict['degraded'], 1)

    def test_a_mark_alone_is_named_before_the_text_is_blamed(self):
        verdict = self.report(_record(detached_marks=660))
        self.assertEqual(verdict['symptom'], 'detached-marks')
        self.assertIn('နှင့်', verdict['evidence'])
        self.assertIn('joined', verdict['hint'])

    def test_code_dump_is_named_as_a_code_dump(self):
        verdict = self.report(_record(hex_placeholders=120))
        self.assertEqual(verdict['symptom'], 'hex-placeholders')
        self.assertIn('[00E5]', verdict['evidence'])

    def test_repeated_fragment_is_not_mistaken_for_text(self):
        verdict = self.report(_record(repeated_lines=40, nonempty_lines=50))
        self.assertEqual(verdict['symptom'], 'repeated-text')

    def test_clean_book_says_nothing_to_repair(self):
        self.assertEqual(self.report(_record())['symptom'], 'ok')

    def test_one_book_can_carry_two_syndromes(self):
        verdict = self.report(_record(residue='U:3', residue_total=3, fallback_bytes=9))
        self.assertEqual(verdict['symptom'], 'legacy-ascii-residue')
        self.assertEqual(verdict['also'], 'latin-fallback')


if __name__ == '__main__':
    unittest.main()
