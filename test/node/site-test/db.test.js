// FILE: backend/db/db.test.js
//
// Replaces the old backend/db/db_test.js, which was not a test:
//   - no npm script reached it (test:unit globs *.test.js, not *_test.js, and
//     did not include backend/db/ at all);
//   - it wrote into the TRACKED seed database at .data/site.db, inserting rows
//     into users/sessions/user_logs and bumping sqlite_sequence, with no
//     cleanup, so running it dirtied a committed artifact;
//   - it wrapped everything in try/catch + console.log, so it exited 0 even
//     when it failed — a second run threw UNIQUE constraint failed and still
//     reported success;
//   - its header pointed at db.migration.test.mjs, which does not exist.
//
// This runs against a throwaway file, asserts instead of logging, and covers
// the identity/quota layer that previously had no unit coverage at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';
import { SqliteSessionStore } from './sessionStore.js';
import { createRequest } from './request.js';

const SCHEMA_FILE = path.resolve(import.meta.dirname, 'schema.sql');

function freshDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linga-db-'));
  const db = new Database(path.join(dir, 'site.db'));
  db.pragma('foreign_keys = ON');
  migrate(db, { schemaFile: SCHEMA_FILE });
  t.after(() => {
    try { db.close(); } catch { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

const newUser = (db, hash = 'visitor-1') =>
  Number(db.prepare('INSERT INTO users (cookie_hash) VALUES (?)').run(hash).lastInsertRowid);

test('every table the application uses round-trips a row', (t) => {
  const db = freshDb(t);
  const store = new SqliteSessionStore({ db, checkExpirationIntervalMs: 0 });
  t.after(() => store.close());

  const userId = newUser(db);
  db.prepare(
    'INSERT INTO submissions (submission_id, user_id, session_id, source, status) VALUES (?,?,?,?,?)',
  ).run('form-1', userId, 'visitor-1', 'text', 'pending');
  db.prepare('INSERT INTO user_logs (user_id, action, details) VALUES (?,?,?)').run(
    userId, 'test_action', JSON.stringify({ test: true }),
  );

  assert.equal(db.prepare('SELECT cookie_hash FROM users WHERE id = ?').get(userId).cookie_hash, 'visitor-1');
  assert.equal(db.prepare('SELECT status FROM submissions WHERE submission_id = ?').get('form-1').status, 'pending');
  assert.equal(db.prepare('SELECT count(*) n FROM user_logs WHERE user_id = ?').get(userId).n, 1);

  // created_at defaults are ISO-8601 UTC TEXT, which must sort as strings.
  const created = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId).created_at;
  assert.match(created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('cookie_hash is unique', (t) => {
  const db = freshDb(t);
  newUser(db, 'same');
  assert.throws(() => newUser(db, 'same'), /UNIQUE constraint failed/);
});

test('the session store honours expiry on read, not just on sweep', (t) => {
  const db = freshDb(t);
  const store = new SqliteSessionStore({ db, checkExpirationIntervalMs: 0 });
  t.after(() => store.close());

  const live = { cookie: { expires: new Date(Date.now() + 60_000) }, user: 'a' };
  const dead = { cookie: { expires: new Date(Date.now() - 60_000) }, user: 'b' };

  store.set('live', live, () => {});
  store.set('dead', dead, () => {});

  store.get('live', (err, got) => { assert.equal(err, null); assert.equal(got.user, 'a'); });
  store.get('dead', (err, got) => { assert.equal(err, null); assert.equal(got, null); });

  store.length((err, n) => { assert.equal(err, null); assert.equal(n, 1); });
  assert.equal(store.sweep(), 1);
  store.get('live', (err, got) => { assert.equal(got.user, 'a'); });
});

test('session touch extends expiry and destroy removes the row', (t) => {
  const db = freshDb(t);
  const store = new SqliteSessionStore({ db, checkExpirationIntervalMs: 0 });
  t.after(() => store.close());

  store.set('s', { cookie: { expires: new Date(Date.now() + 1000) } }, () => {});
  const before = db.prepare('SELECT expires FROM sessions WHERE session_id = ?').get('s').expires;
  store.touch('s', { cookie: { expires: new Date(Date.now() + 600_000) } }, () => {});
  const after = db.prepare('SELECT expires FROM sessions WHERE session_id = ?').get('s').expires;
  assert.ok(after > before);

  store.destroy('s', () => {});
  assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n, 0);
});

test('a session with no cookie expiry falls back to the store lifetime', (t) => {
  const db = freshDb(t);
  const store = new SqliteSessionStore({ db, expirationMs: 50_000, checkExpirationIntervalMs: 0 });
  t.after(() => store.close());

  store.set('s', {}, () => {});
  const expires = db.prepare('SELECT expires FROM sessions WHERE session_id = ?').get('s').expires;
  assert.ok(expires > Date.now() + 40_000 && expires <= Date.now() + 50_000);
});

test('the daily quota admits exactly three submissions and then refuses', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  const userId = newUser(db);

  const take = () => {
    const { allowed, remaining } = request.consumeQuota({ userId });
    return { allowed, remaining };
  };
  assert.deepEqual(take(), { allowed: true, remaining: 2 });
  assert.deepEqual(take(), { allowed: true, remaining: 1 });
  assert.deepEqual(take(), { allowed: true, remaining: 0 });
  assert.deepEqual(take(), { allowed: false, remaining: 0 });
  assert.equal(db.prepare('SELECT daily_quota_used u FROM users WHERE id = ?').get(userId).u, 3);
});

test('the quota resets when the stored reset day is not today', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  const userId = newUser(db);

  for (let i = 0; i < 3; i++) request.consumeQuota({ userId });
  assert.equal(request.consumeQuota({ userId }).allowed, false);

  db.prepare('UPDATE users SET daily_quota_reset = ? WHERE id = ?')
    .run('2000-01-01T00:00:00.000Z', userId);

  const after = request.consumeQuota({ userId });
  assert.equal(after.allowed, true);
  assert.equal(after.remaining, 2);
  assert.equal(db.prepare('SELECT daily_quota_used u FROM users WHERE id = ?').get(userId).u, 1);
});

test('checkQuota agrees with consumeQuota about whether a submission is allowed', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  const userId = newUser(db);

  for (let i = 0; i < 3; i++) {
    assert.equal(request.checkQuota({ userId }).allowed, true, `check before use ${i}`);
    assert.equal(request.consumeQuota({ userId }).allowed, true, `consume ${i}`);
  }
  assert.equal(request.checkQuota({ userId }).allowed, false);
  assert.equal(request.consumeQuota({ userId }).allowed, false);
});

test('an unknown user cannot consume quota', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  // Without an explicit DB-free licence an unknown id is refused outright —
  // it must not be able to fall through to a fresh cookie allowance.
  const r = request.consumeQuota({ userId: 99999 });
  assert.equal(r.allowed, false);
  assert.equal(request.checkQuota({ userId: 99999 }).allowed, false);
  assert.equal(request.checkQuota({ userId: 99999 }).reason, 'User not found');
});

