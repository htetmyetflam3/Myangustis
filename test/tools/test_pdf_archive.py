from contextlib import redirect_stdout, redirect_stderr
import errno
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import fastparquet
import pyarrow as pa
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
        self.files = {'one/a.pdf': b'%PDF-1.7\x00\xfffirst', 'two/a.pdf': b'%PDF-1.7 second',
                      'three/စာ.pdf': b'%PDF\x00third'}
        self.calls = []

    def download(self, config, source, ready):
        if not ready.exists():
            self.calls.append(source)
            ready.write_bytes(self.files[source])
        return hashlib.sha256(ready.read_bytes()).hexdigest()

    def run_archive(self, **kwargs):
        with patch.object(archive, 'discover', return_value=list(self.files)), \
             patch.object(archive, 'get_download', side_effect=self.download), \
             redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return archive.run(CONFIG, self.root, **kwargs)

    def rows(self):
        rows = pq.read_table(self.root / 'dataset').to_pylist()
        return {r['filename']: r['pdf'] for r in rows}

    def shards(self):
        return list((self.root / 'dataset').glob('batch-*.parquet'))

    def legacy(self, source):
        dataset = self.root / 'dataset'
        dataset.mkdir(exist_ok=True)
        data = self.files[source]
        digest = hashlib.sha256(data).hexdigest()
        schema = pa.schema([('filename', pa.string()), ('pdf', pa.binary())],
                           metadata={b'source': source.encode(), b'sha256': digest.encode()})
        path = dataset / (archive.file_id(source) + '.parquet')
        table = pa.Table.from_arrays([pa.array([source]), pa.array([data])], schema=schema)
        pq.write_table(table, path, compression='zstd')
        return path

    def test_multiple_rows_per_file_and_no_redownload(self):
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(len(self.shards()), 1)
        self.assertEqual(pq.read_metadata(self.shards()[0]).num_rows, 3)
        self.assertEqual(self.rows(), self.files)
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(self.calls, list(self.files))
        self.assertFalse(list((self.root / 'state').glob('*.pdf')))

    def test_original_one_pdf_shards_migrate_without_download(self):
        archive.configure_archive(self.root, CONFIG)
        originals = [self.legacy(name) for name in list(self.files)[:2]]
        self.assertEqual(self.run_archive(), 0)
        self.assertTrue(all(not path.exists() for path in originals))
        self.assertEqual(self.calls, ['three/စာ.pdf'])
        self.assertEqual(self.rows(), self.files)
        self.assertEqual(len(self.shards()), 1)
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(self.calls, ['three/စာ.pdf'])

    def test_migrate_over_200_original_parquets_without_network_download(self):
        self.files = {f'old/{index:04d}.pdf': f'%PDF-{index}'.encode() for index in range(210)}
        archive.configure_archive(self.root, CONFIG)
        for source in self.files:
            self.legacy(source)
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(self.calls, [])
        self.assertEqual(len(self.shards()), 1)
        self.assertEqual(len(list((self.root / 'dataset').glob('*.parquet'))), 1)
        self.assertEqual(self.rows(), self.files)

    def test_interruption_during_legacy_append_preserves_original(self):
        archive.configure_archive(self.root, CONFIG)
        old = self.legacy('one/a.pdf')
        real_write = fastparquet.write
        def interrupted(*args, **kwargs):
            real_write(*args, **kwargs)
            raise KeyboardInterrupt
        with patch.object(fastparquet, 'write', side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.run_archive()
        self.assertTrue(old.exists())
        self.assertEqual(self.run_archive(), 0)
        self.assertFalse(old.exists())
        self.assertNotIn('one/a.pdf', self.calls)
        self.assertEqual(self.rows(), self.files)

    def test_interruption_after_commit_before_legacy_cleanup(self):
        archive.configure_archive(self.root, CONFIG)
        old = self.legacy('one/a.pdf')
        with patch.object(archive, 'verify_record', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.run_archive()
        self.assertTrue(old.exists())
        self.assertEqual(self.run_archive(), 0)
        self.assertFalse(old.exists())
        self.assertNotIn('one/a.pdf', self.calls)
        self.assertEqual(self.rows(), self.files)

    def test_corrupt_legacy_never_deleted_or_downloaded(self):
        archive.configure_archive(self.root, CONFIG)
        old = self.legacy('one/a.pdf')
        old.write_bytes(b'corrupt')
        with self.assertRaises((ValueError, OSError)):
            self.run_archive()
        self.assertEqual(old.read_bytes(), b'corrupt')
        self.assertEqual(self.calls, [])

    def test_shard_limit_is_actual_file_size_not_pdf_count(self):
        for key in self.files:
            self.files[key] += b'x' * 250
        self.assertEqual(self.run_archive(max_bytes=1450), 0)
        self.assertGreater(len(self.shards()), 1)
        self.assertTrue(all(p.stat().st_size <= 1450 for p in self.shards()))
        self.assertEqual(self.rows(), self.files)

    def test_oversized_single_pdf_keeps_input(self):
        self.files = {'large.pdf': b'x' * 1200}
        self.assertEqual(self.run_archive(max_bytes=1000), 1)
        staged = self.root / 'state' / (archive.file_id('large.pdf') + '.pdf')
        self.assertEqual(staged.read_bytes(), self.files['large.pdf'])
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(self.calls, ['large.pdf'])
        self.assertEqual(self.rows(), self.files)

    def test_interrupted_append_restores_existing_footer_and_reuses_download(self):
        self.files = {'a.pdf': b'pdf-a', 'b.pdf': b'pdf-b'}
        real_write = fastparquet.write
        def interrupt_second(path, frame, **kwargs):
            real_write(path, frame, **kwargs)
            if kwargs['append']:
                raise KeyboardInterrupt
        with patch.object(fastparquet, 'write', side_effect=interrupt_second):
            with self.assertRaises(KeyboardInterrupt):
                self.run_archive()
        self.assertEqual(pq.read_table(self.root / 'dataset').to_pylist(),
                         [{'filename': 'a.pdf', 'pdf': b'pdf-a'}])
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(self.calls, ['a.pdf', 'b.pdf'])
        self.assertEqual(self.rows(), self.files)

    def test_crash_journal_recovery_restores_footer(self):
        self.assertEqual(self.run_archive(), 0)
        dataset = self.root / 'dataset'
        db = archive.open_ledger(self.root, dataset)
        shard, size, count = db.execute('select id, size, rows from shards').fetchone()
        path = self.shards()[0]
        old_size, footer = archive.read_footer(path)
        with db:
            db.execute('insert into journal values (1, ?, ?, ?)', (shard, old_size, footer))
        with path.open('r+b') as stream:
            stream.seek(-30, os.SEEK_END)
            stream.write(b'partial mutation')
            stream.truncate()
        db.close()
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(self.rows(), self.files)
        self.assertEqual(len(self.calls), 3)

    def test_completed_partial_download_reused(self):
        name = 'one/a.pdf'
        ready = self.root / 'file.pdf'
        part = self.root / '.file.pdf.part'
        digest = hashlib.sha256(self.files[name]).hexdigest()
        part.write_bytes(self.files[name])
        with patch.object(archive, 'remote_digest', return_value=digest), \
             patch.object(archive.subprocess, 'run', side_effect=AssertionError('redownload')):
            self.assertEqual(archive.get_download(CONFIG, name, ready), digest)
        self.assertEqual(ready.read_bytes(), self.files[name])

    def test_missing_shard_stops_without_redownloading(self):
        self.assertEqual(self.run_archive(), 0)
        self.shards()[0].unlink()
        with self.assertRaisesRegex(RuntimeError, 'missing or changed'):
            self.run_archive()
        self.assertEqual(self.calls, list(self.files))

    def test_disk_full_mid_append_restores_existing_footer(self):
        self.files = {'a.pdf': b'first', 'b.pdf': b'second'}
        original_write = fastparquet.write
        def disk_full(path, frame, **kwargs):
            if kwargs['append']:
                with open(path, 'ab') as stream:
                    stream.write(b'partial bytes')
                raise OSError(errno.ENOSPC, 'disk full')
            return original_write(path, frame, **kwargs)
        with patch.object(fastparquet, 'write', side_effect=disk_full):
            with self.assertRaises(OSError):
                self.run_archive()
        self.assertEqual(pq.read_table(self.root / 'dataset').to_pylist(),
                         [{'filename': 'a.pdf', 'pdf': b'first'}])
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(self.rows(), self.files)
        self.assertEqual(self.calls, ['a.pdf', 'b.pdf'])

    def test_no_space_stops_and_preserves_original(self):
        archive.configure_archive(self.root, CONFIG)
        old = self.legacy('one/a.pdf')
        with patch.object(archive.shutil, 'disk_usage', return_value=type('Usage', (), {'free': 0})()):
            with self.assertRaises(OSError):
                self.run_archive()
        self.assertTrue(old.exists())
        self.assertEqual(self.calls, [])

    def test_cli_fake_ssh_and_count(self):
        remote, output, bin_dir = self.root / 'remote', self.root / 'archive', self.root / 'bin'
        (remote / 'nested').mkdir(parents=True)
        bin_dir.mkdir()
        remote_files = {'nested/book one.PDF': b'%PDF-1.7\x00hello', 'two.pdf': b'%PDF-1.7 second'}
        for name, pdf in remote_files.items():
            (remote / name).write_bytes(pdf)
        log = self.root / 'ssh.log'
        fake = bin_dir / 'ssh'
        fake.write_text("#!/bin/sh\nfor arg do command=$arg; done\nprintf '%s\\n' \"$command\" >> \"$SSH_LOG\"\neval \"$command\"\n")
        fake.chmod(0o755)
        env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
                   SSH_HOST='host', SSH_USER='user', SSH_PORT='22', SSH_KEY='',
                   SSH_DIR=str(remote), SSH_LOG=str(log))
        command = [sys.executable, str(SCRIPT), '--output', str(output)]
        count = subprocess.run(command + ['--count'], env=env, capture_output=True, text=True)
        self.assertEqual(count.returncode, 0, count.stderr)
        self.assertIn(': 2', count.stdout)
        self.assertFalse(output.exists())
        for _ in range(2):
            result = subprocess.run(command, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        rows = pq.read_table(output / 'dataset').to_pylist()
        self.assertEqual({r['filename']: r['pdf'] for r in rows}, remote_files)
        self.assertEqual(len(list((output / 'dataset').glob('batch-*.parquet'))), 1)
        self.assertEqual(sum(line.startswith('cat -- ') for line in log.read_text().splitlines()), 2)
        self.assertTrue(all((remote / name).exists() for name in remote_files))

    def test_remote_find_rejects_unsafe_paths(self):
        with patch.object(archive.ssh_queue, 'ssh', return_value=b'../outside.pdf\0'):
            with self.assertRaises(ValueError):
                archive.discover(CONFIG)


if __name__ == '__main__':
    unittest.main()
