#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow>=17", "fastparquet>=2024.5"]
# ///
"""Copy PDFs under SSH_DIR into a resumable, read-only Parquet dataset.

Run: uv run tools-box/python/pdf_archive.py
The root .env uses the same SSH settings as B.Parser/run/parse.py. The dataset
is Junk/tools-box/pdf-archive/dataset; each row has filename (relative to
SSH_DIR) and pdf (the original bytes). Multiple PDFs are written into each
Parquet shard of at most 25 GB. Ctrl+C preserves progress; rerun to resume.
The first version's single-PDF Parquet files are verified and consolidated
without downloading those PDFs again. Remote files stay untouched.
"""
from __future__ import annotations

import argparse
import errno
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import shutil
import sqlite3
import struct
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ARCHIVE = ROOT / 'Junk' / 'tools-box' / 'pdf-archive'

# Load the same path and SSH helpers as the parser without requiring it to be
# installed as a package. Its paths module also loads the workspace .env.
if 'myangustis_parser' not in sys.modules:
    init = ROOT / 'B.Parser' / 'architecture' / '__init__.py'
    spec = importlib.util.spec_from_file_location(
        'myangustis_parser', init, submodule_search_locations=[str(init.parent)])
    package = importlib.util.module_from_spec(spec)
    sys.modules['myangustis_parser'] = package
    spec.loader.exec_module(package)
from myangustis_parser.workflow import remote_queue as ssh_queue


def discover(config):
    command = ('cd -- ' + ssh_queue.shell_path(config['directory']) +
               " && find . -type f -iname '*.pdf' -print0")
    sources = []
    for raw in ssh_queue.ssh(config, command).split(b'\0'):
        if not raw:
            continue
        source = PurePosixPath(os.fsdecode(raw))
        if source.is_absolute() or '..' in source.parts or not source.parts:
            raise ValueError('Unsafe remote path')
        # Parquet strings must be valid UTF-8, rather than silently mangled.
        name = str(source)
        name.encode('utf-8')
        sources.append(name)
    return sorted(set(sources))


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def configure_archive(root, config):
    """Bind progress to a remote location so a changed host cannot be skipped."""
    identity = {key: config[key] for key in ('host', 'user', 'port', 'directory')}
    manifest = root / 'source.json'
    if manifest.exists():
        if json.loads(manifest.read_text(encoding='utf-8')) != identity:
            raise RuntimeError('SSH source changed; use a separate archive directory.')
    else:
        if (root / 'dataset').exists() and any((root / 'dataset').iterdir()):
            raise RuntimeError('Dataset exists without source.json; refusing to reuse it.')
        temporary = root / '.source.json.tmp'
        with temporary.open('w', encoding='utf-8') as stream:
            json.dump(identity, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, manifest)
        sync_dir(root)


def remote_digest(config, source):
    path = str(PurePosixPath(config['directory']) / source)
    output = ssh_queue.ssh(config, 'sha256sum < ' + ssh_queue.shell_path(path))
    fields = output.decode('ascii', errors='strict').split()
    digest = fields[0].lower() if fields else ''
    if not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise ValueError('Invalid remote checksum')
    return digest


def get_download(config, source, ready):
    """Recover a completed transfer, including one interrupted before rename."""
    part = ready.with_name('.' + ready.name + '.part')
    for candidate in (ready, part):
        if candidate.is_file():
            before = remote_digest(config, source)
            actual = ssh_queue.digest_file(candidate)
            after = remote_digest(config, source)
            if actual == before == after:
                if candidate == part:
                    os.replace(part, ready)
                    sync_dir(ready.parent)
                return actual
    before = remote_digest(config, source)
    path = str(PurePosixPath(config['directory']) / source)
    with part.open('wb') as stream:
        subprocess.run(ssh_queue.ssh_args(config, 'cat -- ' + ssh_queue.shell_path(path)),
                       stdout=stream, check=True)
        stream.flush()
        os.fsync(stream.fileno())
    actual = ssh_queue.digest_file(part)
    after = remote_digest(config, source)
    if actual != before or actual != after:
        raise RuntimeError('Remote file changed or checksum mismatch; retry the run')
    os.replace(part, ready)
    sync_dir(ready.parent)
    return actual


