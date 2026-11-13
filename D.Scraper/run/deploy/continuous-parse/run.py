#!/usr/bin/env python3
"""Continuous parse: read-only SSH pull -> PDF text parser -> Parquet and TXT.

A duplicate of deploy/continuous-ocr/run.py with the same flow and the same logic -
the same ledger, the same statuses, the same book_key, the same commit into the ONE
cumulative Parquet, the same restart reconciliation, the same 5 GB disk floor, the
same retained-failure reminder and the same emails. Two things differ, both of them
the point:

  * the queue is one direct child of SSH_DIR on the shared host, configured by
    REMOTE_PRASER_DIR (default: convertable); and
  * each book is routed as image-only or text and text is sent to the Python
    Parser's convert API, followed by the native Python Engine. No old-font or
    text-quality rejection gate is applied by the Scraper.

Hosting originals are read-only: a book is downloaded, parsed, written as one row,
and the LOCAL download is deleted on success. Nothing on the host is ever touched.
A failure keeps its local PDF, is recorded with the reason, and the run carries on.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import os
from pathlib import Path, PurePosixPath
import shlex
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import bootstrap  # noqa: E402,F401
from save_remote import load_config, _ssh_argv, sha256_file
from parse_queue import remote_parser_dir, load_workspace_env
from mailer import RunMail
import text_collect
from disk_floor import DISK_FLOOR

STATE = ROOT / 'scan' / 'parse'
DB = STATE / 'state.sqlite3'
TEXT_FILE = ROOT / 'pdfs' / 'parquet' / 'parsed-books.txt'
LOCAL_STAGING = '.parse'          # downloaded PDFs, deleted on success


class Stopped(BaseException):
    pass


class BookError(Exception):
    pass


def stopped(signum, frame):
    raise Stopped(f'terminated by signal {signum}')


def database():
    STATE.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=60)
    db.row_factory = sqlite3.Row
    db.execute('pragma journal_mode=WAL')
    db.execute('pragma synchronous=FULL')
    db.executescript('''
    create table if not exists books (
      source text primary key, local text not null, status text not null,
      digest text, error text, parquet text, updated real not null, book_key text);
    create table if not exists meta (key text primary key, value text not null);
    create table if not exists text_sections (
      id integer primary key autoincrement, source text unique not null,
      title text not null, text text not null);
    create table if not exists text_export (
      id integer primary key check (id=1), bytes integer not null,
      last_id integer not null, dirty integer not null);
    insert or ignore into text_export values (1, 0, 0, 0);
    ''')
    if not any(c[1] == 'book_key' for c in db.execute('pragma table_info(books)')):
        db.execute('alter table books add column book_key text')
    db.commit()
    return db


def book_key(db, source):
    """This book's row identity in the ONE cumulative Parquet.

    Identical to the OCR service's, and it has to be: both services write the same
    file, so the same PDF must resolve to the same key whichever service parsed it,
    or the writer's duplicate guard would see two different books. The key is the
    filename minus .pdf, persisted so a retry replaces its own row; a basename
    already taken by another source is keyed <name>-<first 8 hex of the source>
    instead. Nested remote folders can contain books with the same basename,
    so the suffix keeps those sources distinct in this service's ledger.
    """
    row = db.execute('select book_key from books where source=?', (source,)).fetchone()
    if row and row['book_key']:
        return row['book_key']
    name = PurePosixPath(source).name
    base = name[:-4] if name.lower().endswith('.pdf') else name
    clash = db.execute('select 1 from books where book_key=? and source!=?',
                       (base, source)).fetchone()
    key = base if not clash else base + '-' + hashlib.sha256(source.encode()).hexdigest()[:8]
    db.execute('update books set book_key=? where source=?', (key, source))
    db.commit()
    return key


def update(db, source, status, **values):
    values.update(status=status, updated=time.time())
    db.execute('update books set ' + ','.join(k + '=?' for k in values) + ' where source=?',
               [*values.values(), source])
    db.commit()


def syncfile(path):
    with Path(path).open('rb') as handle:
        os.fsync(handle.fileno())
    fd = os.open(str(Path(path).parent), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def mail_notice(kind, details):
    mail = RunMail('continuous parse')
    if kind == 'failed':
        mail.send_failed('Parse service', '\n'.join(details))
    elif kind == 'started':
        mail.send_started(details)
    else:
        mail.send_finished(details)


def reminders(db):
    """Retained failures, one email an hour, from the 20th book onwards.

    The same rule and the same latch as the OCR service, on its own meta keys in its
    own state.sqlite3 - the two services count their own retained failures, because
    a book that failed OCR and a book that failed parsing are different problems even
    when they are the same file.
    """
    # The timer may run even after the parse loop exits. It never changes source files.
    with (STATE / 'reminder.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        rows = db.execute("select * from books where status='failed'").fetchall()
        active = []
        for row in rows:
            if Path(row['local']).exists():
                active.append(row)
            else:
                update(db, row['source'], 'removed')
        latched = db.execute("select value from meta where key='reminder_latched'").fetchone()
        if not active:
            db.execute("delete from meta where key in ('reminder_latched','last_reminder')")
            db.commit()
            return
        if len(active) < 20 and not latched:
            return
        db.execute("insert or replace into meta values ('reminder_latched','1')")
        last = db.execute("select value from meta where key='last_reminder'").fetchone()
        if not last or time.time() - float(last[0]) >= 3600:
            # Reserve the hour before delivery to prevent duplicate timer/main sends.
            db.execute("insert or replace into meta values ('last_reminder',?)", (str(time.time()),))
            db.commit()
            mail_notice('failed', [
                f'{len(active)} failed PDFs remain on the VPS; no automatic retry.',
                'They are kept, not deleted. Delete them yourself and they drop out of '
                'this count as "removed"; the service keeps running either way.',
            ])


def ssh(config, command):
    return subprocess.run(_ssh_argv(config, command), capture_output=True, check=True).stdout


def remote_shell_path(path):
    """Safely expand ~/ on the remote host, without expanding other input."""
    path = str(path)
    if path == '~':
        return '"$HOME"'
    if path.startswith('~/'):
        return '"$HOME"/' + shlex.quote(path[2:])
    return shlex.quote(path)


def discover(config, folder=None):
    """Discover PDFs below the configured child only, without following symlinks."""
    folder = folder if folder is not None else remote_parser_dir()
    script = ('cd -- ' + remote_shell_path(config.directory)
              + ' && find ' + shlex.quote('./' + folder) + " -type f -iname '*.pdf' -print0")
    raw = ssh(config, script)
    sources = []
    for name in raw.split(b'\0'):
        if not name:
            continue
        rel = PurePosixPath(os.fsdecode(name))
        if rel.is_absolute() or '..' in rel.parts:
            raise RuntimeError('Unsafe hosting-relative path')
        if len(rel.parts) < 2 or rel.parts[0] != folder:
            continue
        if rel.name.lower().endswith('.pdf'):
            sources.append(str(rel))
    return sorted(set(sources))


def download(config, source, target):
    """Byte-exact pull, verified against the host's own sha256 before and after."""
    remote = str(PurePosixPath(config.directory) / source)
    quoted = remote_shell_path(remote)
    expected = ssh(config, 'sha256sum -- ' + quoted).decode().split()[0]
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name('.' + target.name + '.part')
    with part.open('wb') as handle:
        subprocess.run(_ssh_argv(config, 'cat -- ' + quoted), stdout=handle, check=True)
        handle.flush()
        os.fsync(handle.fileno())
    digest = sha256_file(part)
    after = ssh(config, 'sha256sum -- ' + quoted).decode().split()[0]
    if digest != expected or digest != after:
        raise RuntimeError(f'Download checksum mismatch: {source}; partial retained at {part}')
    os.replace(part, target)
    syncfile(target)
    # Each SSH subprocess has exited before returning to the caller.
    return digest


