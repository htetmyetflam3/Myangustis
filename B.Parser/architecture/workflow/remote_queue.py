"""Read-only SSH PDF queue with recoverable Parquet and parser text exports."""
from __future__ import annotations
import fcntl
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import sqlite3
import subprocess
import tempfile
import time

from myangustis_parser.resources.paths import RUNTIME_ROOT

DISK_FLOOR = 5 * 1024**3


def shell_path(value):
    if value == '~':
        return '"$HOME"'
    if value.startswith('~/'):
        return '"$HOME"/' + shlex.quote(value[2:])
    return shlex.quote(value)


def remote_config(mode):
    host, user = os.environ.get('SSH_HOST', '').strip(), os.environ.get('SSH_USER', '').strip()
    if not host or not user or host.startswith('-') or not re.fullmatch(r'[A-Za-z0-9_.-]+', user):
        raise ValueError('Set valid SSH_HOST and SSH_USER in .env.')
    port = int(os.environ.get('SSH_PORT') or '22')
    if not 1 <= port <= 65535:
        raise ValueError('SSH_PORT must be between 1 and 65535.')
    folder = (os.environ.get('REMOTE_OCR_DIR' if mode == 'ocr' else 'REMOTE_PRASER_DIR')
              or ('scanned' if mode == 'ocr' else 'convertable')).strip().strip('/')
    if not folder or folder in ('.', '..') or '/' in folder or '\\' in folder or any(ord(c) < 32 for c in folder):
        raise ValueError('Remote queue must be one direct child of SSH_DIR.')
    return {'host': host, 'user': user, 'port': port, 'key': os.environ.get('SSH_KEY', ''),
            'directory': os.environ.get('SSH_DIR') or 'pdfs', 'folder': folder}


def ssh_args(config, command):
    args = ['ssh', '-p', str(config['port']), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
            '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=6']
    if config['key']:
        args += ['-i', os.path.expanduser(config['key']), '-o', 'IdentitiesOnly=yes']
    return args + [config['user'] + '@' + config['host'], command]


def ssh(config, command):
    return subprocess.run(ssh_args(config, command), stdout=subprocess.PIPE, check=True).stdout


def discover(config):
    cmd = ('cd -- ' + shell_path(config['directory']) + ' && find '
           + shlex.quote('./' + config['folder']) + " -type f -iname '*.pdf' -print0")
    result = []
    for name in ssh(config, cmd).split(b'\0'):
        if not name:
            continue
        source = PurePosixPath(os.fsdecode(name))
        if source.is_absolute() or '..' in source.parts or len(source.parts) < 2 or source.parts[0] != config['folder']:
            raise ValueError('Unsafe remote queue path')
        result.append(str(source))
    return sorted(set(result))


def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def download(config, source, target):
    remote = str(PurePosixPath(config['directory']) / source)
    quoted = shell_path(remote)
    before = ssh(config, 'sha256sum -- ' + quoted).decode().split()[0]
    if not re.fullmatch(r'[0-9a-fA-F]{64}', before):
        raise ValueError('Invalid remote checksum')
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name('.' + target.name + '.part')
    with part.open('wb') as output:
        subprocess.run(ssh_args(config, 'cat -- ' + quoted), stdout=output, check=True)
        output.flush()
        os.fsync(output.fileno())
    actual = digest_file(part)
    after = ssh(config, 'sha256sum -- ' + quoted).decode().split()[0]
    if actual != before or actual != after:
        raise RuntimeError('Remote file changed or checksum mismatch; local partial retained.')
    os.replace(part, target)
    return actual


def _open_db(state):
    state.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(state / 'books.sqlite3', timeout=60)
    db.execute('pragma journal_mode=WAL')
    db.execute('pragma synchronous=FULL')
    db.execute('''create table if not exists books (
        source text primary key, book text not null, text text not null,
        segmented text not null, sha256 text not null, mode text not null)''')
    db.execute('create table if not exists export_state (id integer primary key, dirty integer not null)')
    db.execute('insert or ignore into export_state values (1, 1)')
    db.execute('''create table if not exists text_export (
        id integer primary key check(id=1), initialized integer not null,
        bytes integer not null, last_rowid integer not null)''')
    db.execute('insert or ignore into text_export values (1, 0, 0, 0)')
    db.commit()
    return db


def _export(db, output):
    import pyarrow as pa
    import pyarrow.parquet as pq
    output.parent.mkdir(parents=True, exist_ok=True)
    rows = db.execute('select book, text, segmented, sha256 from books order by source').fetchall()
    table = pa.table({'author': [''] * len(rows), 'book': [r[0] for r in rows],
                      'text': [r[1] for r in rows], 'segmented': [r[2] for r in rows],
                      'sha256': [r[3] for r in rows]})
    tmp = output.with_name('.' + output.name + '.tmp')
    pq.write_table(table, tmp, compression='zstd')
    with tmp.open('rb') as f:
        os.fsync(f.fileno())
    os.replace(tmp, output)
    fd = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    db.execute('update export_state set dirty=0 where id=1')
    db.commit()


def _sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _sections(db, last_rowid=0):
    """Stream source sections in insertion order rather than loading the book collection."""
    for rowid, book, text in db.execute(
            'select rowid, book, text from books where rowid > ? order by rowid', (last_rowid,)):
        yield rowid, f'===== {book} =====\n{text}\n\n'.encode('utf-8')


