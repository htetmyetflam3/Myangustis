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

    def test_multiple_rows_per_file_and_no_redownload(self):
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(len(self.shards()), 1)
        self.assertEqual(pq.read_metadata(self.shards()[0]).num_rows, 3)
        self.assertEqual(self.rows(), self.files)
        self.assertEqual(self.run_archive(), 0)
        self.assertEqual(self.calls, list(self.files))
        self.assertFalse(list((self.root / 'state').glob('*.pdf')))

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

    def test_insufficient_space_stops_before_transfer(self):
        ready = self.root / 'large.pdf'
        with patch.object(archive, 'remote_digest', return_value='a' * 64), \
             patch.object(archive, 'ssh', return_value=b'10000\n'), \
             patch.object(archive.shutil, 'disk_usage', return_value=type('Usage', (), {'free': 1024})()), \
             patch.object(archive.subprocess, 'run', side_effect=AssertionError('transfer started')):
            with self.assertRaises(OSError) as error:
                archive.get_download(CONFIG, 'large.pdf', ready)
        self.assertEqual(error.exception.errno, errno.ENOSPC)
        self.assertFalse(ready.exists())

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

    def test_untracked_parquet_not_modified(self):
        dataset = self.root / 'dataset'
        dataset.mkdir()
        old = dataset / 'old.parquet'
        old.write_bytes(b'old data')
        with self.assertRaisesRegex(RuntimeError, 'without source.json'):
            self.run_archive()
        self.assertEqual(old.read_bytes(), b'old data')
        self.assertEqual(self.calls, [])

    def test_cli_fake_ssh(self):
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
        for _ in range(2):
            result = subprocess.run(command, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        rows = pq.read_table(output / 'dataset').to_pylist()
        self.assertEqual({r['filename']: r['pdf'] for r in rows}, remote_files)
        self.assertEqual(len(list((output / 'dataset').glob('batch-*.parquet'))), 1)
        self.assertEqual(sum(line.startswith('cat -- ') for line in log.read_text().splitlines()), 2)
        self.assertTrue(all((remote / name).exists() for name in remote_files))

    def test_workspace_env_and_key_path(self):
        (self.root / '.env').write_text('SSH_HOST=from-env\nSSH_USER=reader\nSSH_PORT=2222\n'
                                        'SSH_KEY=/secret/id_ed25519\nSSH_DIR="pdfs with spaces"\n')
        with patch.object(archive, 'ROOT', self.root), patch.dict(os.environ, {'SSH_HOST': 'override'}, clear=True):
            config = archive.load_config()
        self.assertEqual(config['host'], 'override')
        self.assertEqual(config['user'], 'reader')
        self.assertEqual(config['port'], 2222)
        self.assertEqual(config['key'], str(self.root / 'secret/id_ed25519'))
        self.assertEqual(config['directory'], 'pdfs with spaces')

    def test_ctrl_c_then_resume_does_not_repeat_completed_download(self):
        remote, output, bin_dir = self.root / 'remote', self.root / 'archive', self.root / 'bin'
        remote.mkdir(); bin_dir.mkdir()
        (remote / 'a.pdf').write_bytes(b'%PDF first')
        (remote / 'b.pdf').write_bytes(b'%PDF second')
        log, marker = self.root / 'ssh.log', self.root / 'paused'
        fake = bin_dir / 'ssh'
        fake.write_text("#!/bin/sh\nfor arg do command=$arg; done\nprintf '%s\\n' \"$command\" >> \"$SSH_LOG\"\n"
                        "case \"$command\" in *'b.pdf'*) case \"$command\" in cat*) "
                        "if [ ! -e \"$PAUSE_MARKER\" ]; then touch \"$PAUSE_MARKER\"; sleep 2; fi;; esac;; esac\n"
                        "eval \"$command\"\n")
        fake.chmod(0o755)
        env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
                   SSH_HOST='host', SSH_USER='user', SSH_PORT='22', SSH_KEY='',
                   SSH_DIR=str(remote), SSH_LOG=str(log), PAUSE_MARKER=str(marker))
        command = [sys.executable, str(SCRIPT), '--output', str(output)]
        process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 10
            while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(marker.exists(), 'second download did not start')
            process.send_signal(signal.SIGINT)
            _, stderr = process.communicate(timeout=8)
            self.assertEqual(process.returncode, 130, stderr)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = pq.read_table(output / 'dataset').to_pylist()
        self.assertEqual({r['filename']: r['pdf'] for r in rows},
                         {'a.pdf': b'%PDF first', 'b.pdf': b'%PDF second'})
        cats = [line for line in log.read_text().splitlines() if line.startswith('cat -- ')]
        self.assertEqual(sum('a.pdf' in line for line in cats), 1)

    def test_remote_find_rejects_unsafe_paths(self):
        with patch.object(archive, 'ssh', return_value=b'../outside.pdf\0'):
            with self.assertRaises(ValueError):
                archive.discover(CONFIG)


if __name__ == '__main__':
    unittest.main()