def save_text_section(db, source, title, text):
    """Save one source's extracted text durably for idempotent TXT export."""
    old = db.execute('select title, text from text_sections where source=?', (source,)).fetchone()
    if old is None:
        db.execute('insert into text_sections(source,title,text) values (?,?,?)', (source, title, text))
    elif old['title'] != title or old['text'] != text:
        db.execute('update text_sections set title=?, text=? where source=?', (title, text, source))
        db.execute('update text_export set dirty=1 where id=1')
    db.commit()


def sync_text_collection(db):
    """Publish UTF-8 sections; recover partial appends/restarts without duplicates."""
    state = db.execute('select bytes,last_id,dirty from text_export where id=1').fetchone()
    count = db.execute('select count(*) from text_sections').fetchone()[0]
    if not count and not TEXT_FILE.exists():
        return
    if not count and state['bytes'] == 0 and TEXT_FILE.exists() and TEXT_FILE.stat().st_size:
        raise RuntimeError(f'Refusing to overwrite an untracked text collection: {TEXT_FILE}')
    TEXT_FILE.parent.mkdir(parents=True, exist_ok=True)
    actual = TEXT_FILE.stat().st_size if TEXT_FILE.exists() else 0
    rebuild = bool(state['dirty']) or actual != state['bytes']
    last_id = 0 if rebuild else state['last_id']
    rows = db.execute('select id,title,text from text_sections where id>? order by id', (last_id,))
    temp_name = None
    try:
        if rebuild:
            handle = tempfile.NamedTemporaryFile(mode='wb', dir=TEXT_FILE.parent,
                                                  prefix='.parsed-books-', delete=False)
            temp_name = handle.name
        else:
            handle = TEXT_FILE.open('ab')
        with handle:
            for row in rows:
                title = row['title'].replace('\r', ' ').replace('\n', ' ')
                handle.write(('===== ' + title + ' =====\n').encode('utf-8'))
                handle.write(row['text'].encode('utf-8'))
                handle.write(b'\n\n')
                last_id = row['id']
            handle.flush()
            os.fsync(handle.fileno())
        if rebuild:
            os.replace(temp_name, TEXT_FILE)
            temp_name = None
        syncfile(TEXT_FILE)
        db.execute('update text_export set bytes=?,last_id=?,dirty=0 where id=1',
                   (TEXT_FILE.stat().st_size, last_id))
        db.commit()
    finally:
        if temp_name is not None:
            Path(temp_name).unlink(missing_ok=True)


