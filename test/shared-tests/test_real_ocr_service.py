"""Optional real Tesseract + Parser + Engine + Scraper recovery integration.

Set MYANGUSTIS_REAL_OCR_TEST_PDF to a readable, image-only PDF with Myanmar
text and configure Tesseract/traineddata and Engine resources as for production.
The remote transport is isolated; a separate manual check exercises real SSH.
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
PDF = os.environ.get('MYANGUSTIS_REAL_OCR_TEST_PDF')


@unittest.skipUnless(PDF, 'set MYANGUSTIS_REAL_OCR_TEST_PDF for real OCR integration')
class RealOcrServiceTest(unittest.TestCase):
    def test_ocr_commit_and_interrupted_commit_recovery(self):
        import pyarrow.parquet as parquet
        from myangustis_parser.entry.index import convert, parse_decoding, write_output_file
        sys.path.insert(0, str(ROOT / 'D.Scraper/run'))
        spec = importlib.util.spec_from_file_location(
            'real_ocr_runner', ROOT / 'D.Scraper/run/deploy/continuous-ocr/run.py')
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        source = Path(PDF)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        remote = 'scanned/မြန်မာ book.pdf'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / 'scan/ocr'
            result = convert(source, root / 'conversion.txt', include_text=True)
            self.assertTrue(result['ocrPages'])
            self.assertTrue(result['text'].strip())
            job = parse_decoding(source, apply_cleanup=True)
            self.assertEqual(job['ocrPages'], result['ocrPages'])
            write_output_file(root / 'two-stage.txt', job)
            self.assertIn('posScan', job)
            self.assertIn(result['text'].strip(), (root / 'two-stage.txt').read_text())

            def download(_config, _source, target):
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                return digest

            with patch.object(runner, 'ROOT', root), patch.object(runner, 'STATE', state), \
                 patch.object(runner, 'DB', state / 'state.sqlite3'), \
                 patch.object(runner, 'load_config', return_value=object()), \
                 patch.object(runner, 'discover', return_value=[remote]), \
                 patch.object(runner, 'download', side_effect=download), \
                 patch.object(runner, 'mail_notice'):
                db = runner.database()
                self.addCleanup(db.close)
                runner.run(db)
                row = db.execute('select * from books').fetchone()
                self.assertEqual(row['status'], 'success')
                self.assertFalse(Path(row['local']).exists())
                target = root / 'pdfs/parquet/books.parquet'
                table = parquet.read_table(target)
                self.assertEqual(table.num_rows, 1)
                self.assertTrue(table['text'][0].as_py().strip())
                self.assertTrue(table['segmented'][0].as_py().strip())

                # A crash after starting segmentation leaves the source and
                # digest in the ledger. Recovery must not duplicate its row.
                download(None, remote, Path(row['local']))
                runner.update(db, remote, 'segmenting')
                runner.run(db)
                self.assertEqual(db.execute('select status from books').fetchone()[0], 'success')
                self.assertEqual(parquet.read_table(target).num_rows, 1)
                self.assertTrue(source.is_file())


if __name__ == '__main__':
    unittest.main()
