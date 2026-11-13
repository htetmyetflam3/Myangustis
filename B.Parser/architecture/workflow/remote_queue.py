"""Standalone, read-only SSH PDF queue and crash-recoverable Parquet export."""
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


def run_once(mode, convert, config=None, runtime=RUNTIME_ROOT):
    """Scan one remote folder; source files stay untouched; failures are retained."""
    config = config or remote_config(mode)
    if mode not in ('parse', 'ocr'):
        raise ValueError('Unknown queue mode')
    state = runtime / 'state' / 'ssh' / mode
    state.mkdir(parents=True, exist_ok=True)
    output = runtime / 'output' / 'parquet' / ('books.parquet' if mode == 'parse' else 'ocr-books.parquet')
    with (state / 'queue.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with _open_db(state) as db:
            count = db.execute('select count(*) from books').fetchone()[0]
            if output.exists() and count == 0:
                raise RuntimeError(f'Refusing to overwrite untracked collection: {output}')
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
                try:
                    digest = download(config, source, target)
                    with tempfile.TemporaryDirectory(dir=state) as tmp:
                        result = convert(target, Path(tmp) / 'output.txt', mode)
                    text = result.get('text') or ''
                    if not text.strip():
                        raise ValueError('No text extracted')
                    from myangustis_engine.api import segment_text
                    segmented = segment_text(text)
                    base = PurePosixPath(source).stem
                    # Stable source-based suffix prevents same-name collisions.
                    if db.execute('select 1 from books where book=?', (base,)).fetchone():
                        base += '-' + hashlib.sha256(key.encode()).hexdigest()[:8]
                    db.execute('insert into books values (?,?,?,?,?,?)', (key, base, text, segmented, digest, mode))
                    db.execute('update export_state set dirty=1 where id=1')
                    db.commit()
                    _export(db, output)
                    target.unlink()
                    print(f'[parser-ssh] {source} -> {output}', flush=True)
                except Exception as exc:
                    print(f'[parser-ssh] failed {source}: {exc}; local input retained', flush=True)
                    # A committed DB row is exported at the start of the next scan.
    return output


def run_forever(mode, convert, interval=60):
    while True:
        try:
            run_once(mode, convert)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            print(f'[parser-ssh] {error}; retrying in {interval}s', flush=True)
        time.sleep(interval)
