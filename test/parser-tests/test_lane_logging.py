"""Lane decisions are traced per book, not per character or page."""
import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from myangustis_engine.logen import Logen
from myangustis_parser.extract.pdf_fonts import DocumentDecoding, FontDecoder
from myangustis_parser.workflow import lane_log, pipeline


class TestLaneLogging(unittest.TestCase):
    def test_decoding_observes_actual_myanmar_font_and_ignores_latin(self):
        doc = DocumentDecoding('legacy', {65: 'က'})
        observed = []
        doc.lane_observer = observed.append
        legacy = FontDecoder('legacy', doc=doc)
        unicode = FontDecoder('unicode', doc=doc, has_encoding=True,
                              encoding={65: 'ခ', 66: 'B'})
        self.assertEqual(legacy.decode(b'AA'), 'ကက')
        self.assertEqual(unicode.decode(b'BA'), 'Bခ')
        self.assertEqual(legacy.decode(b'A'), 'က')
        self.assertEqual(observed, ['legacy', 'legacy', 'unicode', 'legacy'])

    def test_stem_only_switches_and_beautify_two_ranges(self):
        events = []
        class Logger:
            def emit_log(self, module, level, event, data):
                events.append((module, event, data))
        tracker = lane_log.LaneLog('my book.pdf', Logger())
        for page in range(1, 101):
            tracker.stem(page, ['unicode', 'unicode'] if page < 21 else ['legacy', 'legacy'])
            tracker.finish_page(page, 'rabbit' if page <= 20 else 'zawcode')
        tracker.flush()
        tracker.flush()
        stem = [d for m, _, d in events if m == 'STEM']
        finish = [d for m, _, d in events if m == 'BEAUTIFY']
        self.assertEqual([(d['page'], d['from'], d['to']) for d in stem], [(21, 'unicode', 'legacy')])
        self.assertEqual([(d['pages'], d['rule']) for d in finish], [('1-20', 'rabbit'), ('21-100', 'zawcode')])
        self.assertTrue(all(d['book'] == 'my book.pdf' for _, _, d in events))

    def test_inner_loop_switches_and_new_book_does_not_inherit_state(self):
        events = []
        logger = Logen(console=events.append)
        a = lane_log.LaneLog('a.pdf', logger)
        a.stem(1, ['unicode'] * 30 + ['legacy'] * 30 + ['unicode'] * 30)
        b = lane_log.LaneLog('b.pdf', logger)
        b.stem(1, ['legacy'] * 3)
        self.assertEqual(len(events), 2)
        self.assertTrue(all('a.pdf' in event for event in events))

    def test_identical_finish_for_whole_book_logged_once(self):
        events = []
        tracker = lane_log.LaneLog('book.pdf', Logen(console=events.append))
        for page in range(1, 101): tracker.finish_page(page, 'zawcode')
        tracker.flush()
        self.assertEqual(len(events), 1)
        self.assertIn('pages=1-100', events[0])

    def test_toggle_console_always_file_only_when_enabled(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'nested' / 'decisions.log'
            for switch in ('off', 'on'):
                stderr = io.StringIO()
                with patch.dict(os.environ, {'PARSER_LOG_ENABLED': switch, 'PARSER_LOG_FILE': str(path)}), \
                     patch.object(lane_log, '_load_workspace_env'), contextlib.redirect_stderr(stderr):
                    log = lane_log.LaneLog('test.pdf')
                    log.stem(1, ['unicode', 'legacy'])
                    log.finish_page(1, 'rabbit')
                    log.flush()
                self.assertEqual(len(stderr.getvalue().splitlines()), 2)
                self.assertEqual(path.exists(), switch == 'on')
            lines = path.read_text().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertIn('lane-switch', lines[0])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_file_errors_do_not_interrupt_parsing(self):
        with tempfile.TemporaryDirectory() as temp:
            broken = Path(temp) / 'file'
            broken.write_text('not a directory')
            events = []
            tracker = lane_log.LaneLog('book.pdf', Logen(file=broken / 'log', console=events.append))
            tracker.stem(1, ['unicode', 'legacy'])
            tracker.finish_page(1, 'aligned')
            tracker.flush()
            self.assertEqual(len(events), 2)

    def test_pdf_stream_uses_real_name_not_temporary_file(self):
        pages = [dict(idx=i, text='က', decode_kind='identity', font_names=set(),
                      lane_trace=['unicode'] if i == 0 else ['legacy'])
                 for i in range(2)]
        class Detector:
            def detect(self, text): return 'UNICODE', 1
        result = {'base': 'က', 'clean': 'က', 'decision': 'aligned', 'category': 'UNICODE', 'finished': 'က', 'scan': {}}
        messages = []
        logger = Logen(console=messages.append)
        with patch.object(pipeline, 'stream_pdf_pages', return_value=({}, 2, iter(pages))), \
             patch.object(pipeline.finish, 'finish_pdf_page', return_value=result), \
             patch('myangustis_parser.workflow.lane_log.make_logger', return_value=logger):
            _, _, reports = pipeline.process_pdf_stream('/tmp/random.pdf', Detector(), False, book_name='real.pdf')
            self.assertEqual(len(list(reports)), 2)
        self.assertEqual(sum('lane-switch' in m for m in messages), 1)
        self.assertEqual(sum('decision' in m for m in messages), 1)
        self.assertTrue(all('real.pdf' in m for m in messages))
        self.assertIn('rule=aligned', messages[-1])

    def test_page_extraction_collects_probes_without_duplicate_switches(self):
        events = []
        logger = Logen(console=events.append)
        class Detector:
            def detect(self, text): return 'UNICODE', 1
        def extract(objects, num, gen, doc, **kwargs):
            # This is the callback used by the real font decoder, exercised
            # across the probe pages as well as the report iterator.
            for lane in (['unicode'] * 5 if num == 10 else ['unicode'] * 5 + ['legacy'] * 5):
                doc.lane_observer(lane)
            return [(0, 0, 12, 'က')], 100, 100
        finished = {'base': 'က', 'clean': 'က', 'decision': 'aligned', 'category': 'UNICODE', 'finished': 'က', 'scan': {}}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'mixed.pdf'
            path.write_bytes(b'%PDF-1.7')
            with patch.object(pipeline, 'is_encrypted_pdf', return_value=False), \
                 patch.object(pipeline, 'has_object_streams', return_value=False), \
                 patch.object(pipeline, 'parse_pdf_objects', return_value={}), \
                 patch.object(pipeline, 'find_root_pages', return_value=1), \
                 patch.object(pipeline, 'collect_pages', return_value=[(10, 0), (11, 0)]), \
                 patch.object(pipeline, 'page_has_images', return_value=False), \
                 patch.object(pipeline, 'extract_page_lines', side_effect=extract), \
                 patch.object(pipeline.finish, 'finish_pdf_page', return_value=finished), \
                 patch('myangustis_parser.workflow.lane_log.make_logger', return_value=logger):
                _, _, reports = pipeline.process_pdf_stream(path, Detector(), False, text_layout='off')
                self.assertEqual(len(list(reports)), 2)
        self.assertEqual(sum('lane-switch' in line for line in events), 1)
        self.assertIn('page=2', next(line for line in events if 'lane-switch' in line))
        self.assertEqual(sum('[BEAUTIFY]' in line for line in events), 1)

    def test_workspace_dotenv_is_loaded_and_process_environment_wins(self):
        import shutil
        import sys
        source = Path(__file__).resolve().parents[2] / 'index-path.py'
        with tempfile.TemporaryDirectory() as temp, \
             patch.dict(os.environ, {'PARSER_LOG_ENABLED': 'off'}, clear=True), \
             patch.dict(sys.modules, {'index-path': None}), \
             patch.object(lane_log, 'REPO_ROOT', Path(temp)):
            root = Path(temp)
            shutil.copyfile(source, root / 'index-path.py')
            (root / '.env').write_text('PARSER_LOG_ENABLED=on\nPARSER_LOG_FILE=from-env.log\n')
            logger = lane_log.make_logger()
            self.assertIsNone(logger.file)  # explicit process setting wins
            self.assertEqual(os.environ['PARSER_LOG_FILE'], 'from-env.log')

    def test_real_pdf_uses_filename_and_writes_single_decision(self):
        from fpdf import FPDF
        root = Path(__file__).resolve().parents[2]
        font = root / 'Junk/fonts/zawgyi one/ZAWGYI-ONE_V3.1.TTF'
        with tempfile.TemporaryDirectory() as temp:
            pdf = FPDF()
            pdf.add_font('Zawgyi-One', fname=str(font))
            for _ in range(2):
                pdf.add_page()
                pdf.set_font('Zawgyi-One', size=14)
                pdf.cell(text='ေြက')
            path = Path(temp) / 'input.pdf'
            log_file = Path(temp) / 'lane.log'
            pdf.output(str(path))
            stderr = io.StringIO()
            with patch.dict(os.environ, {'PARSER_LOG_ENABLED': 'on', 'PARSER_LOG_FILE': str(log_file)}), \
                 patch.object(lane_log, '_load_workspace_env'), contextlib.redirect_stderr(stderr):
                job = pipeline.process_pdf_bytes(path.read_bytes(), pipeline.load_detector(), filename='စာအုပ်.pdf')
            self.assertEqual(len(job['pages']), 2)
            lines = log_file.read_text().splitlines()
            decisions = [line for line in lines if '[BEAUTIFY]' in line]
            self.assertEqual(len(decisions), 1)
            self.assertIn('စာအုပ်.pdf', decisions[0])
            self.assertIn('1-2', decisions[0])
            self.assertIn('[BEAUTIFY]', stderr.getvalue())

    def test_names_are_escaped_and_logs_do_not_contain_body(self):
        events = []
        tracker = lane_log.LaneLog('/tmp/name\nforged.pdf', Logen(console=events.append))
        tracker.finish_page(1, 'rabbit')
        tracker.flush()
        self.assertEqual(len(events[0].splitlines()), 1)
        self.assertIn(r'\u000a', events[0])


if __name__ == '__main__':
    unittest.main()