test('submission lifecycle writes only the statuses the schema allows', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  const userId = newUser(db);

  const formId = request.createUploadSession({ userId, visitorHash: 'v', source: 'file' });
  assert.equal(db.prepare('SELECT status FROM submissions WHERE submission_id = ?').get(formId).status, 'pending');

  request.finalizeUpload({
    userId, formId, submitId: 'sub-1', filename: 'a.txt',
    bridgePath: '/tmp/a.txt', originalName: 'orig.pdf',
  });
  const done = db.prepare('SELECT status, file_name, submit_id FROM submissions WHERE submission_id = ?').get(formId);
  assert.equal(done.status, 'processed');
  assert.equal(done.file_name, 'orig.pdf');
  assert.equal(done.submit_id, 'sub-1');

  const second = request.createUploadSession({ userId, visitorHash: 'v', source: 'text' });
  request.failUpload({ userId, formId: second });
  assert.equal(db.prepare('SELECT status FROM submissions WHERE submission_id = ?').get(second).status, 'failed');
});

test('submission ownership is enforced by user id', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  const mine = newUser(db, 'mine');
  const theirs = newUser(db, 'theirs');

  const formId = request.createUploadSession({ userId: mine, visitorHash: 'mine', source: 'text' });

  assert.doesNotThrow(() => request.validateSubmission({ userId: mine, formId, source: 'existing' }));
  assert.throws(
    () => request.validateSubmission({ userId: theirs, formId, source: 'existing' }),
    /Submission metadata mismatch/,
  );
  assert.throws(() => request.getUploadMetadata({ userId: theirs, formId }), /Upload metadata not found/);
});

test('validateSession requires the user id and visitor hash to agree', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  const userId = newUser(db, 'visitor-x');

  assert.ok(request.validateSession({ userId, visitorHash: 'visitor-x' }));
  assert.throws(
    () => request.validateSession({ userId, visitorHash: 'visitor-y' }),
    /Session metadata mismatch/,
  );
});
