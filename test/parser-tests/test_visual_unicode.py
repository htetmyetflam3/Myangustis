"""Witnessed visual-glyph recovery with the repository's reference fonts."""
from pathlib import Path
import unittest

from pdfbuild import simple_page_pdf
from test_pdf_page_routing import pages, tounicode
from myangustis_parser.extract.pdf_extract import parse_ttf_cmap, parse_tounicode_stream
from myangustis_parser.extract.pdf_fonts import DocumentDecoding, FontDecoder, FontResourceLoader, Ref
from myangustis_parser.workflow.pipeline import process_pdf_bytes
from myangustis_parser.extract.pdf_visual import (decode_visual_unicode_run,
    has_visual_unicode_conflicts, match_visual_unicode_glyphs)

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / 'Junk/fonts/Unicode/TharLon.ttf'
MM3 = ROOT / 'Junk/fonts/Unicode/mm3_05-Jan-2011.ttf'


def raw(*ids):
    return b''.join(gid.to_bytes(2, 'big') for gid in ids)


def fixture(path=FONT):
    program = path.read_bytes()
    cmap = parse_ttf_cmap(program)
    gid = lambda ch: cmap[ord(ch)]
    loader = FontResourceLoader({}, lambda *args: program, parse_ttf_cmap, parse_tounicode_stream)
    own = loader.reversed_font_cmap({'FontFile2': Ref(1, 0)})
    return program, gid, own


def tharlon_mapping(gid):
    mapping = {gid('ဂ'): 'ြ', gid('ဈ'): 'ေ', 499: 'တ', 461: 'ဖ',
               508: 'ေ', 510: 'ေ', 377: '့', 498: 'ါ', 382: 'ျှ', 384: 'ွှ', 419: 'က'}
    mapping.update({gid(ch): ch for ch in 'ပဖမတလအာေရဝ၀၈'})
    return mapping


def decoder_for(program, own, mapping):
    doc = DocumentDecoding('font')
    decoder = FontDecoder('F', is_cid=True, to_unicode=mapping, own_gids=own, doc=doc)
    decoder.visual_unicode_glyphs = match_visual_unicode_glyphs(decoder, program)
    return decoder


def pdf_for(program, mapping, shown, separate_boxes=False, compress=True):
    pairs = [(('%04X' % code).encode(), text.encode('utf-16-be').hex().encode())
             for code, text in mapping.items()]
    fonts = {10: b'<< /Type /Font /Subtype /Type0 /BaseFont /SomeFont /Encoding /Identity-H /DescendantFonts [11 0 R] /ToUnicode 14 0 R >>',
             11: b'<< /Type /Font /Subtype /CIDFontType2 /CIDToGIDMap /Identity /FontDescriptor 12 0 R >>',
             12: b'<< /Type /FontDescriptor /FontFile2 13 0 R >>',
             13: (b'<< >>', program), 14: (b'<< >>', tounicode(pairs))}
    if separate_boxes:
        content = b' '.join(b'BT /F 12 Tf 1 0 0 1 %d 700 Tm <%s> Tj ET' %
                            (10 + index * 8, data.hex().encode()) for index, data in enumerate(shown))
    else:
        content = b'BT /F 12 Tf 1 0 0 1 10 700 Tm ' + b' '.join(b'<' + data.hex().encode() + b'> Tj' for data in shown) + b' ET'
    return simple_page_pdf({'F': 10}, content, fonts=fonts, compress=compress)