def commit_dataset(db, row, parsed):
    """One row in the ONE cumulative Parquet, then the local download is released.

    The same commit as the OCR service and the same writer, so the duplicate guard,
    the cross-process lock and the five-column schema all behave identically - a book
    the OCR already recorded is denied here rather than written twice, and a book
    whose text this parser reads better updates the row that already holds that PDF.

    There is no journal, no pages file and no segmented temp to clean up: the OCR
    keeps those because tesseract is slow enough that losing the result hurts, while
    a parse is cheap and deterministic, so a crash before 'success' simply re-parses
    on restart. The digest goes in as the row's sha256, straight from the verified
    download.
    """
    source = row['source']
    book, text, segmented = parsed
    final = text_collect.write_parquet_row(
        ROOT / 'pdfs', book_key(db, source), text, segmented,
        author='', sha256=row['digest'] or '', log=print)
    if final is None:
        raise RuntimeError('Existing scraper Parquet writer failed')
    syncfile(final)
    save_text_section(db, source, book, text)
    sync_text_collection(db)
    # Deterministic row key + durable ledger make restart reconcile crash windows.
    update(db, source, 'success', parquet=str(final), error='')
    Path(row['local']).unlink(missing_ok=True)
    print(f'[parse-success] {source} -> {final} and {TEXT_FILE}', flush=True)


