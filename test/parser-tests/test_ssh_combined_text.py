"""Continuous SSH parser exports one recoverable, headed text collection."""
from contextlib import redirect_stdout
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pyarrow.parquet as pq
from myangustis_parser.workflow import remote_queue as queue

CFG = {'user': 'u', 'host': 'h', 'port': 22, 'directory': 'pdfs', 'folder': 'old', 'key': ''}


def download(config, source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding='utf-8')
    return queue.digest_file(target)


def convert(src, out, mode):
    return {'text': f'Contents: {src.read_text(encoding="utf-8")}'}


class CombinedTextTests(unittest.TestCase):
    def test_both_outputs_are_written_once_and_rebuilt_if_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            sources = ['old/စာအုပ်.pdf', 'old/book.pdf']
            with patch.object(queue, 'discover', return_value=sources), \
                 patch.object(queue, 'download', side_effect=download) as dl, \
                 patch('myangustis_engine.api.segment_text', return_value='seg'), \
                 redirect_stdout(io.StringIO()):
                parquet = queue.run_once('parse', convert, CFG, root)
                txt = root / 'output/txt/parsed-books.txt'
                text = txt.read_text(encoding='utf-8')
                self.assertEqual(text, '===== စာအုပ် =====\nContents: old/စာအုပ်.pdf\n\n'
                                       '===== book =====\nContents: old/book.pdf\n\n')
                self.assertEqual(len(pq.read_table(parquet).to_pylist()), 2)
                queue.run_once('parse', convert, CFG, root)
                self.assertEqual(txt.read_text(encoding='utf-8'), text)
                self.assertEqual(dl.call_count, 2)
                txt.unlink()
                parquet.unlink()
                queue.run_once('parse', convert, CFG, root)
                self.assertEqual(txt.read_text(encoding='utf-8'), text)
                self.assertEqual(len(pq.read_table(parquet).to_pylist()), 2)
                self.assertEqual(dl.call_count, 2)

    def test_reset_requires_archiving_txt_and_then_reprocesses(self):
        import shutil
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            state = root / 'state/ssh/parse'
            txt = root / 'output/txt/parsed-books.txt'
            parquet = root / 'output/parquet/books.parquet'
            backup = root / 'backup'
            backup.mkdir()
            with patch.object(queue, 'discover', return_value=['old/a.pdf']), \
                 patch.object(queue, 'download', side_effect=download) as dl, \
                 patch('myangustis_engine.api.segment_text', return_value='seg'), \
                 redirect_stdout(io.StringIO()):
                queue.run_once('parse', convert, CFG, root)
                old_text = txt.read_bytes()
                # Simulate a stopped worker and archive its complete state and
                # parquet; leaving the text behind must block a fresh queue.
                shutil.move(str(state), backup / 'parse-state')
                shutil.move(str(parquet), backup / 'books.parquet')
                with self.assertRaisesRegex(RuntimeError, 'untracked text'):
                    queue.run_once('parse', convert, CFG, root)
                self.assertEqual(txt.read_bytes(), old_text)
                self.assertEqual(dl.call_count, 1)
                # Also archive the old text. The empty queue re-downloads the
                # still-available remote source and creates a new collection.
                shutil.move(str(txt), backup / 'parsed-books.txt')
                queue.run_once('parse', convert, CFG, root)
                self.assertEqual(dl.call_count, 2)
                self.assertEqual(txt.read_bytes(), old_text)
                self.assertEqual((backup / 'parsed-books.txt').read_bytes(), old_text)
                self.assertEqual(len(pq.read_table(parquet).to_pylist()), 1)

    def test_old_ledger_backfills_txt_without_reparsing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            state = root / 'state/ssh/parse'
            db = queue._open_db(state)
            db.execute('insert into books values (?,?,?,?,?,?)', ('source', 'book', 'old text', 'seg', 'sha', 'parse'))
            db.commit()
            parquet = root / 'output/parquet/books.parquet'
            queue._export(db, parquet)
            db.close()
            # Simulate a database created by the previous version.
            import sqlite3
            db = sqlite3.connect(state / 'books.sqlite3')
            db.execute('drop table text_export')
            db.commit(); db.close()
            with patch.object(queue, 'discover', return_value=[]), \
                 patch.object(queue, 'download', side_effect=AssertionError('should not download')):
                queue.run_once('parse', None, CFG, root)
            self.assertEqual((root / 'output/txt/parsed-books.txt').read_text(),
                             '===== book =====\nold text\n\n')

    def test_crash_mid_append_recovers_without_duplicate_or_loss(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            db = queue._open_db(root / 'state')
            txt = root / 'out.txt'
            db.execute('insert into books values (?,?,?,?,?,?)', ('a', 'a', 'ပထမ', 'seg', '1', 'parse'))
            db.commit(); queue._sync_text(db, txt)
            db.execute('insert into books values (?,?,?,?,?,?)', ('b', 'b', 'ဒုတိယ', 'seg', '2', 'parse'))
            db.commit()
            fragment = '===== b =====\nဒု'.encode('utf-8')[:-1]  # partial UTF-8 is safe
            with txt.open('ab') as stream: stream.write(fragment)
            queue._sync_text(db, txt)
            self.assertEqual(txt.read_text(), '===== a =====\nပထမ\n\n===== b =====\nဒုတိယ\n\n')
            queue._sync_text(db, txt)
            self.assertEqual(txt.read_text().count('===== b ====='), 1)
            db.close()

    def test_unknown_extra_data_is_not_truncated(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); db = queue._open_db(root / 'state'); txt = root / 'out.txt'
            db.execute('insert into books values (?,?,?,?,?,?)', ('a', 'a', 'original', 'seg', 'sha', 'parse'))
            db.commit(); queue._sync_text(db, txt)
            with txt.open('a') as stream: stream.write('manual addition')
            before = txt.read_bytes()
            with self.assertRaisesRegex(RuntimeError, 'modified outside'):
                queue._sync_text(db, txt)
            self.assertEqual(txt.read_bytes(), before)
            db.close()

    def test_untracked_txt_refused_before_downloading(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); txt = root / 'output/txt/parsed-books.txt'
            txt.parent.mkdir(parents=True); txt.write_text('my old data')
            with patch.object(queue, 'download') as dl, self.assertRaisesRegex(RuntimeError, 'untracked text'):
                queue.run_once('parse', convert, CFG, root)
            dl.assert_not_called()
            self.assertEqual(txt.read_text(), 'my old data')

    def test_failed_text_export_keeps_source_and_stops_next_book(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(queue, 'discover', return_value=['old/a.pdf', 'old/b.pdf']), \
                 patch.object(queue, 'download', side_effect=download) as dl, \
                 patch.object(queue, '_sync_text', side_effect=OSError('disk full')), \
                 patch('myangustis_engine.api.segment_text', return_value='seg'), redirect_stdout(io.StringIO()):
                queue.run_once('parse', convert, CFG, root)
                self.assertEqual(dl.call_count, 1)
            self.assertEqual(len(list(root.glob('state/ssh/parse/staging/*/a.pdf'))), 1)
            with patch.object(queue, 'discover', return_value=['old/a.pdf', 'old/b.pdf']), \
                 patch.object(queue, 'download', side_effect=download) as dl, \
                 patch('myangustis_engine.api.segment_text', return_value='seg'), redirect_stdout(io.StringIO()):
                queue.run_once('parse', convert, CFG, root)
                self.assertEqual(dl.call_count, 1)
            self.assertEqual((root / 'output/txt/parsed-books.txt').read_text(),
                             '===== a =====\nContents: old/a.pdf\n\n===== b =====\nContents: old/b.pdf\n\n')
            self.assertEqual(len(pq.read_table(root / 'output/parquet/books.parquet').to_pylist()), 2)

    def test_shortened_tracked_file_is_rebuilt_from_ledger(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); db = queue._open_db(root / 'state'); txt = root / 'out.txt'
            db.execute('insert into books values (?,?,?,?,?,?)', ('a', 'a', 'original', 'seg', 'sha', 'parse'))
            db.commit(); queue._sync_text(db, txt)
            txt.write_text('damaged')
            queue._sync_text(db, txt)
            self.assertEqual(txt.read_text(), '===== a =====\noriginal\n\n')
            db.close()

    def test_ocr_does_not_create_parser_text(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(queue, 'discover', return_value=['old/a.pdf']), \
                 patch.object(queue, 'download', side_effect=download), \
                 patch('myangustis_engine.api.segment_text', return_value='seg'), redirect_stdout(io.StringIO()):
                parquet = queue.run_once('ocr', convert, CFG, root)
            self.assertTrue(parquet.exists())
            self.assertFalse((root / 'output/txt/parsed-books.txt').exists())


if __name__ == '__main__': unittest.main()