def file_id(source):
    return hashlib.sha256(source.encode('utf-8')).hexdigest()


# 25 GB in decimal bytes. The limit is for the finished Parquet file, not
# the number of PDFs or the total size of the dataset.
MAX_SHARD_BYTES = 25_000_000_000
LEGACY_NAME = re.compile(r'^[0-9a-f]{64}\.parquet$')


def open_ledger(root, dataset):
    ledger = root / 'state' / 'archive-v2.sqlite3'
    if (root / 'state' / 'archive.sqlite3').exists():
        raise RuntimeError('A different archive ledger is present; no files were modified. '
                           'Use the version that created it.')
    if not ledger.exists():
        unknown = [p.name for p in dataset.glob('*.parquet') if not LEGACY_NAME.fullmatch(p.name)]
        if unknown:
            raise RuntimeError(f'Untracked Parquet files: {unknown}; no files were modified')
    db = sqlite3.connect(ledger)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=FULL')
    db.executescript("""
        CREATE TABLE IF NOT EXISTS shards (
            id TEXT PRIMARY KEY, size INTEGER NOT NULL, rows INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS files (
            source TEXT PRIMARY KEY, digest TEXT NOT NULL, size INTEGER NOT NULL,
            shard TEXT NOT NULL, row_number INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS journal (
            id INTEGER PRIMARY KEY CHECK(id=1), shard TEXT NOT NULL,
            original_size INTEGER NOT NULL, footer BLOB NOT NULL);
    """)
    db.commit()
    sync_dir(ledger.parent)
    return db


def shard_path(dataset, shard):
    if not re.fullmatch(r'[0-9a-f]{32}', shard):
        raise RuntimeError('Invalid shard identifier in ledger')
    return dataset / ('batch-' + shard + '.parquet')


def read_footer(path):
    """Capture the Parquet footer which append will overwrite."""
    with path.open('rb') as stream:
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
        if size < 12:
            raise RuntimeError(f'Invalid Parquet file: {path}')
        stream.seek(-8, os.SEEK_END)
        trailer = stream.read(8)
        length = struct.unpack('<I', trailer[:4])[0]
        if trailer[4:] != b'PAR1' or length + 8 > size - 4:
            raise RuntimeError(f'Invalid Parquet footer: {path}')
        stream.seek(-(length + 8), os.SEEK_END)
        return size, stream.read(length + 8)


def rollback(db, dataset):
    """Restore the old footer if interrupted while appending a row group."""
    pending = db.execute('SELECT shard, original_size, footer FROM journal WHERE id=1').fetchone()
    if pending is None:
        return
    shard, size, footer = pending
    path = shard_path(dataset, shard)
    if size == 0:
        path.unlink(missing_ok=True)
    else:
        if not path.is_file() or len(footer) > size:
            raise RuntimeError(f'Cannot recover interrupted append: {path}')
        with path.open('r+b') as stream:
            stream.seek(size - len(footer))
            stream.write(footer)
            stream.truncate(size)
            stream.flush()
            os.fsync(stream.fileno())
    sync_dir(dataset)
    with db:
        db.execute('DELETE FROM journal WHERE id=1')


def verify_record(db, dataset, source):
    import pyarrow.parquet as pq
    row = db.execute('SELECT digest, size, shard, row_number FROM files WHERE source=?', (source,)).fetchone()
    if not row:
        raise RuntimeError(f'PDF missing from ledger: {source}')
    digest, size, shard, number = row
    parquet = pq.ParquetFile(shard_path(dataset, shard))
    record = parquet.read_row_group(number).to_pylist()[0]
    if (record['filename'] != source or len(record['pdf']) != size or
            hashlib.sha256(record['pdf']).hexdigest() != digest):
        raise RuntimeError(f'Parquet verification failed for {source}')


