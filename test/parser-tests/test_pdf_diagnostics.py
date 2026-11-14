"""Opt-in diagnostics observe the actual parse without changing its output."""
import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pdfbuild import simple_page_pdf
from myangustis_engine.logen import Logen
from myangustis_parser.extract.pdf_fonts import FontDecoder
from myangustis_parser.workflow import diagnostics, pipeline, remote_queue
from myangustis_parser.workflow.lane_log import LaneLog


class DiagnosticTests(unittest.TestCase):
    def test_decode_counters_are_real_not_placeholder_guess(self):
        stats = {'unmapped_codes': 0, 'fallback_bytes': 0, 'dropped_controls': 0}
        decoder = FontDecoder('x')
        self.assertEqual(decoder.decode(b'A\x01', stats=stats), 'A')
        self.assertEqual(stats, {'unmapped_codes': 0, 'fallback_bytes': 2, 'dropped_controls': 1})
        stats = dict.fromkeys(stats, 0)
        decoder = FontDecoder('cid', is_cid=True)
        self.assertEqual(decoder.decode(b'\x00A', stats=stats), '[0041]')
        self.assertEqual(stats['unmapped_codes'], 1)

    def test_actual_pdf_logs_pages_and_does_not_change_output(self):
        pdf = simple_page_pdf({'F1': 5}, b'BT /F1 12 Tf 20 700 Td (Hello secret) Tj ET',
                              {5: b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'})
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'book.pdf'; path.write_bytes(pdf)
            events = []
            logger = Logen(console=events.append)
            with patch('myangustis_parser.workflow.lane_log.make_logger', return_value=logger), \
                 patch.dict(os.environ, {'PARSER_DIAGNOSTICS': 'off', 'PARSER_DIAGNOSTIC_SAMPLES': 'off'}):
                _, _, pages = pipeline.process_pdf_stream(path, None, False)
                expected = list(pages)
            events.clear()
            with patch('myangustis_parser.workflow.lane_log.make_logger', return_value=logger), \
                 patch.dict(os.environ, {'PARSER_DIAGNOSTICS': 'on', 'PARSER_DIAGNOSTIC_SAMPLES': 'off'}):
                _, _, pages = pipeline.process_pdf_stream(path, None, False)
                actual = list(pages)
            self.assertEqual(actual, expected)
            page = next(m for m in events if '[PDFDIAG]' in m)
            self.assertIn('book=book.pdf page=1', page)
            self.assertIn('fallback_bytes', page)
            self.assertIn('pieces_before_dedup', page)
            self.assertIn('lane_reason', page)
            self.assertNotIn('Hello secret', page)
            events.clear()
            with patch('myangustis_parser.workflow.lane_log.make_logger', return_value=logger), \
                 patch.dict(os.environ, {'PARSER_DIAGNOSTICS': 'on', 'PARSER_DIAGNOSTIC_SAMPLES': 'on'}):
                _, _, pages = pipeline.process_pdf_stream(path, None, False)
                self.assertEqual(list(pages), expected)
            self.assertIn('Hello secret', next(m for m in events if '[PDFDIAG]' in m))

    def test_ssh_queue_actual_pdf_conversion_emits_page_and_segmentation(self):
        from myangustis_parser.entry import index
        from test_ssh_combined_text import CFG
        import pyarrow.parquet as pq
        pdf = simple_page_pdf({'F1': 5}, b'BT /F1 12 Tf 20 700 Td (Sample text) Tj ET',
                              {5: b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'})
        def download(config, source, target):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(pdf)
            return remote_queue.digest_file(target)
        events = []
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(remote_queue, 'discover', return_value=['old/example.pdf']), \
             patch.object(remote_queue, 'download', side_effect=download), \
             patch('myangustis_engine.api.segment_text', return_value='segment\n'), \
             patch('myangustis_parser.workflow.lane_log.make_logger', return_value=Logen(console=events.append)), \
             patch.dict(os.environ, {'PARSER_DIAGNOSTICS': 'on', 'PARSER_DIAGNOSTIC_SAMPLES': 'off'}), \
             contextlib.redirect_stdout(io.StringIO()):
            output = remote_queue.run_once('parse', lambda src, out, _: index.convert(src, out, include_text=True),
                                           CFG, Path(temp))
            row = pq.read_table(output).to_pylist()[0]
            self.assertEqual(row['text'], 'Sample text')
            self.assertEqual(row['segmented'], 'segment\n')
        self.assertTrue(any('[PDFDIAG]' in event and 'page=1' in event and 'book=example.pdf' in event
                            for event in events))
        self.assertTrue(any('[PDFDIAG]' in event and 'segmentation' in event for event in events))
        self.assertFalse(any('Sample text' in event for event in events))

    def test_myanmar_embedded_font_with_diagnostics(self):
        from fpdf import FPDF
        root = Path(__file__).resolve().parents[2]
        font = root / 'Junk/fonts/zawgyi one/ZAWGYI-ONE_V3.1.TTF'
        with tempfile.TemporaryDirectory() as temp:
            pdf = FPDF(); pdf.add_font('Zawgyi-One', fname=str(font)); pdf.add_page()
            pdf.set_font('Zawgyi-One', size=14); pdf.cell(text='ေြက')
            path = Path(temp) / 'book.pdf'; pdf.output(str(path))
            events = []
            with patch('myangustis_parser.workflow.lane_log.make_logger', return_value=Logen(console=events.append)), \
                 patch.dict(os.environ, {'PARSER_DIAGNOSTICS': 'on', 'PARSER_DIAGNOSTIC_SAMPLES': 'off'}):
                pipeline.process_pdf_bytes(path.read_bytes(), pipeline.load_detector(), filename='book.pdf')
            page = next(event for event in events if '[PDFDIAG]' in event)
            self.assertIn('to_unicode_entries', page)
            self.assertIn('cid', page)
            self.assertIn('book=book.pdf page=1', page)

    def test_stage_metrics_and_changes(self):
        events = []
        tracker = LaneLog('test.pdf', Logen(console=events.append))
        pg = {'text': 'က\nခ\n[0041]', 'decode_kind': 'font', 'diagnostics': {}}
        result = {'decision': 'rabbit', 'category': 'UNICODE', 'finished': 'တစ်ခု',
                  'base': 'တစ်ခု', 'clean': 'တစ်ခုပြင်'}
        with patch.dict(os.environ, {'PARSER_DIAGNOSTIC_SAMPLES': 'off'}):
            diagnostics.page_log(tracker, 2, pg, result, result['base'], False)
        line = events[0]
        self.assertIn("'single_char_lines': 2", line)
        self.assertIn("'hex_placeholder_patterns': 1", line)
        self.assertIn('layout_to_finished_changed=True', line)
        self.assertIn('base_to_clean_changed=True', line)
        self.assertNotIn('တစ်ခု', line)

    def test_ssh_queue_logs_separate_segmentation(self):
        import pyarrow.parquet as pq
        from test_ssh_combined_text import CFG, download
        events = []
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(remote_queue, 'discover', return_value=['old/example.pdf']), \
             patch.object(remote_queue, 'download', side_effect=download), \
             patch('myangustis_engine.api.segment_text', return_value='one\ntwo\n'), \
             patch('myangustis_parser.workflow.lane_log.make_logger', return_value=Logen(console=events.append)), \
             patch.dict(os.environ, {'PARSER_DIAGNOSTICS': 'on'}), contextlib.redirect_stdout(io.StringIO()):
            output = remote_queue.run_once('parse', lambda *_: {'text': 'original'}, CFG, Path(temp))
            row = pq.read_table(output).to_pylist()[0]
            self.assertEqual(row['text'], 'original')
            self.assertEqual(row['segmented'], 'one\ntwo\n')
            self.assertIn('original', (Path(temp) / 'output/txt/parsed-books.txt').read_text())
        self.assertEqual(len(events), 1)
        self.assertIn('segmentation', events[0])
        self.assertIn('book=example.pdf', events[0])
        self.assertNotIn('original', events[0])


if __name__ == '__main__':
    unittest.main()
