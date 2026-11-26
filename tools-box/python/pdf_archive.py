#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow>=17", "fastparquet>=2024.5", "python-dotenv>=1"]
# ///
"""Copy PDFs under SSH_DIR into a resumable, read-only Parquet dataset.

Run: uv run tools-box/python/pdf_archive.py
Uses SSH_HOST, SSH_USER, SSH_PORT, SSH_KEY and SSH_DIR from the root .env.
Each row contains the relative filename and the original PDF bytes. Parquet
files are at most 25 GB each. Ctrl+C and rerun to resume. Remote files stay
untouched; this script does not upload or process older archives.
"""
from __future__ import annotations

import argparse
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import signal
import shutil
import sqlite3
import struct
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ARCHIVE = ROOT / 'Junk' / 'tools-box' / 'pdf-archive-fresh'

def load_config():
    """Read the workspace SSH settings, keeping process environment first."""
    from dotenv import dotenv_values

    for path in (ROOT / '.env', ROOT / 'A.Engine/architecture/myangustis_engine/.data/.env'):
        if path.is_file():
            for name, value in dotenv_values(path, interpolate=False).items():
                if value is not None and not os.environ.get(name):
                    os.environ[name] = value
    host = os.environ.get('SSH_HOST', '').strip()
    user = os.environ.get('SSH_USER', '').strip()
    if not host or not user or host.startswith('-') or not re.fullmatch(r'[A-Za-z0-9_.-]+', user):
        raise ValueError('Set valid SSH_HOST and SSH_USER in the root .env.')
    port = int(os.environ.get('SSH_PORT') or '22')
    if not 1 <= port <= 65535:
        raise ValueError('SSH_PORT must be between 1 and 65535.')
    key = os.environ.get('SSH_KEY', '').strip()
    if key:
        key = str(local_path(key))
    return {'host': host, 'user': user, 'port': port, 'key': key,
            'directory': os.environ.get('SSH_DIR') or 'pdfs'}


def local_path(value):
    """Resolve SSH_KEY with the workspace's local .env path conventions."""
    def anchor(text, base):
        for prefix in ('abs:', 'file:', 'path:'):
            if text.lower().startswith(prefix):
                return Path(text[len(prefix):].strip()).expanduser()
        if text.startswith('~'):
            return Path(text).expanduser()
        candidate = Path(text)
        if candidate.is_absolute():
            current = candidate
            while not current.exists() and current != current.parent:
                current = current.parent
            if current != Path(current.anchor) or candidate.is_relative_to(base):
                return candidate
            return base / text.lstrip('/')
        return base / candidate

    override = (os.environ.get('PRASER_PATH_ROOT') or os.environ.get('MYANGUSTIS_PATH_ROOT') or '').strip()
    base = anchor(override, ROOT) if override else ROOT
    return anchor(value, base)


def shell_path(value):
    if value == '~':
        return '"$HOME"'
    if value.startswith('~/'):
        return '"$HOME"/' + shlex.quote(value[2:])
    return shlex.quote(value)


def ssh_args(config, command):
    args = ['ssh', '-p', str(config['port']), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
            '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=6']
    if config['key']:
        args += ['-i', config['key'], '-o', 'IdentitiesOnly=yes']
    return args + [config['user'] + '@' + config['host'], command]


def ssh(config, command):
    return subprocess.run(ssh_args(config, command), stdout=subprocess.PIPE, check=True).stdout


def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def discover(config):
    command = ('cd -- ' + shell_path(config['directory']) +
               " && find . -type f -iname '*.pdf' -print0")
    sources = []
    for raw in ssh(config, command).split(b'\0'):
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
    output = ssh(config, 'sha256sum < ' + shell_path(path))
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
            actual = digest_file(candidate)
            after = remote_digest(config, source)
            if actual == before == after:
                if candidate == part:
                    os.replace(part, ready)
                    sync_dir(ready.parent)
                return actual
    before = remote_digest(config, source)
    path = str(PurePosixPath(config['directory']) / source)
    size_text = ssh(config, 'wc -c < ' + shell_path(path)).decode('ascii').strip()
    if not size_text.isdigit():
        raise ValueError('Invalid remote PDF size')
    size = int(size_text)
    # Allow room for one temporary download and its Parquet row at the same
    # time. Refuse before starting rather than filling the disk mid-transfer.
    if shutil.disk_usage(ready.parent).free < 2 * size + 1024 * 1024:
        raise OSError(errno.ENOSPC, 'Not enough free disk space for the next PDF')
    with part.open('wb') as stream:
        subprocess.run(ssh_args(config, 'cat -- ' + shell_path(path)),
                       stdout=stream, check=True)
        stream.flush()
        os.fsync(stream.fileno())
    actual = digest_file(part)
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


def open_ledger(root, dataset):
    ledger = root / 'state' / 'archive-v2.sqlite3'
    if not ledger.exists() and any(dataset.glob('*.parquet')):
        raise RuntimeError('This directory contains an untracked archive; choose a new --output directory.')
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
        if path.name not in expected:
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
    args = parser.parse_args(argv)
    if not args.output.is_absolute():
        parser.error('--output must be an absolute path')

    def interrupt(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    try:
        return run(load_config(), args.output)
    except KeyboardInterrupt:
        print('\nInterrupted. Run the script again to resume.', file=sys.stderr)
        return 130
    except (OSError, ValueError, RuntimeError, sqlite3.Error, subprocess.SubprocessError) as exc:
        print(f'Archive failed: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
