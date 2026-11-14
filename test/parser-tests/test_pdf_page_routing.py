"""End-to-end regression tests for page routing and font-local decoding."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pdfbuild import build_pdf, simple_page_pdf, truetype_with_cmap
from myangustis_parser.extract.pdf_extract import parse_tounicode_stream
from myangustis_parser.extract.pdf_fonts import DocumentDecoding, FontDecoder, build_font_decoder, Ref
from myangustis_parser.workflow.pipeline import stream_pdf_pages, process_pdf_bytes


def pages(pdf, **kwargs):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / 'book.pdf'
        path.write_bytes(pdf)
        log = []
        _, _, stream = stream_pdf_pages(path, log=log.append, text_layout='off', **kwargs)
        return list(stream), log


def tounicode(pairs):
    return (b'begincmap\n' + str(len(pairs)).encode() + b' beginbfchar\n' +
            b'\n'.join(b'<%s> <%s>' % (a, b) for a, b in pairs) +
            b'\nendbfchar\nendcmap')


def cid_font(n, cmap, extra=b''):
    return {
        n: b'<< /Type /Font /Subtype /Type0 /BaseFont /SomeFont /Encoding /Identity-H /DescendantFonts [%d 0 R] %s >>' % (n+1, extra),
        n+1: b'<< /Type /Font /Subtype /CIDFontType2 /CIDToGIDMap /Identity /FontDescriptor %d 0 R >>' % (n+2),
        n+2: b'<< /Type /FontDescriptor /FontFile2 %d 0 R >>' % (n+3),
        n+3: (b'<< >>', truetype_with_cmap(cmap)),
    }


class PageRoutingTests(unittest.TestCase):
    def test_automatic_path_never_probes_draft_profiles(self):
        font = {10: b'<< /Type /Font /Subtype /TrueType /BaseFont /WinInnwa >>'}
        data = simple_page_pdf({'F': 10}, b'BT /F 12 Tf 1 0 0 1 10 700 Tm (u) Tj ET', fonts=font)
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict('os.environ', {'PRASER_ZAWCODE_DRAFT': ''}):
            path = Path(directory) / 'test.pdf'
            path.write_bytes(data)
            _, _, stream = stream_pdf_pages(path)
            result = list(stream)
            self.assertEqual(result[0]['text'], 'က')
            self.assertEqual(result[0]['decode_kind'], 'legacy')
            with self.assertRaisesRegex(ValueError, 'draft was removed'):
                stream_pdf_pages(path, text_layout='zawcode')
            with patch.dict('os.environ', {'PRASER_ZAWCODE_DRAFT': 'on'}):
                with self.assertRaisesRegex(ValueError, 'draft was removed'):
                    stream_pdf_pages(path)

    def test_pdf_finish_uses_page_judgment_not_detector_or_forced_encoding(self):
        mapping = tounicode([(b'01', 'ေြက'.encode('utf-16-be').hex().encode())])
        fonts = {10: b'<< /Type /Font /Subtype /TrueType /BaseFont /Other /ToUnicode 11 0 R >>',
                 11: (b'<< >>', mapping)}
        pdf = simple_page_pdf({'F': 10}, b'BT /F 12 Tf 1 0 0 1 10 700 Tm <010101> Tj ET', fonts=fonts)
        class UnusedDetector:
            def detect(self, *args, **kwargs):
                raise AssertionError('PDF finish must not call detector')
        for encoding in ('auto', 'unicode', 'zawgyi-one'):
            with self.subTest(encoding=encoding):
                result = process_pdf_bytes(pdf, UnusedDetector(), source_encoding=encoding)
                self.assertEqual(result['reports'][0]['decision'], 'zawcode')
                self.assertEqual(result['reports'][0]['category'], 'UNICODE')
                self.assertEqual(result['reports'][0]['text_path'], 'zawcode')

    def test_page_tree_preserves_generations_deduplicates_and_rejects_cycles(self):
        from myangustis_parser.extract.pdf_extract import collect_pages, find_root_pages
        objects = {(1, 0): b'<< /Type /Catalog /Pages 2 1 R >>',
                   (2, 1): b'<< /Type /Pages /Kids [3 2 R 3 2 R] >>',
                   (3, 2): b'<< /Type /Page /Parent 2 1 R >>'}
        root = find_root_pages(objects)
        self.assertEqual(root, (2, 1))
        self.assertEqual(collect_pages(objects, root), [(3, 2)])
        objects[(2, 1)] = b'<< /Type /Pages /Kids [2 1 R] >>'
        with self.assertRaisesRegex(ValueError, 'Cycle'):
            collect_pages(objects, root)

    def test_resource_caches_are_bounded_and_recently_used(self):
        from myangustis_parser.extract.pdf_fonts import ResourceCache, FontResourceLoader
        cache = ResourceCache(2)
        cache['first'] = 1; cache['second'] = 2
        self.assertEqual(cache.get('first'), 1)
        cache['third'] = 3
        self.assertEqual(list(cache), ['first', 'third'])
        loader = FontResourceLoader({}, lambda *_: b'\x00\x02', lambda *_: {}, lambda *_: {})
        a = loader.cid_to_gid({'CIDToGIDMap': Ref(8, 0)})
        self.assertIs(a, loader.cid_to_gid({'CIDToGIDMap': Ref(8, 0)}))
        self.assertEqual(a(0), 2)
        for i in range(100):
            loader.cid_to_gid({'CIDToGIDMap': Ref(i + 100, 0)})
        self.assertEqual(len(loader._cid_cache), 32)
        self.assertEqual(DocumentDecoding('font')._decoders.limit, 64)

    def test_content_stream_lengths_and_filters_are_resource_local(self):
        import zlib
        from myangustis_parser.extract import pdf_extract as pe
        from myangustis_parser.extract.pdf_fonts import FontResourceLoader
        text = b'BT /F 12 Tf (x) Tj ET'
        compressed = zlib.compress(text)
        objects = {(4, 0): b'<< /Length 7 0 R /Filter /Fl >>\nstream\n' + compressed + b'\nendstream',
                   (7, 0): str(len(compressed)).encode(),
                   (8, 0): b'<< /Length 1 /Filter /ASCIIHexDecode >>\nstream\na\nendstream',
                   (9, 0): b'<< /Length 1 >>\nstream\na\nendstream'}
        loader = FontResourceLoader(objects, pe.get_stream, pe.parse_ttf_cmap, pe.parse_tounicode_stream)
        self.assertEqual(pe._page_content_stream(loader, Ref(4, 0)), text)
        self.assertEqual(pe._page_content_stream(loader, Ref(9, 0)), b'a')
        # Font profile fingerprints use the separate JS getStream semantics.
        self.assertEqual(pe.get_stream(objects, 9), b'a\n')
        with self.assertRaisesRegex(ValueError, 'unsupported filter'):
            pe._page_content_stream(loader, Ref(8, 0))

    def test_object_and_plain_stream_limits_are_enforced(self):
        from myangustis_parser.extract import pdf_extract as pe
        from myangustis_parser.extract.pdf_fonts import FontResourceLoader
        with patch.object(pe, 'MAX_PDF_OBJECTS', 1):
            with self.assertRaisesRegex(ValueError, 'object cap'):
                pe.parse_pdf_objects(b'1 0 obj <<>> endobj 2 0 obj <<>> endobj')
        objects = {(1, 0): b'<< /Length 2 >>\nstream\nab\nendstream'}
        loader = FontResourceLoader(objects, pe.get_stream, pe.parse_ttf_cmap, pe.parse_tounicode_stream)
        with patch.object(pe, 'MAX_STREAM_MB', 0):
            with self.assertRaisesRegex(ValueError, 'content stream exceeds'):
                pe._page_content_stream(loader, Ref(1, 0))

    def test_page_tree_respects_cap(self):
        from myangustis_parser.extract.pdf_extract import collect_pages
        objects = {(2, 0): b'<< /Type /Pages /Kids [3 0 R 4 0 R] >>',
                   (3, 0): b'<< /Type /Page >>', (4, 0): b'<< /Type /Page >>'}
        with patch.dict('os.environ', {'LOCAL_MAX_PAGES': '1'}):
            with self.assertRaisesRegex(ValueError, 'page cap'):
                collect_pages(objects, 2)

    def test_same_gid_not_borrowed_from_other_resource(self):
        fonts = cid_font(10, {0x1000: 5})
        fonts.update(cid_font(20, {0x1015: 5}))
        # Third font has no mapping for 5. It must not borrow either font's gid.
        fonts.update(cid_font(30, {0x1019: 6}))
        content = (b'BT /A 12 Tf 1 0 0 1 10 700 Tm <0005> Tj ET\n'
                   b'BT /B 12 Tf 1 0 0 1 10 680 Tm <0005> Tj ET\n'
                   b'BT /C 12 Tf 1 0 0 1 10 660 Tm <0005> Tj ET')
        result, log = pages(simple_page_pdf({'A': 10, 'B': 20, 'C': 30}, content, fonts=fonts))
        self.assertEqual(result[0]['text'], 'က\nပ\n[0005]')
        self.assertFalse(any('Merged font cmap' in entry or 'first font wins' in entry for entry in log))

    def test_page_lanes_follow_font_dictionaries_not_first_page_text(self):
        objects = {1: b'<< /Type /Catalog /Pages 2 0 R >>',
                   2: b'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
                   3: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 10 0 R >> >> /Contents 5 0 R >>',
                   4: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 20 0 R >> >> /Contents 6 0 R >>',
                   5: (b'<< >>', b'BT /F 12 Tf 1 0 0 1 10 700 Tm <0005> Tj ET'),
                   6: (b'<< >>', b'BT /F 12 Tf 1 0 0 1 10 700 Tm (u) Tj ET'),
                   20: b'<< /Type /Font /Subtype /TrueType /BaseFont /WinInnwa >>'}
        objects.update(cid_font(10, {0x1000: 5}))
        out, _ = pages(build_pdf(objects))
        self.assertEqual([x['decode_kind'] for x in out], ['font', 'legacy'])
        self.assertEqual([x['text'] for x in out], ['က', 'က'])
        out, _ = pages(build_pdf(objects), source_encoding='unicode')
        self.assertEqual([x['decode_kind'] for x in out], ['font', 'font'])
        self.assertEqual(out[1]['text'], 'u')

    def test_legacy_page_does_not_convert_unicode_cluster_companion(self):
        fonts = {10: b'<< /Type /Font /Subtype /TrueType /BaseFont /WinInnwa /ToUnicode 11 0 R >>',
                 11: (b'<< >>', tounicode([(b'01', b'0075')])),
                 20: b'<< /Type /Font /Subtype /TrueType /BaseFont /Padauk /ToUnicode 21 0 R >>',
                 21: (b'<< >>', tounicode([(b'01', b'1001102C'), (b'02', b'1002102C'), (b'03', b'1003102C'), (b'04', b'1004102C')]))}
        content = (b'BT /A 12 Tf 1 0 0 1 10 700 Tm <01> Tj ET\n'
                   b'BT /B 12 Tf 1 0 0 1 10 680 Tm <01> Tj ET')
        out, _ = pages(simple_page_pdf({'A':10, 'B':20}, content, fonts=fonts))
        self.assertEqual(out[0]['decode_kind'], 'legacy')
        self.assertEqual(out[0]['text'], 'က\nခာ')

    def test_legacy_extraction_does_not_apply_obsolete_page_rewrite(self):
        font = {10: b'<< /Type /Font /Subtype /TrueType /BaseFont /WinInnwa >>'}
        content = b'BT /F 12 Tf 1 0 0 1 10 700 Tm (au) Tj ET'
        out, _ = pages(simple_page_pdf({'F':10}, content, fonts=font))
        self.assertEqual(out[0]['text'], 'ေက')
        from myangustis_parser.workflow import finish
        result = finish.finish_text('ေက', source='parse', parsing_path='legacy')
        self.assertEqual(result['decision'], 'legacy')
        self.assertEqual(result['clean'], result['base'])

    def test_mixed_width_tounicode_and_simple_padded_entries(self):
        mapping = parse_tounicode_stream(tounicode([(b'01', b'1000'), (b'0001', b'1001')]))
        font = FontDecoder('F', to_unicode=mapping, doc=DocumentDecoding('font'))
        self.assertEqual(font.decode(b'\x01'), 'က')
        padded = parse_tounicode_stream(tounicode([(b'0001', b'1001')]))
        self.assertEqual(FontDecoder('F', to_unicode=padded, doc=DocumentDecoding('font')).decode(b'\x01'), 'ခ')

    def test_stem_collects_all_page_instructions_before_content(self):
        from myangustis_parser.extract.pdf_fonts import FontResourceLoader
        from myangustis_parser.extract import pdf_extract
        original = FontResourceLoader.page_font_resources
        events = []
        def recorded(loader, number, generation=0):
            events.append(('fonts', number))
            return original(loader, number, generation)
        original_stream = pdf_extract._page_content_stream
        def stream(loader, ref):
            if ref.num in (5, 6):
                events.append(('content', ref.num))
            return original_stream(loader, ref)
        objects = {1: b'<< /Type /Catalog /Pages 2 0 R >>',
                   2: b'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
                   3: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 10 0 R >> >> /Contents 5 0 R >>',
                   4: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 10 0 R >> >> /Contents 6 0 R >>',
                   5: (b'<< >>', b'BT /F 12 Tf (a) Tj ET'),
                   6: (b'<< >>', b'BT /F 12 Tf (b) Tj ET'),
                   10: b'<< /Type /Font /Subtype /TrueType /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'}
        with patch.object(FontResourceLoader, 'page_font_resources', recorded), \
             patch.object(pdf_extract, '_page_content_stream', stream):
            pages(build_pdf(objects))
        first_content = next(i for i, event in enumerate(events) if event[0] == 'content')
        self.assertIn(('fonts', 3), events[:first_content])
        self.assertIn(('fonts', 4), events[:first_content])

    def test_cid_to_gid_and_space_decoy_use_only_own_font(self):
        pairs = [(('%04x' % i).encode(), b'0020') for i in range(1, 5)]
        fonts = cid_font(10, {0x1000: 10, 0x1001: 11, 0x1002: 12, 0x1003: 13}, b'/ToUnicode 14 0 R')
        fonts[11] = b'<< /Type /Font /Subtype /CIDFontType2 /CIDToGIDMap 15 0 R /FontDescriptor 12 0 R >>'
        fonts[14] = (b'<< >>', tounicode(pairs))
        fonts[15] = (b'<< >>', b'\x00\x00\x00\x0a\x00\x0b\x00\x0c\x00\x0d')
        content = b'BT /F 12 Tf 1 0 0 1 10 700 Tm <0001000200030004> Tj ET'
        out, _ = pages(simple_page_pdf({'F':10}, content, fonts=fonts))
        self.assertEqual(out[0]['text'], 'ကခဂဃ')

    def test_few_contradictions_do_not_replace_valid_tounicode(self):
        fonts = cid_font(10, {0x1000: 1, 0x1001: 2}, b'/ToUnicode 14 0 R')
        fonts[14] = (b'<< >>', tounicode([(b'0001', b'0020'), (b'0002', b'1015')]))
        content = b'BT /F 12 Tf 1 0 0 1 10 700 Tm <00010002> Tj ET'
        out, _ = pages(simple_page_pdf({'F':10}, content, fonts=fonts))
        self.assertEqual(out[0]['text'], ' ပ')

    def test_unresolved_family_remains_visible(self):
        font = FontDecoder('F', base_font='WWinPonnya', doc=DocumentDecoding('font'))
        self.assertEqual(font.decode(b'abc'), '[61][62][63]')

    def test_profile_requires_all_resource_properties(self):
        from myangustis_parser.resources import maps
        from myangustis_parser.extract import pdf_fonts
        program, tu = b'subset program', b'tounicode stream'
        import hashlib
        digest = lambda b: hashlib.sha256(b).hexdigest()
        profile = {'baseFont':'wininnwa', 'toUnicodeSha256':digest(tu), 'firstChar':0,
                   'lastChar':105, 'codePage':'wininnwa',
                   'rawRuns':{'bytes':{'14':' '}, 'runs':[{'bytes':[23,37], 'text':'က္က'}], 'unresolved':[48]}}
        class Loader:
            def resolve(self, value): return value
            def stream_of(self, value): return {Ref(1, 0):program, Ref(2, 0):tu}.get(value)
            def reversed_font_cmap(self, value): return {}
            def tounicode_of(self, font, preserve_spaces=False): return {23:'u', 37:'ú'}
        font = {'Subtype':'TrueType', 'BaseFont':'WinInnwa', 'FirstChar':0, 'LastChar':105,
                'FontDescriptor':{'FontFile2':Ref(1, 0)}, 'ToUnicode':Ref(2, 0)}
        with patch.object(maps, 'load_map', return_value={'profiles':{digest(program):profile}}):
            decoder = build_font_decoder(Loader(), 'F', font, DocumentDecoding('legacy'))
            self.assertEqual(decoder.decode(bytes([14,23,37,48])), ' က္က[30]')
            font['LastChar'] = 106
            decoder = build_font_decoder(Loader(), 'F', font, DocumentDecoding('legacy'))
            self.assertIsNone(decoder.confirmed_raw_runs)


if __name__ == '__main__':
    unittest.main()