def _sync_text(db, output):
    """Append/recover a single headed TXT from the durable parser ledger.

    The tracked byte position is committed only after fsync. A crash while
    appending is recovered by validating the tail against pending sections,
    truncating that partial tail, and appending it again. A missing or shortened
    tracked file is rebuilt atomically. Untracked existing text is never replaced.
    """
    initialized, expected, last_id = db.execute(
        'select initialized, bytes, last_rowid from text_export where id=1').fetchone()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.is_symlink():
        raise RuntimeError(f'Refusing to modify a symlink as the text collection: {output}')
    if not initialized:
        if output.exists() and output.stat().st_size:
            raise RuntimeError(f'Refusing to overwrite an untracked text collection: {output}')
        db.execute('update text_export set initialized=1 where id=1')
        db.commit()

    if not output.exists() or output.stat().st_size < expected:
        # Rebuild to a separate file, preserving the original until it is complete.
        fd, name = tempfile.mkstemp(prefix='.parsed-books.', suffix='.tmp', dir=output.parent)
        temp = Path(name)
        try:
            total, last = 0, 0
            with os.fdopen(fd, 'wb') as stream:
                for rowid, section in _sections(db):
                    stream.write(section)
                    total += len(section)
                    last = rowid
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, output)
            _sync_dir(output.parent)
            db.execute('update text_export set bytes=?, last_rowid=? where id=1', (total, last))
            db.commit()
        finally:
            temp.unlink(missing_ok=True)
        return

    size = output.stat().st_size
    with output.open('r+b') as stream:
        if size > expected:
            # Only discard a tail which matches the beginning of pending data:
            # unrelated manual additions must not be silently destroyed.
            stream.seek(expected)
            remaining = size - expected
            for _, section in _sections(db, last_id):
                if not remaining:
                    break
                chunk = section[:remaining]
                if stream.read(len(chunk)) != chunk:
                    raise RuntimeError(f'Text collection was modified outside the parser: {output}')
                remaining -= len(chunk)
            if remaining:
                raise RuntimeError(f'Text collection was modified outside the parser: {output}')
            stream.truncate(expected)
        stream.seek(expected)
        total, last = expected, last_id
        for rowid, section in _sections(db, last_id):
            stream.write(section)
            total += len(section)
            last = rowid
        stream.flush()
        os.fsync(stream.fileno())
    if total != expected or last != last_id:
        db.execute('update text_export set bytes=?, last_rowid=? where id=1', (total, last))
        db.commit()


def run_once(mode, convert, config=None, runtime=RUNTIME_ROOT):
    """Scan one remote folder; source files stay untouched; failures are retained."""
    config = config or remote_config(mode)
    if mode not in ('parse', 'ocr'):
        raise ValueError('Unknown queue mode')
    state = runtime / 'state' / 'ssh' / mode
    state.mkdir(parents=True, exist_ok=True)
    output = runtime / 'output' / 'parquet' / ('books.parquet' if mode == 'parse' else 'ocr-books.parquet')
    text_output = runtime / 'output' / 'txt' / 'parsed-books.txt' if mode == 'parse' else None
    with (state / 'queue.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with _open_db(state) as db:
            count = db.execute('select count(*) from books').fetchone()[0]
            if output.exists() and count == 0:
                raise RuntimeError(f'Refusing to overwrite untracked collection: {output}')
            if text_output is not None and count == 0 and text_output.exists() and text_output.stat().st_size:
                raise RuntimeError(f'Refusing to overwrite an untracked text collection: {text_output}')
            if text_output is not None and count:
                _sync_text(db, text_output)  # backfill existing entries and recover interrupted appends
            dirty = db.execute('select dirty from export_state where id=1').fetchone()[0]
            if count and (dirty or not output.exists()):
                _export(db, output)  # recover an interrupted export
            for source in discover(config):
                key = f"{mode}:{config['user']}@{config['host']}:{config['port']}:{config['directory']}:{source}"
                if db.execute('select 1 from books where source=?', (key,)).fetchone():
                    continue
                if shutil.disk_usage(state).free < DISK_FLOOR:
                    raise RuntimeError('Less than 5 GiB free; downloads paused to protect the disk.')
                target = state / 'staging' / hashlib.sha256(key.encode()).hexdigest() / PurePosixPath(source).name
                committed = False
                try:
                    digest = download(config, source, target)
                    with tempfile.TemporaryDirectory(dir=state) as tmp:
                        result = convert(target, Path(tmp) / 'output.txt', mode)
                    text = result.get('text') or ''
                    if not text.strip():
                        raise ValueError('No text extracted')
                    from myangustis_engine.api import segment_text
                    segmented = segment_text(text)
                    if mode == 'parse':
                        from myangustis_parser.workflow import diagnostics
                        if diagnostics.enabled():
                            diagnostics.segmentation_log(PurePosixPath(source).name, text, segmented)
                    base = PurePosixPath(source).stem
                    # Stable source-based suffix prevents same-name collisions.
                    if db.execute('select 1 from books where book=?', (base,)).fetchone():
                        base += '-' + hashlib.sha256(key.encode()).hexdigest()[:8]
                    db.execute('insert into books values (?,?,?,?,?,?)', (key, base, text, segmented, digest, mode))
                    db.execute('update export_state set dirty=1 where id=1')
                    db.commit()
                    committed = True
                    if text_output is not None:
                        _sync_text(db, text_output)
                    _export(db, output)
                    target.unlink()
                    destinations = f'{output} and {text_output}' if text_output is not None else str(output)
                    print(f'[parser-ssh] {source} -> {destinations}', flush=True)
                except Exception as exc:
                    if not committed:
                        db.rollback()
                    print(f'[parser-ssh] failed {source}: {exc}; local input retained', flush=True)
                    # Recover both outputs on the next scan before processing more books.
                    if committed:
                        break
    return output


def run_forever(mode, convert, interval=60):
    while True:
        try:
            run_once(mode, convert)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            print(f'[parser-ssh] {error}; retrying in {interval}s', flush=True)
        time.sleep(interval)
