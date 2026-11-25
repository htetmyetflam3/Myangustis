#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow>=17"]
# ///
"""Copy PDFs under SSH_DIR into a resumable, read-only Parquet dataset.

Run: uv run tools-box/python/pdf_archive.py
The root .env uses the same SSH settings as B.Parser/run/parse.py. The dataset
is Junk/tools-box/pdf-archive/dataset; each row has filename (relative to
SSH_DIR) and pdf (the original bytes). Every PDF is committed separately, so
Ctrl+C and reruns preserve completed work. Remote PDFs are never deleted.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import subprocess
import sys

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
    digest = output.decode('ascii', errors='strict').split()[0].lower()
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


def archive_one(config, source, dataset, staging):
    import pyarrow as pa
    import pyarrow.parquet as pq

    identifier = hashlib.sha256(source.encode('utf-8')).hexdigest()
    dest = dataset / (identifier + '.parquet')
    ready = staging / (identifier + '.pdf')
    temp = staging / (identifier + '.parquet.tmp')
    if dest.exists():
        # Never silently skip a damaged or unrelated file.
        meta = pq.read_metadata(dest)
        if (meta.num_rows != 1 or (meta.metadata or {}).get(b'source') != source.encode('utf-8')
                or meta.schema.to_arrow_schema().names != ['filename', 'pdf']):
            raise RuntimeError(f'Invalid existing archive shard: {dest}')
        ready.unlink(missing_ok=True)
        temp.unlink(missing_ok=True)
        return False

    digest = get_download(config, source, ready)
    # A whole PDF is a single binary value. Only one PDF is loaded at a time.
    contents = ready.read_bytes()
    if hashlib.sha256(contents).hexdigest() != digest:
        raise RuntimeError('Local download changed before writing Parquet')
    schema = pa.schema([('filename', pa.string()), ('pdf', pa.binary())],
                       metadata={b'source': source.encode('utf-8'), b'sha256': digest.encode('ascii')})
    table = pa.Table.from_arrays([pa.array([source], type=pa.string()),
                                  pa.array([contents], type=pa.binary())], schema=schema)
    pq.write_table(table, temp, compression='zstd')
    with temp.open('rb') as stream:
        os.fsync(stream.fileno())
    os.replace(temp, dest)
    sync_dir(dataset)
    ready.unlink(missing_ok=True)
    return True


def run(config, root=DEFAULT_ARCHIVE):
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
        sources = discover(config)
        print(f'Found {len(sources)} PDFs under {config["directory"]}.', flush=True)
        failures = 0
        for source in sources:
            try:
                written = archive_one(config, source, dataset, staging)
                print(f'{"Saved" if written else "Skipped"}: {source}', flush=True)
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
                failures += 1
                print(f'Failed: {source}: {exc}', file=sys.stderr, flush=True)
        print(f'Dataset: {dataset}; failed: {failures}', flush=True)
        return 1 if failures else 0


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
        # remote_config also checks the parser queue folder, although this tool
        # scans SSH_DIR itself and does not depend on either queue setting.
        config = ssh_queue.remote_config('parse')
        return run(config, args.output)
    except KeyboardInterrupt:
        print('\nInterrupted. Run the script again to resume.', file=sys.stderr)
        return 130
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f'Archive failed: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
