"""Scraper routes only image-only PDFs; the Parser owns text conversion."""
import importlib.util
import sys
import tempfile
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'D.Scraper/architecture/result'))
sys.path.insert(0, str(ROOT / 'test/parser-tests'))
from pdf_classify import classify_pdf
from test_ocr import image_pdf
import text_collect


class ScraperRoutingTest(unittest.TestCase):
    def test_image_only_and_mixed_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sample.pdf'
            image_pdf(path)
            self.assertEqual(classify_pdf(path.read_bytes()).category, 'scanned')
            image_pdf(path, with_text=True)
            # Latin/legacy glyph slots still count as text; there is no Myanmar gate.
            self.assertEqual(classify_pdf(path.read_bytes()).category, 'convertable')

    def test_unknown_pdf_is_not_rejected_as_old(self):
        self.assertEqual(classify_pdf(b'invalid').category, 'convertable')

    def test_scanned_never_calls_parser_and_text_uses_convert(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'book.pdf'
            image_pdf(path)
            with patch('myangustis_parser.entry.index.convert') as convert:
                self.assertIsNone(text_collect.parse_convertable_book(path, log=lambda _: None))
                convert.assert_not_called()
            image_pdf(path, with_text=True)
            with patch('myangustis_parser.entry.index.convert', return_value={'text': 'Myanmar text'}) as convert, \
                    patch.object(text_collect, '_segment_documents', return_value=['segmented']):
                result = text_collect.parse_convertable_book_direct(path, log=lambda _: None)
            self.assertEqual(result, ('book', 'Myanmar text', 'segmented'))
            self.assertEqual(convert.call_args.args[0], path)
            self.assertEqual(Path(convert.call_args.args[1]).suffix, '.txt')
            self.assertTrue(convert.call_args.kwargs['include_text'])

class ContinuousOcrTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(ROOT / 'D.Scraper/run'))
        file = ROOT / 'D.Scraper/run/deploy/continuous-ocr/run.py'
        spec = importlib.util.spec_from_file_location('continuous_ocr_test', file)
        cls.runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.runner)

    def test_uses_parser_finish_and_pos_without_vector_repair(self):
        from myangustis_parser.workflow import ocr, finish
        from myangustis_parser.normalize import pos_scan
        with tempfile.TemporaryDirectory() as directory:
            path, output = Path(directory) / 'scan.pdf', Path(directory) / 'pages.jsonl'
            image_pdf(path, pages=2)
            with patch.object(ocr, 'available', return_value=True), \
                 patch.object(ocr, 'ocr_pdf_page', return_value='raw OCR') as recognize, \
                 patch.object(finish, 'finish_text', return_value={'clean': 'finished'}) as finished, \
                 patch.object(pos_scan, 'scan_pages_sync', return_value={'unknownCount': 1}) as scan:
                result = self.runner.Ocr().run(path, output)
            self.assertEqual(result['pages'], 2)
            self.assertEqual(result['unknownCount'], 2)
            self.assertEqual(recognize.call_count, 2)
            self.assertEqual(finished.call_count, 2)
            self.assertEqual(finished.call_args.kwargs, {'source': 'ocr'})
            self.assertEqual(scan.call_count, 2)
            self.assertIn('finished', output.read_text())
            self.assertTrue(path.exists())

    def test_ocr_failure_retains_source_and_does_not_publish_partial(self):
        from myangustis_parser.workflow import ocr
        with tempfile.TemporaryDirectory() as directory:
            path, output = Path(directory) / 'scan.pdf', Path(directory) / 'pages.jsonl'
            image_pdf(path)
            with patch.object(ocr, 'available', return_value=True), \
                 patch.object(ocr, 'ocr_pdf_page', side_effect=RuntimeError('failed')):
                with self.assertRaises(self.runner.BookError):
                    self.runner.Ocr().run(path, output)
            self.assertTrue(path.exists())
            self.assertFalse(output.exists())
            self.assertFalse(output.with_name(output.name + '.tmp').exists())


class ServiceUnitTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('systemd-analyze'), 'systemd-analyze not installed')
    def test_generated_ocr_units_are_valid(self):
        file = ROOT / 'D.Scraper/run/deploy/continuous-ocr/install.py'
        spec = importlib.util.spec_from_file_location('ocr_installer_test', file)
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for name, content in installer.render_units('/bin/true').items():
                path = Path(directory) / name
                path.write_text(content)
                paths.append(str(path))
            check = subprocess.run(['systemd-analyze', 'verify', *paths],
                                   capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stderr)


if __name__ == '__main__':
    unittest.main()
