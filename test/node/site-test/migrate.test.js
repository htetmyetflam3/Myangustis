import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  migrate,
  baselineDrift,
  hasApplicationTables,
  SchemaDriftError,
  LATEST_VERSION,
  BASELINE_TABLES,
} from './migrate.js';

const SCHEMA_FILE = path.resolve(import.meta.dirname, 'schema.sql');

function tempDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linga-migrate-'));
  const db = new Database(path.join(dir, 'site.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    try { db.close(); } catch { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

const version = (db) => Number(db.pragma('user_version', { simple: true }));
const columns = (db, table) =>
  db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((c) => c.name);

test('a fresh file is created at the latest version', (t) => {
  const db = tempDb(t);
  assert.equal(hasApplicationTables(db), false);

  const result = migrate(db, { schemaFile: SCHEMA_FILE });

  assert.equal(result.from, 0);
  assert.equal(result.to, LATEST_VERSION);
  assert.equal(version(db), LATEST_VERSION);
  for (const [table, expected] of Object.entries(BASELINE_TABLES)) {
    assert.deepEqual(
      expected.filter((c) => !columns(db, table).includes(c)),
      [],
      `${table} is missing baseline columns`,
    );
  }
});

test('migrating twice is a no-op', (t) => {
  const db = tempDb(t);
  migrate(db, { schemaFile: SCHEMA_FILE });
  const second = migrate(db, { schemaFile: SCHEMA_FILE });

  assert.equal(second.from, LATEST_VERSION);
  assert.equal(second.to, LATEST_VERSION);
  assert.deepEqual(second.applied, []);
});

test('an unversioned database with the baseline shape is adopted, not rebuilt', (t) => {
  const db = tempDb(t);
  db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));          // legacy boot path
  db.prepare('INSERT INTO users (cookie_hash) VALUES (?)').run('legacy-visitor');
  db.pragma('user_version = 0');                           // no ledger existed
  assert.equal(hasApplicationTables(db), true);

  const result = migrate(db, { schemaFile: SCHEMA_FILE });

  assert.equal(result.from, 0);
  assert.equal(result.to, LATEST_VERSION);
  assert.ok(result.applied.includes('1:adopt-legacy'));
  // The row survived.
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 1);
});

test('a drifted database is refused with an actionable error, and is left untouched', (t) => {
  const db = tempDb(t);
  // A users table from before device_fingerprint/daily_quota_* existed. This is
  // the case that used to kill the process with "no such column:
  // device_fingerprint" from CREATE INDEX, with a bare stack trace.
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cookie_hash TEXT NOT NULL,
    t INTEGER NOT NULL DEFAULT 0
  )`);
  db.prepare('INSERT INTO users (cookie_hash) VALUES (?)').run('old-visitor');

  const drift = baselineDrift(db);
  assert.ok(drift.missingColumns.users.includes('device_fingerprint'));
  assert.ok(drift.missingTables.includes('submissions'));

  assert.throws(
    () => migrate(db, { schemaFile: SCHEMA_FILE }),
    (error) => {
      assert.ok(error instanceof SchemaDriftError);
      assert.match(error.message, /device_fingerprint/);
      assert.match(error.message, /Nothing has been changed/);
      assert.match(error.message, /DB_FILE/);
      return true;
    },
  );

  // Refused means refused: no partial work, no stamped version, row intact.
  assert.equal(version(db), 0);
  assert.deepEqual(columns(db, 'users'), ['id', 'cookie_hash', 't']);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 1);
});

test('duplicate rows that violate a unique index are reported, not thrown raw', (t) => {
  const db = tempDb(t);
  const baseline = fs.readFileSync(SCHEMA_FILE, 'utf8');
  // Baseline shape, but without the unique index, and with rows that break it.
  db.exec(baseline.replace(/CREATE UNIQUE INDEX[^;]+;/g, ''));
  const insert = db.prepare('INSERT INTO users (cookie_hash) VALUES (?)');
  insert.run('same');
  insert.run('same');

  assert.throws(
    () => migrate(db, { schemaFile: SCHEMA_FILE }),
    (error) => {
      assert.ok(error instanceof SchemaDriftError);
      assert.match(error.message, /cookie_hash|unique/i);
      assert.match(error.message, /Nothing has been changed/);
      return true;
    },
  );
  assert.equal(version(db), 0);
});

test('migration 2 gives submissions and user_logs real foreign keys', (t) => {
  const db = tempDb(t);
  migrate(db, { schemaFile: SCHEMA_FILE });

  for (const table of ['submissions', 'user_logs']) {
    const fks = db.pragma(`foreign_key_list(${table})`);
    assert.equal(fks.length, 1, `${table} should reference users`);
    assert.equal(fks[0].table, 'users');
    assert.equal(fks[0].on_delete, 'CASCADE');
  }

  db.pragma('foreign_keys = ON');
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO submissions (submission_id, user_id, source, status) VALUES (?,?,?,?)')
        .run('orphan', 99999, 'text', 'pending'),
    /FOREIGN KEY constraint failed/,
  );
});

test('migration 2 enforces the enumerated source and status values', (t) => {
  const db = tempDb(t);
  migrate(db, { schemaFile: SCHEMA_FILE });
  const userId = Number(
    db.prepare('INSERT INTO users (cookie_hash) VALUES (?)').run('v').lastInsertRowid,
  );
  const insert = db.prepare(
    'INSERT INTO submissions (submission_id, user_id, source, status) VALUES (?,?,?,?)',
  );

  // Everything the application actually writes must still be accepted.
  insert.run('f-1', userId, 'file', 'pending');
  insert.run('f-2', userId, 'text', 'processed');
  insert.run('f-3', userId, 'text', 'failed');

  assert.throws(() => insert.run('f-4', userId, 'wat', 'pending'), /CHECK constraint failed/);
  assert.throws(() => insert.run('f-5', userId, 'text', 'not-a-status'), /CHECK constraint failed/);
});

test('migration 2 drops rows it cannot make referentially valid, and keeps the rest', (t) => {
  const db = tempDb(t);
  // Build a v1 database by hand, with one good row and one orphan.
  db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  db.pragma('user_version = 1');
  const userId = Number(
    db.prepare('INSERT INTO users (cookie_hash) VALUES (?)').run('v').lastInsertRowid,
  );
  const insert = db.prepare(
    'INSERT INTO submissions (submission_id, user_id, source, status) VALUES (?,?,?,?)',
  );
  insert.run('keep', userId, 'text', 'processed');
  insert.run('orphan', 99999, 'text', 'pending');

  migrate(db, { schemaFile: SCHEMA_FILE });

  const kept = db.prepare('SELECT submission_id FROM submissions').all().map((r) => r.submission_id);
  assert.deepEqual(kept, ['keep']);
  assert.equal(version(db), LATEST_VERSION);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('the indexes the application queries through survive the rebuild', (t) => {
  const db = tempDb(t);
  migrate(db, { schemaFile: SCHEMA_FILE });
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name)
    .sort();
  assert.deepEqual(indexes, [
    'idx_submissions_user',
    'idx_user_logs_user',
    'idx_users_fingerprint',
    'uq_submissions_submission_id',
    'uq_users_cookie_hash',
  ]);
});
