"""Standalone parser/OCR, safe SSH queue and reusable systemd launcher."""
import importlib.util
import io
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

import pyarrow.parquet as pq
from myangustis_parser.workflow import remote_queue
import systemd_lib

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('independent_parser_main', ROOT / 'B.Parser/main.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_ssh_rejects_paths_and_forces_text_parser_no_ocr(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            runner.main(['parse', '--ssh', 'input.pdf'])
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            runner.main(['parse', '--ssh', 'input.pdf', 'out.pdf'])
        with patch.dict(os.environ, {}, clear=True), \
             patch.object(remote_queue, 'run_forever') as run:
            self.assertEqual(runner.main(['prase', '--ssh']), 0)
            self.assertEqual(os.environ['PRASER_OCR'], 'off')
            self.assertEqual(run.call_args.args[0], 'parse')

    def test_ocr_is_independent_of_parse_and_not_disabled(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(remote_queue, 'run_forever') as run:
            self.assertEqual(runner.main(['ocr', '--ssh']), 0)
            self.assertEqual(run.call_args.args[0], 'ocr')
            self.assertNotIn('PRASER_OCR', os.environ)

    def test_single_file_extension_default_and_junk_only(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            junk = root / 'Junk'
            source = root / 'book.pdf'
            source.write_bytes(b'pdf')
            def convert(src, out, **kwargs):
                self.assertEqual(src, source)
                return {'file': str(out)}
            with patch.object(runner, 'REPO_ROOT', root), patch.object(runner, '_safe_document', side_effect=convert), \
                 redirect_stdout(io.StringIO()):
                self.assertEqual(runner.main(['parse', str(source), 'custom/book']), 0)
                self.assertEqual(runner._new_output(source, 'custom/book'), junk / 'custom/book.pdf')
                self.assertEqual(runner._new_output(source, 'custom/book.docx'), junk / 'custom/book.docx')
                with redirect_stderr(io.StringIO()):
                    self.assertEqual(runner.main(['parse', str(source), str(root / 'outside.pdf')]), 1)

    def test_directory_batch_preserves_nested_paths_and_uses_env(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'input'
            (source / 'nested').mkdir(parents=True)
            (source / 'nested/book.pdf').write_bytes(b'x')
            calls = []
            def convert(src, out, **kw):
                calls.append((src, out, kw['use_ocr']))
                return {'file': str(out)}
            with patch.object(runner, 'REPO_ROOT', root), patch.object(runner, '_safe_document', side_effect=convert), \
                 patch.dict(os.environ, {'PARSER_INPUT_DIR': str(source)}), redirect_stdout(io.StringIO()):
                self.assertEqual(runner.main(['parse', str(source), 'batch/']), 0)
                self.assertEqual(calls[0][1], root / 'Junk/batch/nested/book.pdf')

    def test_failed_output_is_not_published_or_left_partial(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source.pdf'; source.write_bytes(b'input')
            output = root / 'output' / 'out.txt'
            def fail(src, path, **kwargs):
                path.write_text('partial')
                raise ValueError('failed')
            with patch.object(runner, 'run_document', side_effect=fail):
                with self.assertRaises(ValueError): runner._safe_document(source, output, use_ocr=False)
            self.assertFalse(output.exists())
            self.assertEqual(list(output.parent.iterdir()), [])

    def test_no_overwrite_and_invalid_ssh_folder(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'book.pdf'; source.write_bytes(b'x')
            dest = root / 'Junk/book.pdf'; dest.parent.mkdir(); dest.write_bytes(b'original')
            with patch.object(runner, 'REPO_ROOT', root), redirect_stderr(io.StringIO()):
                self.assertEqual(runner.main(['parse', str(source), 'book.pdf']), 1)
            self.assertEqual(dest.read_bytes(), b'original')
        with patch.dict(os.environ, {'SSH_HOST': 'host', 'SSH_USER': 'user', 'REMOTE_PRASER_DIR': '../x'}, clear=True):
            with self.assertRaises(ValueError): remote_queue.remote_config('parse')

    def test_service_install_passes_foreground_and_does_not_use_scraper(self):
        with patch.object(systemd_lib, 'install_and_start') as install:
            self.assertEqual(runner.main(['ocr', '--ssh', '--service']), 0)
        name, command, directory = install.call_args.args
        self.assertEqual(name, 'myangustis-ocr.service')
        self.assertEqual(command[-3:], ['ocr', '--ssh', '--foreground'])
        self.assertNotIn('D.Scraper', ' '.join(map(str, command)))
        self.assertEqual(directory, ROOT)

    def test_local_source_can_be_set_in_env(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'book.pdf'; source.write_bytes(b'pdf')
            with patch.object(runner, 'REPO_ROOT', root), \
                 patch.object(runner.paths, 'output_dir_for', return_value=root / 'Junk/output'), \
                 patch.object(runner, '_safe_document', return_value={'file': 'saved'}) as convert, \
                 patch.dict(os.environ, {'PARSER_INPUT_DIR': str(source)}), redirect_stdout(io.StringIO()):
                self.assertEqual(runner.main(['parse']), 0)
                self.assertEqual(convert.call_args.args[0], source)
                self.assertEqual(convert.call_args.args[1], root / 'Junk/output/book.pdf')

    def test_systemd_unit_quote_and_service_no_ocr(self):
        unit = systemd_lib.render_unit('test.service', ['/path with space/python', 'x%y', '$HOME'], '/a b')
        self.assertIn('"/path with space/python" "x%%y" "$$HOME"', unit)
        self.assertIn('WorkingDirectory=/a b', unit)
        with self.assertRaises(ValueError): systemd_lib.render_unit('../bad.service', ['x'], '/')


class RemoteQueueTests(unittest.TestCase):
    def test_ssh_parquet_one_collection_restart_and_recovery(self):
        cfg = {'user': 'bob', 'host': 'host', 'port': 22, 'directory': '~/pdfs', 'folder': 'old', 'key': ''}
        with tempfile.TemporaryDirectory() as temp:
            runtime = Path(temp)
            sources = ['old/a.pdf', 'old/sub/a.pdf']
            def download(config, source, target):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.encode())
                return remote_queue.digest_file(target)
            def convert(src, out, mode): return {'text': f'{mode}: {src.read_text()}'}
            with patch.object(remote_queue, 'discover', return_value=sources), \
                 patch.object(remote_queue, 'download', side_effect=download) as dl, \
                 patch('myangustis_engine.api.segment_text', side_effect=lambda text: 'seg:' + text), \
                 redirect_stdout(io.StringIO()):
                result = remote_queue.run_once('parse', convert, cfg, runtime)
                self.assertEqual(len(pq.read_table(result).to_pylist()), 2)
                self.assertEqual(dl.call_count, 2)
                remote_queue.run_once('parse', convert, cfg, runtime)
                self.assertEqual(dl.call_count, 2)
                result.unlink()
                remote_queue.run_once('parse', convert, cfg, runtime)
                rows = pq.read_table(result).to_pylist()
                self.assertEqual(len(rows), 2)
                self.assertEqual(len({row['book'] for row in rows}), 2)
                self.assertEqual(dl.call_count, 2)
                ocr_result = remote_queue.run_once('ocr', convert, cfg, runtime)
                self.assertEqual(len(pq.read_table(ocr_result).to_pylist()), 2)
                self.assertEqual(len(pq.read_table(result).to_pylist()), 2)

    def test_failed_conversion_retains_local_input(self):
        cfg = {'user': 'u', 'host': 'h', 'port': 22, 'directory': 'pdfs', 'folder': 'old', 'key': ''}
        with tempfile.TemporaryDirectory() as temp:
            runtime = Path(temp)
            def download(config, source, target):
                target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(b'original')
                return 'digest'
            with patch.object(remote_queue, 'discover', return_value=['old/a.pdf']), \
                 patch.object(remote_queue, 'download', side_effect=download), redirect_stdout(io.StringIO()):
                remote_queue.run_once('parse', lambda *_: (_ for _ in ()).throw(ValueError('failed')), cfg, runtime)
            self.assertEqual([p.read_bytes() for p in runtime.glob('state/ssh/parse/staging/*/a.pdf')], [b'original'])

    def test_discovery_scoped_to_requested_child_and_ssh_is_noninteractive(self):
        cfg = {'user': 'u', 'host': 'h', 'port': 22, 'directory': '~/pdfs with space', 'folder': 'old', 'key': ''}
        with patch.object(remote_queue, 'ssh', return_value=b'./old/a.pdf\0./old/sub/b.pdf\0') as call:
            self.assertEqual(remote_queue.discover(cfg), ['old/a.pdf', 'old/sub/b.pdf'])
            self.assertIn('"$HOME"', call.call_args.args[1])
        argv = remote_queue.ssh_args(cfg, 'echo hi')
        self.assertIn('BatchMode=yes', argv)
        with patch.object(remote_queue, 'ssh', return_value=b'./old/../../escape.pdf\0'):
            with self.assertRaises(ValueError): remote_queue.discover(cfg)

    def test_failed_export_is_recovered_from_ledger(self):
        cfg = {'user': 'u', 'host': 'h', 'port': 22, 'directory': 'pdfs', 'folder': 'old', 'key': ''}
        with tempfile.TemporaryDirectory() as temp:
            runtime = Path(temp)
            def download(config, source, target):
                target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(b'original')
                return 'digest'
            with patch.object(remote_queue, 'discover', return_value=['old/a.pdf']), \
                 patch.object(remote_queue, 'download', side_effect=download) as dl, \
                 patch('myangustis_engine.api.segment_text', return_value='seg'), \
                 patch.object(remote_queue, '_export', side_effect=OSError('disk full')), \
                 redirect_stdout(io.StringIO()):
                remote_queue.run_once('parse', lambda *_: {'text': 'book'}, cfg, runtime)
                self.assertEqual(dl.call_count, 1)
            with patch.object(remote_queue, 'discover', return_value=['old/a.pdf']), \
                 patch.object(remote_queue, 'download', side_effect=AssertionError('duplicate download')):
                output = remote_queue.run_once('parse', None, cfg, runtime)
            self.assertEqual(pq.read_table(output).to_pylist()[0]['text'], 'book')

    def test_low_disk_stops_before_download(self):
        cfg = {'user': 'u', 'host': 'h', 'port': 22, 'directory': 'pdfs', 'folder': 'old', 'key': ''}
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(remote_queue, 'discover', return_value=['old/a.pdf']), \
             patch.object(remote_queue.shutil, 'disk_usage') as usage, \
             patch.object(remote_queue, 'download') as download:
            usage.return_value.free = 1
            with self.assertRaisesRegex(RuntimeError, '5 GiB'):
                remote_queue.run_once('parse', None, cfg, Path(temp))
            download.assert_not_called()

    def test_real_pdf_through_independent_queue(self):
        from fpdf import FPDF
        cfg = {'user': 'u', 'host': 'h', 'port': 22, 'directory': 'pdfs', 'folder': 'old', 'key': ''}
        with tempfile.TemporaryDirectory() as temp:
            runtime = Path(temp)
            pdf = FPDF(); pdf.add_page(); pdf.set_font('Helvetica', size=12); pdf.cell(text='Hello parser')
            generated = runtime / 'source.pdf'; pdf.output(str(generated))
            def download(config, source, target):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(generated.read_bytes())
                return remote_queue.digest_file(target)
            def convert(src, out, mode):
                return runner.run_document(src, out, use_ocr=False, log=lambda _: None)
            with patch.dict(os.environ, {'PRASER_OCR': 'off'}), \
                 patch.object(remote_queue, 'discover', return_value=['old/book.pdf']), \
                 patch.object(remote_queue, 'download', side_effect=download), \
                 patch('myangustis_engine.api.segment_text', return_value='segments'), \
                 redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                output = remote_queue.run_once('parse', convert, cfg, runtime)
            row = pq.read_table(output).to_pylist()[0]
            self.assertIn('Hello parser', row['text'])
            self.assertEqual(row['segmented'], 'segments')
            self.assertTrue(generated.exists())

    def test_untracked_existing_parquet_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            runtime = Path(temp)
            output = runtime / 'output/parquet/books.parquet'
            output.parent.mkdir(parents=True); output.write_bytes(b'existing')
            with self.assertRaisesRegex(RuntimeError, 'untracked'):
                remote_queue.run_once('parse', None, {'user': 'u'}, runtime)
            self.assertEqual(output.read_bytes(), b'existing')


if __name__ == '__main__': unittest.main()
