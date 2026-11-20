"""Observe the parser's existing paths; OCR recognition alone is stubbed."""
from contextlib import ExitStack
import inspect
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pdfbuild import build_pdf, simple_page_pdf
from test_docx_font_evidence import document
from test_ocr import image_pdf, jpeg_bytes
from myangustis_parser.entry import manager
from myangustis_parser.normalize import detector, judgement, pos_scan, scan
from myangustis_parser.workflow import finish, ocr, pipeline


def pdf_text(text):
    cmap = (b'begincmap\n1 beginbfchar\n<01> <' + text.encode('utf-16-be').hex().encode()
            + b'>\nendbfchar\nendcmap')
    return simple_page_pdf({'F': 10}, b'BT /F 12 Tf 1 0 0 1 10 700 Tm <01> Tj ET',
        fonts={10: b'<< /Type /Font /Subtype /TrueType /BaseFont /Other /ToUnicode 11 0 R >>',
               11: (b'<< >>', cmap)})


def legacy_pdf():
    return simple_page_pdf({'F': 10}, b'BT /F 12 Tf 1 0 0 1 10 700 Tm (ajrajrajrajrajrajrajr) Tj ET',
        fonts={10: b'<< /Type /Font /Subtype /TrueType /BaseFont /WinInnwa >>'})


class Trace:
    def __init__(self, stack):
        self.events, self.values = [], {}
        for obj, name, stage, capture in (
            (pipeline, 'instruction_lane', 'instruction', None),
            (pipeline, 'extract_page_lines', 'pdf-extract', None),
            (pipeline, 'extract_docx_paragraphs', 'docx-extract', None),
            (detector.ZawgyiDetector, 'detect', 'docx-decision', None),
            (judgement, 'judge_page_lines', 'judgment', None),
            (judgement, 'select_page_decision', 'decision', lambda a, v: v),
            (finish, 'decide', 'text-decision', lambda a, v: v[0]),
            (finish, 'apply_decision', 'beautify', lambda a, v: (a[1], v)),
            (finish, 'clean_page', 'clean', lambda a, v: (a[0], v)),
            (scan, 'scan_text', 'structural-scan', lambda a, v: a[0]),
            (pipeline, 'render_texts', 'render', lambda a, v: [p['text'] for p in a[1]]),
            (pos_scan, 'scan_pages_sync', 'pos-scan', lambda a, v: [p['text'] for p in a[0]]),
            (pipeline.os, 'replace', 'publish', None),
        ):
            self.watch(stack, obj, name, stage, capture)

    def watch(self, stack, obj, name, stage, capture=None):
        real = getattr(obj, name)
        def record(args, value):
            self.events.append(stage)
            if capture:
                self.values.setdefault(stage, []).append(capture(args, value))
            return value
        if inspect.iscoroutinefunction(real):
            async def call(*args, **kwargs):
                return record(args, await real(*args, **kwargs))
        else:
            def call(*args, **kwargs):
                return record(args, real(*args, **kwargs))
        stack.enter_context(patch.object(obj, name, call))


