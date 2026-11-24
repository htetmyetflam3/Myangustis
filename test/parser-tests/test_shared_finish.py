"""Shared finishing and the post-output POS scan (no vector implementation)."""
import asyncio
import tempfile
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

from myangustis_parser.normalize import beautify, cleanup, pos_scan
from myangustis_parser.workflow import finish


class SharedFinishTests(unittest.TestCase):
    def setUp(self):
        self.patches = [
            patch.object(beautify, '_bases', return_value=frozenset('ကခဂ')),
            patch.object(cleanup, '_glue', return_value=frozenset('\u200b')),
            patch.object(cleanup, '_imposter_matcher', return_value=({}, {})),
        ]
        for mock in self.patches:
            mock.start()
        self.addCleanup(lambda: [mock.stop() for mock in reversed(self.patches)])

    def test_ocr_never_calls_parsing_only_swap_or_rabbit(self):
        with patch.object(finish, 'arrange_zawcode_order', side_effect=AssertionError), \
             patch.object(finish.Rabbit, 'zg2uni', side_effect=AssertionError):
            result = finish.finish_text('ေြက ေြခ', source='ocr')
        self.assertEqual(result['decision'], 'ocr')
        self.assertEqual(result['base'], 'ေြက ေြခ')

    def test_encoding_override_is_respected_only_for_parsing(self):
        with patch.object(finish.Rabbit, 'zg2uni', return_value='က') as rabbit:
            forced = finish.finish_text('ေြက', source='parse', source_encoding='zawgyi-one')
            self.assertEqual(forced['decision'], 'rabbit')
            rabbit.assert_called_once()
        self.assertEqual(finish.decide('ေြက', source='parse', source_encoding='unicode')[0], 'pass-through')
        self.assertEqual(finish.decide('ေြက', source='ocr', source_encoding='zawgyi-one')[0], 'ocr')

    def test_score_counts_astral_characters_as_js_utf16(self):
        from myangustis_parser.normalize.mm_score import score_text
        self.assertEqual(score_text('က😀')['myanmar_ratio'], 1 / 3)

    def test_order_text_prebase_and_impossible_rules(self):
        self.assertEqual(cleanup.order_text('ေက'), 'ကေ')
        self.assertEqual(cleanup.order_text('ကေိ'), 'ကေ')
        self.assertEqual(cleanup.order_text('ကေုု'), 'ကေုု')


class PdfOutputLayoutTests(unittest.TestCase):
    def test_pdf_layout_uses_cleanup_without_reordering_again(self):
        from myangustis_parser.workflow import pipeline
        job = {'kind': 'pdf', 'pages': [{'text': 'ကေ', 'lines': [(0, 0, 12, 'ကေ', None)],
                                       'wh': (100, 100), 'has_img': False}],
               'reports': [{'base': 'ကေ', 'clean': 'ခေ', 'decision': 'pass-through'}]}
        with patch.object(pipeline.finish, 'clean', side_effect=AssertionError('unexpected reorder')), \
             patch.object(pipeline.finish, 'clean_page', return_value='ခေ'):
            result = pipeline.build_final_pages(job)[0]
        self.assertEqual(result['lines'][0][3], 'ခေ')
        self.assertEqual(result['text'], 'ခေ')


class AtomicOutputTests(unittest.TestCase):
    def test_pos_failure_does_not_publish_or_replace_output(self):
        from myangustis_parser.workflow import pipeline
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'out.txt'
            target.write_text('previous output')
            with patch.object(pos_scan, 'scan_pages_sync', side_effect=RuntimeError('engine failed')):
                with self.assertRaisesRegex(RuntimeError, 'engine failed'):
                    pipeline.render_and_scan(target, [{'text': 'က'}], {}, 'source.pdf')
            self.assertEqual(target.read_text(), 'previous output')
            self.assertEqual([p.name for p in Path(directory).iterdir()], ['out.txt'])

    def test_success_publishes_only_after_scan(self):
        from myangustis_parser.workflow import pipeline
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'out.txt'
            target.write_text('old')
            def check(pages):
                self.assertEqual(target.read_text(), 'old')
                self.assertEqual([p.name for p in Path(directory).iterdir()], ['out.txt'])
                return {'unknownCount': 0}
            with patch.object(pos_scan, 'scan_pages_sync', side_effect=check):
                name, report = pipeline.render_and_scan(target, [{'text': 'က'}], {}, 'source.pdf')
            self.assertEqual(name, str(target))
            self.assertEqual(report['unknownCount'], 0)
            self.assertIn('က', target.read_text())
            self.assertEqual([p.name for p in Path(directory).iterdir()], ['out.txt'])


class PosScanTests(unittest.IsolatedAsyncioTestCase):
    def test_parse_tagged_line(self):
        tokens = pos_scan.parse_tagged_line('မြန်မာ{n}  မသိ{F}  ၁{count}  raw')
        self.assertEqual([t['kind'] for t in tokens], ['known', 'unknown', 'other', 'other'])

    async def test_only_engine_pos_verdicts_are_kept_with_page_line(self):
        engine = AsyncMock(return_value=[{'rawPos': 'က{n}  ခ{F}  ဂ{n}'}])
        with patch.object(pos_scan, 'collect', engine):
            result = await pos_scan.scan_pages([{'text': 'hello\n၁\nabc ကခဂ'}])
        engine.assert_awaited_once_with('  ကခဂ', 'pos')
        self.assertEqual(result['unknownCount'], 1)
        self.assertEqual(result['memory'][0]['page'], 1)
        self.assertEqual(result['memory'][0]['line'], 3)
        self.assertEqual(result['memory'][0]['source'], 'abc ကခဂ')
        self.assertEqual(result['memory'][0]['context'], 'က{n}  ခ{F}  ဂ{n}')


if __name__ == '__main__':
    unittest.main()
