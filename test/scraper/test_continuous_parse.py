"""Continuous parse queue selection, TXT durability and Parquet output."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'D.Scraper/run'))
file = ROOT / 'D.Scraper/run/deploy/continuous-parse/run.py'
spec = importlib.util.spec_from_file_location('continuous_parse_test', file)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
import parse_queue


class ContinuousParseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.state = self.root / 'scan' / 'parse'
        self.text = self.root / 'pdfs' / 'parquet' / 'parsed-books.txt'
        self.patches = [patch.object(runner, 'ROOT', self.root),
                        patch.object(runner, 'STATE', self.state),
                        patch.object(runner, 'DB', self.state / 'state.sqlite3'),
                        patch.object(runner, 'TEXT_FILE', self.text)]
        for p in self.patches:
            p.start()
        self.db = runner.database()

    def tearDown(self):
        self.db.close()
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def test_queue_setting_validates_one_child_and_environment_precedence(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(parse_queue, '_env_values', return_value={}):
            self.assertEqual(parse_queue.remote_parser_dir(), 'convertable')
        for text in ('/old/', 'old', '/မြန်မာ စာ/'):
            with self.subTest(text=text), patch.dict(os.environ, {'REMOTE_PRASER_DIR': text}):
                self.assertEqual(parse_queue.remote_parser_dir(), text.strip('/'))
        for text in ('/', '..', '../old', 'old/other', 'old\\other', 'old\nname'):
            with self.subTest(text=text), patch.dict(os.environ, {'REMOTE_PRASER_DIR': text}):
                with self.assertRaises(ValueError):
                    parse_queue.remote_parser_dir()
        with patch.dict(os.environ, {}, clear=True), patch.object(parse_queue, '_env_values', return_value={'REMOTE_PRASER_DIR': '/old/'}):
            self.assertEqual(parse_queue.remote_parser_dir(), 'old')

    def test_discover_expands_remote_home_and_stays_in_old(self):
        home = self.root / 'home'
        pdf = home / 'domains' / 'site' / 'pdfs'
        (pdf / 'old' / 'nested').mkdir(parents=True)
        (pdf / 'old' / 'nested' / 'စာအုပ် name.pdf').write_bytes(b'x')
        (pdf / 'convertable').mkdir()
        (pdf / 'convertable' / 'not-old.pdf').write_bytes(b'x')
        config = SimpleNamespace(directory='~/domains/site/pdfs')
        def ssh_execute(config, command):
            return subprocess.run(['bash', '-c', command], env={**os.environ, 'HOME': str(home)},
                                  capture_output=True, check=True).stdout
        with patch.object(runner, 'ssh', side_effect=ssh_execute):
            self.assertEqual(runner.discover(config, 'old'), ['old/nested/စာအုပ် name.pdf'])
            with self.assertRaises(subprocess.CalledProcessError):
                runner.discover(config, 'missing')
        self.assertEqual(runner.remote_shell_path('~/domains/site/pdfs/old/book.pdf'),
                         '"$HOME"/domains/site/pdfs/old/book.pdf')

    def test_download_uses_remote_home_for_checksum_and_content(self):
        home = self.root / 'home'
        source = home / 'domains/site/pdfs/old/စာ အုပ်.pdf'
        source.parent.mkdir(parents=True)
        source.write_bytes(b'original remote PDF')
        target = self.root / 'download.pdf'
        config = SimpleNamespace(directory='~/domains/site/pdfs')
        with patch.dict(os.environ, {'HOME': str(home)}), \
             patch.object(runner, '_ssh_argv', side_effect=lambda config, command: ['bash', '-c', command]):
            digest = runner.download(config, 'old/စာ အုပ်.pdf', target)
        self.assertEqual(target.read_bytes(), source.read_bytes())
        self.assertEqual(digest, runner.sha256_file(source))
        self.assertTrue(source.exists())

    def test_workspace_dotenv_loads_before_remote_config(self):
        import importlib
        workspace = importlib.import_module('index-path')
        (self.root / '.env').write_text('SSH_HOST=host\nSSH_USER=user\nSSH_DIR=~/pdfs\nREMOTE_PRASER_DIR=/old/\n')
        with patch.dict(os.environ, {}, clear=True), \
             patch.object(workspace, 'ROOT_DIR', self.root), \
             patch.object(workspace, 'ENGINE_DATA_DIR', self.root / 'missing'):
            parse_queue.load_workspace_env()
            config = runner.load_config()
            self.assertEqual((config.host, config.user, config.directory), ('host', 'user', '~/pdfs'))
            self.assertEqual(parse_queue.remote_parser_dir(), 'old')

    def test_text_sections_restart_repair_update_and_missing_file(self):
        runner.save_text_section(self.db, 'old/တစ်.pdf', 'တစ်', 'ပထမ စာသား')
        runner.sync_text_collection(self.db)
        original = self.text.read_text(encoding='utf-8')
        self.assertEqual(original, '===== တစ် =====\nပထမ စာသား\n\n')
        runner.save_text_section(self.db, 'old/တစ်.pdf', 'တစ်', 'ပထမ စာသား')
        runner.sync_text_collection(self.db)
        self.assertEqual(self.text.read_text(), original)
        # Simulate a torn append between fsync and the SQLite bookkeeping.
        runner.save_text_section(self.db, 'old/second.pdf', 'second', 'second text')
        with self.text.open('ab') as f:
            f.write(b'partial')
        runner.sync_text_collection(self.db)
        self.assertEqual(self.text.read_text(), original + '===== second =====\nsecond text\n\n')
        runner.save_text_section(self.db, 'old/တစ်.pdf', 'တစ်', 'ပြင်ပြီး')
        runner.sync_text_collection(self.db)
        expected = '===== တစ် =====\nပြင်ပြီး\n\n===== second =====\nsecond text\n\n'
        self.assertEqual(self.text.read_text(), expected)
        self.text.unlink()
        runner.sync_text_collection(self.db)
        self.assertEqual(self.text.read_text(), expected)

    def test_unknown_existing_text_not_overwritten(self):
        self.text.parent.mkdir(parents=True)
        self.text.write_text('owner data')
        with self.assertRaisesRegex(RuntimeError, 'Refusing to overwrite'):
            runner.sync_text_collection(self.db)
        self.assertEqual(self.text.read_text(), 'owner data')

    def test_real_parquet_and_text_are_written_and_restart_is_idempotent(self):
        import pyarrow.parquet as pq
        remote = 'old/မြန်မာ စာ.pdf'
        config = SimpleNamespace(directory='~/domains/site/pdfs')
        def download(config, source, target):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'pdf sample')
            return runner.sha256_file(target)
        patches = [patch.object(runner, 'load_workspace_env'),
                   patch.object(runner, 'load_config', return_value=config),
                   patch.object(runner, 'remote_parser_dir', return_value='old'),
                   patch.object(runner, 'discover', return_value=[remote]),
                   patch.object(runner, 'download', side_effect=download),
                   patch.object(runner, 'mail_notice'), patch.object(runner, 'reminders'),
                   patch.object(runner, 'DISK_FLOOR', 0),
                   patch.object(runner.text_collect, 'parse_convertable_book_direct',
                                return_value=('မြန်မာ စာ', 'စာသား\nဒုတိယစာကြောင်း', 'segmented'))]
        for p in patches:
            p.start()
        try:
            runner.run(self.db)
            parquet = self.root / 'pdfs/parquet/books.parquet'
            data = pq.read_table(parquet).to_pylist()
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]['book'], 'မြန်မာ စာ')
            self.assertEqual(data[0]['text'], 'စာသား\nဒုတိယစာကြောင်း')
            self.assertEqual(data[0]['segmented'], 'segmented')
            output = '===== မြန်မာ စာ =====\nစာသား\nဒုတိယစာကြောင်း\n\n'
            self.assertEqual(self.text.read_text(), output)
            self.assertFalse((self.root / 'pdfs/.parse' / remote).exists())
            runner.run(self.db)
            self.assertEqual(len(pq.read_table(parquet)), 1)
            self.assertEqual(self.text.read_text(), output)
        finally:
            for p in reversed(patches):
                p.stop()

    def test_duplicate_pdf_aliases_do_not_reprocess_after_restart(self):
        import pyarrow.parquet as pq
        config = SimpleNamespace(directory='pdfs')
        sources = ['old/first.pdf', 'old/second.pdf']
        def download(config, source, target):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'identical pdf')
            return runner.sha256_file(target)
        def parsed(path, log):
            return path.stem, 'same text', 'same segments'
        with patch.object(runner, 'load_workspace_env'), \
             patch.object(runner, 'load_config', return_value=config), \
             patch.object(runner, 'remote_parser_dir', return_value='old'), \
             patch.object(runner, 'discover', return_value=sources), \
             patch.object(runner, 'download', side_effect=download) as pull, \
             patch.object(runner.text_collect, 'parse_convertable_book_direct', side_effect=parsed), \
             patch.object(runner, 'mail_notice'), patch.object(runner, 'reminders'), \
             patch.object(runner, 'DISK_FLOOR', 0):
            runner.run(self.db)
            self.assertEqual(pull.call_count, 2)
            runner.run(self.db)
            self.assertEqual(pull.call_count, 2)
        rows = pq.read_table(self.root / 'pdfs/parquet/books.parquet').to_pylist()
        self.assertEqual(len(rows), 1)  # existing cross-service duplicate guard
        self.assertEqual(self.text.read_text(),
                         '===== first =====\nsame text\n\n===== second =====\nsame text\n\n')

    def test_old_queue_does_not_process_pending_other_folder(self):
        self.db.execute('insert into books(source,local,status,updated) values (?,?,?,?)',
                        ('convertable/other.pdf', str(self.root / 'other.pdf'), 'pending', 1))
        self.db.commit()
        with patch.object(runner, 'load_workspace_env'), \
             patch.object(runner, 'load_config', return_value=SimpleNamespace(directory='pdfs')), \
             patch.object(runner, 'remote_parser_dir', return_value='old'), \
             patch.object(runner, 'discover', return_value=[]), \
             patch.object(runner, 'download') as download, \
             patch.object(runner, 'mail_notice'):
            runner.run(self.db)
            download.assert_not_called()
        self.assertEqual(self.db.execute('select status from books').fetchone()[0], 'pending')

    def test_previous_success_recovers_text_from_parquet(self):
        local = self.root / 'old.pdf'
        self.db.execute('insert into books(source,local,status,digest,updated,book_key) values (?,?,?,?,?,?)',
                        ('old/book.pdf', str(local), 'success', 'sha', 1, 'book'))
        self.db.commit()
        runner.text_collect.write_parquet_row(self.root / 'pdfs', 'book', 'earlier text', 'segments', sha256='sha')
        with patch.object(runner, 'load_workspace_env'), \
             patch.object(runner, 'load_config', return_value=SimpleNamespace(directory='pdfs')), \
             patch.object(runner, 'remote_parser_dir', return_value='old'), \
             patch.object(runner, 'discover', return_value=[]), \
             patch.object(runner, 'mail_notice'):
            runner.run(self.db)
        self.assertEqual(self.text.read_text(), '===== book =====\nearlier text\n\n')

    def test_real_generated_zawgyi_font_pdf_both_outputs(self):
        from fpdf import FPDF
        import pyarrow.parquet as pq
        if 'myangustis_parser' not in sys.modules:
            p = ROOT / 'B.Parser/architecture/__init__.py'
            spec = importlib.util.spec_from_file_location('myangustis_parser', p,
                         submodule_search_locations=[str(p.parent)])
            module = importlib.util.module_from_spec(spec)
            sys.modules['myangustis_parser'] = module
            spec.loader.exec_module(module)
        source = self.root / 'source.pdf'
        pdf = FPDF()
        pdf.add_page()
        pdf.add_font('Zawgyi-One', fname=str(ROOT / 'Junk/fonts/zawgyi one/ZAWGYI-ONE_V3.1.TTF'))
        pdf.set_font('Zawgyi-One', size=14)
        pdf.cell(text='ေြက')
        pdf.output(str(source))
        def download(config, remote, target):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
            return runner.sha256_file(target)
        with patch.object(runner, 'load_workspace_env'), \
             patch.object(runner, 'load_config', return_value=SimpleNamespace(directory='pdfs')), \
             patch.object(runner, 'remote_parser_dir', return_value='old'), \
             patch.object(runner, 'discover', return_value=['old/စာအုပ်.pdf']), \
             patch.object(runner, 'download', side_effect=download), \
             patch.object(runner, 'mail_notice'), patch.object(runner, 'reminders'), \
             patch.object(runner, 'DISK_FLOOR', 0):
            runner.run(self.db)
        rows = pq.read_table(self.root / 'pdfs/parquet/books.parquet').to_pylist()
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]['text'].strip())
        self.assertEqual(rows[0]['book'], 'စာအုပ်')
        self.assertEqual(self.text.read_text(), '===== စာအုပ် =====\n' + rows[0]['text'] + '\n\n')
        # This tests wiring and matching outputs, not old-font conversion accuracy.

    def test_text_failure_does_not_mark_success_or_delete_local_pdf(self):
        local = self.root / 'book.pdf'
        local.write_bytes(b'input')
        self.db.execute('insert into books(source,local,status,digest,updated) values (?,?,?,?,?)',
                        ('old/book.pdf', str(local), 'parsing', 'hash', 1))
        self.db.commit()
        row = self.db.execute('select * from books').fetchone()
        final = self.root / 'books.parquet'
        final.write_bytes(b'parquet')
        with patch.object(runner.text_collect, 'write_parquet_row', return_value=final), \
             patch.object(runner, 'sync_text_collection', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                runner.commit_dataset(self.db, row, ('book', 'text', 'segmented'))
        self.assertTrue(local.exists())
        self.assertEqual(self.db.execute('select status from books').fetchone()[0], 'parsing')


if __name__ == '__main__':
    unittest.main()