def validate_shards(db, dataset):
    import pyarrow.parquet as pq
    shards = db.execute('SELECT id, size, rows FROM shards').fetchall()
    expected = {shard_path(dataset, shard).name for shard, _, _ in shards}
    for path in dataset.glob('*.parquet'):
        if path.name not in expected and not LEGACY_NAME.fullmatch(path.name):
            raise RuntimeError(f'Untracked Parquet file: {path}')
    for shard, size, rows in shards:
        path = shard_path(dataset, shard)
        if rows == 0 and size == 0 and not path.exists():
            continue
        if not path.is_file() or path.is_symlink() or path.stat().st_size != size:
            raise RuntimeError(f'Committed Parquet file missing or changed: {path}')
        parquet = pq.ParquetFile(path)
        if (parquet.metadata.num_rows != rows or parquet.num_row_groups != rows or
                parquet.schema_arrow.names != ['filename', 'pdf']):
            raise RuntimeError(f'Invalid Parquet file: {path}')


def append_record(db, dataset, source, contents, digest, max_bytes):
    """Append and verify one row; a durable footer journal makes it recoverable."""
    import fastparquet
    import pandas as pd

    if hashlib.sha256(contents).hexdigest() != digest:
        raise RuntimeError(f'Local PDF checksum mismatch: {source}')
    if len(contents) >= max_bytes:
        raise RuntimeError(f'{source} cannot fit in a {max_bytes}-byte Parquet file')
    if shutil.disk_usage(dataset).free < len(contents) + 1024 * 1024:
        raise OSError(errno.ENOSPC, 'Not enough free disk space to safely save the next PDF')
    frame = pd.DataFrame({'filename': pd.Series([source], dtype='object'),
                          'pdf': pd.Series([contents], dtype='object')})
    while True:
        current = db.execute('SELECT id, size, rows FROM shards ORDER BY rowid DESC LIMIT 1').fetchone()
        if current is None:
            shard, size, count = uuid.uuid4().hex, 0, 0
            with db:
                db.execute('INSERT INTO shards VALUES (?, 0, 0)', (shard,))
        else:
            shard, size, count = current
        path = shard_path(dataset, shard)
        if size:
            actual_size, footer = read_footer(path)
            if actual_size != size:
                raise RuntimeError(f'Parquet file changed: {path}')
        else:
            if path.exists():
                raise RuntimeError(f'Unexpected Parquet file: {path}')
            footer = b''
        with db:
            db.execute('INSERT INTO journal VALUES (1, ?, ?, ?)', (shard, size, footer))
        try:
            fastparquet.write(str(path), frame, append=bool(size), write_index=False,
                              object_encoding={'filename': 'utf8', 'pdf': 'bytes'},
                              compression='UNCOMPRESSED')
            with path.open('rb') as stream:
                os.fsync(stream.fileno())
            sync_dir(dataset)
            new_size = path.stat().st_size
            if new_size > max_bytes:
                rollback(db, dataset)
                if not count:
                    raise RuntimeError(f'{source} cannot fit in a {max_bytes}-byte Parquet file')
                with db:
                    db.execute('INSERT INTO shards VALUES (?, 0, 0)', (uuid.uuid4().hex,))
                continue
            # Read back the new row before recording progress or removing input.
            import pyarrow.parquet as pq
            record = pq.ParquetFile(path).read_row_group(count).to_pylist()[0]
            if (record['filename'] != source or len(record['pdf']) != len(contents) or
                    hashlib.sha256(record['pdf']).hexdigest() != digest):
                raise RuntimeError(f'Parquet verification failed for {source}')
            with db:
                db.execute('INSERT INTO files VALUES (?, ?, ?, ?, ?)',
                           (source, digest, len(contents), shard, count))
                db.execute('UPDATE shards SET size=?, rows=? WHERE id=?', (new_size, count + 1, shard))
                db.execute('DELETE FROM journal WHERE id=1')
            return
        except BaseException:
            rollback(db, dataset)
            raise


def legacy_record(path):
    import pyarrow.parquet as pq
    if path.is_symlink():
        raise RuntimeError(f'Refusing a symlink in the archive: {path}')
    parquet = pq.ParquetFile(path)
    metadata = parquet.metadata.metadata or {}
    if parquet.metadata.num_rows != 1 or parquet.schema_arrow.names != ['filename', 'pdf']:
        raise RuntimeError(f'Invalid original Parquet file: {path}')
    record = parquet.read().to_pylist()[0]
    source, pdf = record['filename'], record['pdf']
    if not isinstance(source, str) or not isinstance(pdf, bytes):
        raise RuntimeError(f'Invalid original Parquet row: {path}')
    if (path.name != file_id(source) + '.parquet' or
            metadata.get(b'source') != source.encode('utf-8')):
        raise RuntimeError(f'Original Parquet filename or source mismatch: {path}')
    digest = hashlib.sha256(pdf).hexdigest()
    if metadata.get(b'sha256') != digest.encode('ascii'):
        raise RuntimeError(f'Original Parquet checksum mismatch: {path}')
    return source, pdf, digest


