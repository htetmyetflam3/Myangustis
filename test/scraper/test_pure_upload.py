"""Scraper uploads do not parse or depend on the standalone parser."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'D.Scraper/run'))
import bootstrap  # noqa: F401, E402
import save_remote  # noqa: E402


class PureUploadTest(unittest.TestCase):
    def test_verified_convertable_upload_does_not_parse(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'convertable' / 'book.pdf'
            source.parent.mkdir()
            source.write_bytes(b'pdf')
            config = save_remote.RemoteConfig(host='example', user='tester')
            digest = save_remote.sha256_file(source)
            ledger = save_remote.UploadedLedger({digest: 'pdfs/convertable/book.pdf'})
            with patch.object(save_remote, 'read_uploaded', return_value=ledger), \
                 patch.object(save_remote, 'remote_size', return_value=3), \
                 patch.object(save_remote, 'remote_sha256', return_value=digest):
                outcome = save_remote.push_file(source, config, log=lambda _: None)
            self.assertTrue(outcome.ok)
            self.assertFalse(source.exists())
            self.assertFalse(hasattr(save_remote, 'parse_convertable_book'))
            self.assertFalse(hasattr(save_remote, 'write_parquet_row'))


if __name__ == '__main__': unittest.main()