def run(db):
    load_workspace_env()
    config = load_config()
    folder = remote_parser_dir()
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'runner.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sync_text_collection(db)
        mail_notice('started', [f'Queue: {config.directory}/{folder}/ on the host, '
                                'read-only. No runtime deadline. Parser only, no OCR.'])
        try:
            # Interrupted parses resume from the retained verified PDF, and the
            # deterministic row key prevents a second dataset row. Reconcile by ROW,
            # because every book shares one cumulative Parquet.
            done = [row for row in db.execute("select * from books where status='success'")
                    if PurePosixPath(row['source']).parts[:1] == (folder,)]
            if done:
                target = ROOT / 'pdfs' / 'parquet' / text_collect.PARQUET_FILE_NAME
                committed, by_sha, by_text = {}, {}, {}
                if target.is_file():
                    import pyarrow.parquet as pq
                    schema = pq.read_schema(target)
                    columns = ['book', 'text'] + (['sha256'] if 'sha256' in schema.names else [])
                    table = pq.read_table(target, columns=columns)
                    for item in table.to_pylist():
                        body = item['text'] or ''
                        committed[item['book']] = body
                        if item.get('sha256'):
                            by_sha[item['sha256']] = body
                        if len(body.strip()) >= text_collect.TEXT_DEDUPE_MIN_CHARS:
                            by_text[body.strip()] = body
                for row in done:
                    key = row['book_key'] or book_key(db, row['source'])
                    section = db.execute('select text from text_sections where source=?',
                                         (row['source'],)).fetchone()
                    # The shared Parquet writer may have deduplicated this PDF
                    # into a row with another book name. Match the same file or
                    # sufficiently long identical text before re-queuing it.
                    body = committed.get(key)
                    if body is None and row['digest']:
                        body = by_sha.get(row['digest'])
                    if body is None and section and len(section['text'].strip()) >= text_collect.TEXT_DEDUPE_MIN_CHARS:
                        body = by_text.get(section['text'].strip())
                    if body is not None:
                        # Existing successes from before TXT support can be
                        # recovered from Parquet without touching the remote PDF.
                        if section is None:
                            title = PurePosixPath(row['source']).stem
                            save_text_section(db, row['source'], title, body)
                        Path(row['local']).unlink(missing_ok=True)
                        continue
                    # No row in the single Parquet - it was wiped, moved, or this ledger
                    # outlived it. Re-queue rather than brick the service: discover()
                    # re-downloads and the row is appended once. This is exactly how a
                    # lost books.parquet gets rebuilt from the host.
                    update(db, row['source'], 'pending', parquet='',
                           error='re-queued: row absent from ' + target.name)
                    print(f'[migrate] {row["source"]}: no row in {target.name}, re-queued',
                          flush=True)
                sync_text_collection(db)
            while True:
                sources = discover(config, folder)
                for source in sources:
                    local = ROOT / 'pdfs' / LOCAL_STAGING / source
                    db.execute('insert or ignore into books(source,local,status,updated) '
                               'values (?,?,?,?)',
                               (source, str(local), 'pending', time.time()))
                db.commit()
                rows = [row for row in db.execute("select * from books where status not in "
                                  "('success','failed','removed') order by source")
                        if PurePosixPath(row['source']).parts[:1] == (folder,)]
                if not rows:
                    break
                for row in rows:
                    source, local = row['source'], Path(row['local'])
                    if shutil.disk_usage(ROOT).free < DISK_FLOOR:
                        raise RuntimeError('VPS disk below scraper 5 GB safety floor')
                    if not local.exists() or not row['digest'] or sha256_file(local) != row['digest']:
                        update(db, source, 'downloading')
                        digest = download(config, source, local)
                        update(db, source, 'downloaded', digest=digest)
                        row = db.execute('select * from books where source=?', (source,)).fetchone()
                    update(db, source, 'parsing')
                    # The parser logs its own reason and returns None, so collect the log
                    # to keep that reason in the ledger instead of only in the journal.
                    notes = []
                    parsed = text_collect.parse_convertable_book_direct(local, log=notes.append)
                    for note in notes:
                        print(note, flush=True)
                    if parsed is None:
                        reason = next((n for n in reversed(notes) if 'warn' in n),
                                      'parser produced no text and no row')
                        update(db, source, 'failed', error=reason)
                        print(f'[parse-failed] {source}: {reason}', flush=True)
                        reminders(db)
                        continue
                    try:
                        commit_dataset(db, row, parsed)
                    except Exception as error:
                        # Anything past the parse itself - segmentation exit, writer
                        # failure, a disk-full append. Mark the book and carry on:
                        # otherwise the service dies, Restart=no keeps it down, and the
                        # row stays in a status this query re-selects forever, so every
                        # book sorted after it is never reached. Stopped is a
                        # BaseException, so SIGTERM still propagates.
                        update(db, source, 'failed', error=f'commit: {error}')
                        print(f'[commit-failed] {source}: {error}', flush=True)
                        reminders(db)
                        continue
                    reminders(db)
            mail_notice('finished', [
                f'Parse stopped: no eligible PDFs remain in {folder}/. '
                'Failed PDFs are not retried.',
                'The reminder timer continues checking retained failures.'])
        finally:
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--remind', action='store_true')
    parser.add_argument('--failure-hook', action='store_true')
    args = parser.parse_args()
    if args.failure_hook:
        # ExecStopPost: the last chance to tell the owner the service is down, so it
        # must not depend on anything the failure may have broken - including the
        # database. This branch runs before database() on purpose.
        result = os.environ.get('SERVICE_RESULT', '')
        if result and result != 'success':
            mail_notice('failed', ['systemd parse service ended: ' + result,
                                   'Exit status: ' + os.environ.get('EXIT_STATUS', 'unknown')])
        return 0
    db = database()
    if args.remind:
        reminders(db)
        return 0
    signal.signal(signal.SIGINT, stopped)
    signal.signal(signal.SIGTERM, stopped)
    try:
        run(db)
        return 0
    except Stopped as error:
        mail_notice('finished', [f'Parse stopped by owner/system: {error}. '
                                 'Unfinished inputs retained.'])
        return 0
    except BaseException as error:
        mail_notice('failed', [f'{type(error).__name__}: {error}',
                               'Parse stopped; inputs/state retained.'])
        raise
    finally:
        db.close()


if __name__ == '__main__':
    raise SystemExit(main())