class ParserChainTests(unittest.TestCase):
    def assert_in_order(self, trace, stages):
        positions = []
        for stage in stages:
            if stage not in trace.events:
                self.fail(f'missing {stage!r}; observed {trace.events!r}')
            positions.append(trace.events.index(stage))
        self.assertEqual(positions, sorted(positions),
                         f'out-of-order steps {stages!r}; observed {trace.events!r}')

    def assert_scanned_and_published(self, trace, result, path):
        self.assert_in_order(trace, ('clean', 'structural-scan', 'render', 'pos-scan', 'publish'))
        self.assertEqual(trace.values['structural-scan'][0], trace.values['clean'][0][1])
        self.assertEqual(trace.values['render'][0], trace.values['pos-scan'][0])
        rendered = trace.values['render'][0][0]
        self.assertEqual(result['text'], rendered)
        self.assertTrue(path.is_file())

    def test_pdf_decisions(self):
        cases = (('pass-through', pdf_text('ကမၻာ')), ('rabbit', pdf_text('ေြက' * 7)),
                 ('zawcode', pdf_text('ကေြ' * 4)), ('legacy', legacy_pdf()))
        for decision, data in cases:
            with self.subTest(decision=decision), tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
                trace = Trace(stack)
                target = Path(directory) / 'out.txt'
                result = manager._convert(data, 'input.pdf', target, kind='pdf', include_text=True)
                self.assertEqual(trace.values['decision'][0], decision)
                self.assert_in_order(trace, ('instruction', 'pdf-extract', 'judgment', 'decision',
                                             'clean', 'structural-scan', 'render', 'pos-scan', 'publish'))
                if decision != 'pass-through':
                    self.assert_in_order(trace, ('decision', 'beautify', 'clean'))
                    self.assertEqual(trace.values['beautify'][0][0], decision)
                    self.assertEqual(trace.values['beautify'][0][1], trace.values['clean'][0][0])
                self.assert_scanned_and_published(trace, result, target)

    def test_each_pdf_page_reaches_clean_and_scan(self):
        mapping = (b'begincmap\n2 beginbfchar\n<01> <10001019107B102C>\n'
                   b'<02> <10011019107B102C>\nendbfchar\nendcmap')
        objects = {
            1: b'<< /Type /Catalog /Pages 2 0 R >>',
            2: b'<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
            3: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 10 0 R >> >> /Contents 4 0 R >>',
            4: (b'<< >>', b'BT /F 12 Tf 10 700 Td <01> Tj ET'),
            5: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 10 0 R >> >> /Contents 6 0 R >>',
            6: (b'<< >>', b'BT /F 12 Tf 10 700 Td <02> Tj ET'),
            10: b'<< /Type /Font /Subtype /TrueType /BaseFont /Other /ToUnicode 11 0 R >>',
            11: (b'<< >>', mapping),
        }
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            trace = Trace(stack)
            target = Path(directory) / 'out.txt'
            result = manager._convert(build_pdf(objects), 'input.pdf', target, kind='pdf', include_text=True)
            self.assertEqual(result['pages'], 2)
            self.assertEqual(len(trace.values['structural-scan']), 2)
            cleaned = [value for _, value in trace.values['clean']]
            for page in trace.values['structural-scan']:
                self.assertIn(page, cleaned)
            self.assertEqual(trace.values['render'][0], trace.values['pos-scan'][0])
            self.assert_in_order(trace, ('render', 'pos-scan', 'publish'))


    def test_docx_paths(self):
        cases = (('unknown', ''),
                 ('unicode', '<w:rFonts w:ascii="Padauk" w:hAnsi="Padauk"/>'),
                 ('zawgyi', '<w:rFonts w:ascii="Zawgyi-One" w:hAnsi="Zawgyi-One"/>'))
        for case, props in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
                trace = Trace(stack)
                target = Path(directory) / 'out.txt'
                result = manager._convert(document(props), 'input.docx', target, kind='docx', include_text=True)
                self.assert_in_order(trace, ('docx-extract', 'docx-decision', 'clean', 'structural-scan',
                                             'render', 'pos-scan', 'publish'))
                if case == 'zawgyi':
                    self.assert_in_order(trace, ('docx-decision', 'text-decision', 'beautify', 'clean'))
                    self.assertEqual(trace.values['text-decision'][0], 'rabbit')
                self.assert_scanned_and_published(trace, result, target)

    def test_image_and_pdf_ocr(self):
        for kind in ('image', 'pdf'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
                trace = Trace(stack)
                stack.enter_context(patch.object(ocr, 'available', return_value=True))
                stack.enter_context(patch.object(ocr, 'ocr_image', return_value='ကမၻာ'))
                stack.enter_context(patch.object(ocr, 'ocr_pdf_page', return_value='ကမၻာ'))
                target = Path(directory) / 'out.txt'
                if kind == 'image':
                    result = manager._convert(jpeg_bytes(), 'input.jpg', target, kind='ocr', include_text=True)
                else:
                    source = Path(directory) / 'scan.pdf'
                    image_pdf(source)
                    result = manager.dispatch_ocr(source, target, include_text=True)
                self.assertEqual(trace.values['text-decision'][0], 'ocr')
                self.assert_in_order(trace, ('text-decision', 'beautify', 'clean', 'structural-scan',
                                             'render', 'pos-scan', 'publish'))
                self.assert_scanned_and_published(trace, result, target)


class AsyncTraceTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_stage_observation(self):
        class Stage:
            async def run(self, value):
                return value + 1
        with ExitStack() as stack:
            trace = Trace(stack)
            trace.watch(stack, Stage, 'run', 'example')
            self.assertEqual(await Stage().run(2), 3)
            self.assertEqual(trace.events, ['example'])


if __name__ == '__main__':
    unittest.main()