def migrate_legacy(db, dataset, max_bytes):
    """Move old one-row shards one by one, deleting only verified originals."""
    originals = sorted(path for path in dataset.glob('*.parquet') if LEGACY_NAME.fullmatch(path.name))
    if originals:
        print(f'Consolidating {len(originals)} existing single-PDF Parquet files.', flush=True)
    for path in originals:
        source, pdf, digest = legacy_record(path)
        row = db.execute('SELECT digest FROM files WHERE source=?', (source,)).fetchone()
        if row is None:
            append_record(db, dataset, source, pdf, digest, max_bytes)
        elif row[0] != digest:
            raise RuntimeError(f'Existing archive conflicts with original: {path}')
        verify_record(db, dataset, source)
        path.unlink()
        sync_dir(dataset)
        print(f'Consolidated: {source}', flush=True)


def run(config, root=DEFAULT_ARCHIVE, max_bytes=MAX_SHARD_BYTES):
    if max_bytes <= 0:
        raise ValueError('Maximum Parquet size must be positive')
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    with (root / '.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another archive run is already using this directory.') from None
        configure_archive(root, config)
        dataset, staging = root / 'dataset', root / 'state'
        dataset.mkdir(exist_ok=True)
        staging.mkdir(exist_ok=True)
        sync_dir(root)
        db = open_ledger(root, dataset)
        try:
            rollback(db, dataset)
            validate_shards(db, dataset)
            migrate_legacy(db, dataset, max_bytes)
            sources = discover(config)
            print(f'Found {len(sources)} PDFs under {config["directory"]}.', flush=True)
            failures = 0
            for source in sources:
                ready = staging / (file_id(source) + '.pdf')
                existing = db.execute('SELECT 1 FROM files WHERE source=?', (source,)).fetchone()
                if existing:
                    if ready.exists() or ready.with_name('.' + ready.name + '.part').exists():
                        verify_record(db, dataset, source)
                        ready.unlink(missing_ok=True)
                        ready.with_name('.' + ready.name + '.part').unlink(missing_ok=True)
                        sync_dir(staging)
                    print(f'Skipped: {source}', flush=True)
                    continue
                try:
                    digest = get_download(config, source, ready)
                    contents = ready.read_bytes()
                    append_record(db, dataset, source, contents, digest, max_bytes)
                    ready.unlink(missing_ok=True)
                    ready.with_name('.' + ready.name + '.part').unlink(missing_ok=True)
                    sync_dir(staging)
                    print(f'Saved: {source}', flush=True)
                except OSError as exc:
                    if exc.errno in (errno.ENOSPC, errno.EDQUOT):
                        raise
                    failures += 1
                    print(f'Failed: {source}: {exc}', file=sys.stderr, flush=True)
                except (ValueError, RuntimeError, subprocess.SubprocessError) as exc:
                    failures += 1
                    print(f'Failed: {source}: {exc}', file=sys.stderr, flush=True)
            print(f'Dataset: {dataset}; failed: {failures}', flush=True)
            return 1 if failures else 0
        finally:
            db.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, default=DEFAULT_ARCHIVE,
                        help='absolute archive directory (default: %(default)s)')
    parser.add_argument('--count', action='store_true', help='only count PDFs on the SSH host; do not modify the archive')
    args = parser.parse_args(argv)
    if not args.output.is_absolute():
        parser.error('--output must be an absolute path')

    def interrupt(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    try:
        config = ssh_queue.remote_config('parse')
        if args.count:
            print(f'PDFs under {config["directory"]}: {len(discover(config))}')
            return 0
        return run(config, args.output)
    except KeyboardInterrupt:
        print('\nInterrupted. Run the script again to resume.', file=sys.stderr)
        return 130
    except (OSError, ValueError, RuntimeError, sqlite3.Error, subprocess.SubprocessError) as exc:
        print(f'Archive failed: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
