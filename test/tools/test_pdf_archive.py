from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import os
import sys
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import pyarrow.parquet as pq

SCRIPT = Path(__file__).resolve().parents[2] / 'tools-box/python/pdf_archive.py'
spec = importlib.util.spec_from_file_location('pdf_archive', SCRIPT)
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)
CONFIG = {'user': 'u', 'host': 'example', 'port': 22, 'directory': 'pdfs', 'key': ''}


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.files = {'one/a.pdf': b'%PDF-1.7\x00\xfffirst', 'two/a.pdf': b'%PDF-1.7 second'}
        self.calls = []

    def download(self, config, source, ready):
        self.calls.append(source)
        ready.write_bytes(self.files[source])
        return hashlib.sha256(self.files[source]).hexdigest()

    def run_archive(self):
        with patch.object(archive, 'discover', return_value=list(self.files)), \
             patch.object(archive, 'get_download', side_effect=self.download), \
             redirect_stdout(io.StringIO()):
            return archive.run(CONFIG, self.root)

    def test_roundtrip_and_no_redownload(self):
        self.assertEqual(self.run_archive(), 0)
        table = pq.read_table(self.root / 'dataset')
        self.assertEqual({r['filename']: r['pdf'] for r in table.to_pylist()}, self.files)
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(self.calls, list(self.files))

    def test_interrupted_after_download_reuses_ready(self):
        name = 'one/a.pdf'
        dataset, staging = self.root / 'dataset', self.root / 'state'
        dataset.mkdir(); staging.mkdir()
        digest = hashlib.sha256(self.files[name]).hexdigest()
        with patch.object(archive, 'get_download', side_effect=self.download), \
             patch('pyarrow.parquet.write_table', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                archive.archive_one(CONFIG, name, dataset, staging)
        with patch.object(archive, 'remote_digest', return_value=digest), \
             patch.object(archive.subprocess, 'run', side_effect=AssertionError('redownload')):
            archive.archive_one(CONFIG, name, dataset, staging)
        self.assertEqual(pq.read_table(dataset).to_pylist()[0]['pdf'], self.files[name])

    def test_finished_part_reused_but_incomplete_part_replaced(self):
        name = 'one/a.pdf'
        ready = self.root / 'file.pdf'
        part = self.root / '.file.pdf.part'
        digest = hashlib.sha256(self.files[name]).hexdigest()
        part.write_bytes(self.files[name])
        with patch.object(archive, 'remote_digest', return_value=digest), \
             patch.object(archive.subprocess, 'run', side_effect=AssertionError('redownload')):
            self.assertEqual(archive.get_download(CONFIG, name, ready), digest)
        self.assertEqual(ready.read_bytes(), self.files[name])
        ready.unlink()
        part.write_bytes(b'incomplete')
        def transfer(args, stdout, check):
            stdout.write(self.files[name])
        with patch.object(archive, 'remote_digest', return_value=digest), \
             patch.object(archive.subprocess, 'run', side_effect=transfer) as run:
            self.assertEqual(archive.get_download(CONFIG, name, ready), digest)
            run.assert_called_once()

    def test_interrupt_after_commit_does_not_redownload(self):
        name = 'one/a.pdf'
        dataset, staging = self.root / 'dataset', self.root / 'state'
        dataset.mkdir(); staging.mkdir()
        with patch.object(archive, 'get_download', side_effect=self.download), \
             patch.object(archive, 'sync_dir', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                archive.archive_one(CONFIG, name, dataset, staging)
        with patch.object(archive, 'get_download', side_effect=AssertionError('redownload')):
            self.assertFalse(archive.archive_one(CONFIG, name, dataset, staging))
        self.assertEqual(pq.read_table(dataset).num_rows, 1)

    def test_mismatch_and_damaged_shard_are_not_silently_skipped(self):
        self.assertEqual(self.run_archive(), 0)
        with self.assertRaisesRegex(RuntimeError, 'SSH source changed'):
            archive.run(dict(CONFIG, host='other'), self.root)
        shard = next((self.root / 'dataset').iterdir())
        shard.write_bytes(b'broken')
        with patch.object(archive, 'discover', return_value=list(self.files)), \
             patch.object(archive, 'get_download', side_effect=AssertionError('redownload')), \
             redirect_stdout(io.StringIO()):
            self.assertEqual(archive.run(CONFIG, self.root), 1)

    def test_remote_find_and_quoting(self):
        cfg = dict(CONFIG, directory='~/pdfs with spaces')
        with patch.object(archive.ssh_queue, 'ssh', return_value=b'./a b.pdf\0./nested/x.PDF\0') as ssh:
            self.assertEqual(archive.discover(cfg), ['a b.pdf', 'nested/x.PDF'])
            self.assertIn('"$HOME"/', ssh.call_args.args[1])
        with patch.object(archive.ssh_queue, 'ssh', return_value=b'../outside.pdf\0'):
            with self.assertRaises(ValueError):
                archive.discover(cfg)

    def test_cli_with_fake_ssh_and_real_parquet(self):
        remote, output, bin_dir = self.root / 'remote', self.root / 'archive', self.root / 'bin'
        (remote / 'nested').mkdir(parents=True)
        bin_dir.mkdir()
        (remote / 'nested' / 'book one.PDF').write_bytes(b'%PDF-1.7\x00hello')
        log = self.root / 'ssh.log'
        fake = bin_dir / 'ssh'
        fake.write_text("#!/bin/sh\nfor arg do command=$arg; done\nprintf '%s\\n' \"$command\" >> \"$SSH_LOG\"\neval \"$command\"\n")
        fake.chmod(0o755)
        env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
                   SSH_HOST='host', SSH_USER='user', SSH_PORT='22', SSH_KEY='',
                   SSH_DIR=str(remote), SSH_LOG=str(log))
        for _ in range(2):
            result = subprocess.run([sys.executable, str(SCRIPT), '--output', str(output)],
                                    env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(pq.read_table(output / 'dataset').to_pylist(),
                         [{'filename': 'nested/book one.PDF', 'pdf': b'%PDF-1.7\x00hello'}])
        self.assertEqual(sum(line.startswith('cat -- ') for line in log.read_text().splitlines()), 1)
        self.assertTrue((remote / 'nested' / 'book one.PDF').exists())

    def test_transfer_failure_does_not_commit(self):
        dataset, staging = self.root / 'dataset', self.root / 'state'
        dataset.mkdir(); staging.mkdir()
        with patch.object(archive, 'remote_digest', return_value='a' * 64), \
             patch.object(archive.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'ssh')):
            with self.assertRaises(subprocess.CalledProcessError):
                archive.archive_one(CONFIG, 'one/a.pdf', dataset, staging)
        self.assertEqual(list(dataset.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