@unittest.skipUnless(FONT.exists(), 'TharLon witness font not present')
class VisualUnicodeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.program, cls.gid, cls.own = fixture()
        # A lambda stored on a class would otherwise become a bound method.
        cls.gid = staticmethod(cls.gid)

    def test_witness_and_contradictions_both_required(self):
        mapping = tharlon_mapping(self.gid)
        decoder = decoder_for(self.program, self.own, mapping)
        self.assertTrue(has_visual_unicode_conflicts(decoder))
        self.assertEqual(decoder.visual_unicode_glyphs[499]['role'], 'e')
        self.assertEqual(decoder.visual_unicode_glyphs[461]['role'], 'ra')
        correct = dict(mapping, **{})
        correct[self.gid('ဂ')] = 'ဂ'; correct[self.gid('ဈ')] = 'ဈ'
        self.assertIsNone(decoder_for(self.program, self.own, correct).visual_unicode_glyphs)
        self.assertIsNone(match_visual_unicode_glyphs(decoder, b'not a font'))

    def test_witnessed_clusters_and_unrelated_text(self):
        decoder = decoder_for(self.program, self.own, tharlon_mapping(self.gid))
        cases = [([499, self.gid('ပ')], 'ပေ'),
                 ([499, 461, self.gid('ဖ')], 'ဖြေ'),
                 ([499, self.gid('တ'), 510], 'တွေ'),
                 ([499, 461, self.gid('ဖ'), 510], 'ဖြွေ'),
                 ([499, 419, self.gid('က')], 'ကြွေ'),
                 ([499, self.gid('လ'), 382], 'လျှေ'),
                 ([self.gid('အ'), self.gid('ဂ'), 377, 498], 'အင်္ဂါ'),
                 ([self.gid('မ'), 508, self.gid('ာ')], 'မျာ'),
                 ([self.gid('ဝ'), self.gid('၀'), self.gid('၈')], 'ဝ၀၈')]
        for ids, expected in cases:
            with self.subTest(ids=ids):
                self.assertEqual(decode_visual_unicode_run(decoder, [raw(*ids)]), expected)
        self.assertEqual(decode_visual_unicode_run(decoder, [b'\x01']), '[01]')

    def test_pdf_applies_witness_per_resource_and_warns(self):
        mapping = tharlon_mapping(self.gid)
        pdf = pdf_for(self.program, mapping, [raw(499), raw(self.gid('ပ')),
                     raw(self.gid('အ'), self.gid('ဂ'), 377, 498)])
        result, _ = pages(pdf)
        self.assertEqual(result[0]['text'], 'ပေအင်္ဂါ')
        self.assertEqual(result[0]['warnings'], [{'code': 'unicode-glyph-recovery-needs-review', 'page': 1}])
        class Detector:
            def detect(self, text):
                return 'UNICODE', 1.0
        report = process_pdf_bytes(pdf, Detector(), text_layout='off')
        self.assertEqual(report['reports'][0]['warnings'], result[0]['warnings'])
        forced, _ = pages(pdf, source_encoding='zawgyi-one')
        self.assertNotEqual(forced[0]['text'], 'ပေအင်္ဂါ')
        self.assertEqual(forced[0]['warnings'], [])

    @unittest.skipUnless(MM3.exists(), 'Myanmar3 witness font not present')
    def test_mm3_multichar_conflicts_and_boundaries(self):
        program, gid, own = fixture(MM3)
        mapping = {gid('က'): ' ', gid('ခ'): 'ြ', gid('ဖ'): 'ြ', gid('ဒ'): 'ေ',
                   gid('င'): 'င', gid('မ'): 'မ', 228: 'ဒ', 239: ' ', 234: 'ျေ',
                   223: 'ာ', 224: 'ိ', 233: '်', 232: 'း', 259: 'ု', gid(' '): ' '}
        decoder = decoder_for(program, own, mapping)
        self.assertTrue(decoder.visual_unicode_glyphs)
        for ids, expected in [([228, gid('က'), 234, 223, 233], 'ကျော်'),
                              ([228, 239, gid('က'), 223, gid('င'), 233, 232], 'ကြောင်း')]:
            self.assertEqual(decode_visual_unicode_run(decoder, [raw(*ids)]), expected)
        self.assertEqual(decode_visual_unicode_run(decoder, [raw(234)]), 'ျေ')
        self.assertEqual(decode_visual_unicode_run(decoder, [raw(gid('မ'), 234, 223, 232)], starts_at_boundary=True), 'များ')
        result, _ = pages(pdf_for(program, mapping, [raw(234)]), source_encoding='unicode')
        self.assertEqual(result[0]['text'], 'ျေ')
        self.assertEqual(result[0]['warnings'], [{'code': 'unicode-glyph-mapping-needs-review', 'page': 1}])

    @unittest.skipUnless(MM3.exists(), 'Myanmar3 witness font not present')
    def test_space_dominated_empty_mark_is_retained_across_pieces(self):
        program, gid, own = fixture(MM3)
        mapping = {gid(chr(cp)): ' ' for cp in range(0x1000, 0x1014)}
        mapping.update({i: ' ' for i in (gid('အ'), gid('ပ'), 228, 239, 252, 222, gid(' '))})
        self.assertTrue(decoder_for(program, own, mapping).conflicting_space_map)
        ids = [gid('အ'), gid('ဂ'), 252, 222, gid(' '), 228, gid('ပ')]
        result, _ = pages(pdf_for(program, mapping, [raw(i) for i in ids], separate_boxes=True))
        self.assertEqual(result[0]['text'], 'အင်္ဂါ ပေ')
        self.assertEqual(result[0]['warnings'], [{'code': 'unicode-glyph-recovery-needs-review', 'page': 1}])


if __name__ == '__main__': unittest.main()
