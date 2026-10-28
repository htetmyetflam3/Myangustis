import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../../F.Site/Backend/db/migrate.js';
import { createRequest, dailyLimit, QUOTA_OFF_SENTINEL } from '../../../F.Site/Backend/db/request.js';

const DAILY_LIMIT = dailyLimit();

function freshDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linga-cq-'));
  const db = new Database(path.join(dir, 'site.db'));
  migrate(db, { schemaFile: path.resolve(import.meta.dirname, '../../../F.Site/Backend/db/schema.sql') });
  t.after(() => {
    try { db.close(); } catch { /* closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return db;
}












test('no users row is refused outright, never counted from a cookie', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  const check = request.checkQuota({ userId: 999 });
  assert.equal(check.allowed, false);
  assert.equal(check.reason, 'User not found');
  assert.equal(request.consumeQuota({ userId: 999 }).allowed, false);
});

test('the database is the gate, and it stops at the limit', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  const userId = Number(
    db.prepare('INSERT INTO users (cookie_hash) VALUES (?)').run('v').lastInsertRowid,
  );
  for (let i = 1; i <= DAILY_LIMIT; i++) {
    assert.equal(request.consumeQuota({ userId }).allowed, true);
    const dbUsed = db.prepare('SELECT daily_quota_used u FROM users WHERE id = ?').get(userId).u;
    assert.equal(dbUsed, i, 'the database is the gate');
  }
  assert.equal(request.consumeQuota({ userId }).allowed, false);
});

test('concurrent consumption cannot overrun the limit', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  const userId = Number(
    db.prepare('INSERT INTO users (cookie_hash) VALUES (?)').run('v').lastInsertRowid,
  );
  const results = Array.from({ length: 8 }, () => request.consumeQuota({ userId }));
  assert.equal(results.filter((r) => r.allowed).length, DAILY_LIMIT);
});

test('DAILY_UPLOAD_LIMIT configures the limit, and 0 switches it off', (t) => {
  const db = freshDb(t);
  const request = createRequest({ db });
  const userId = Number(
    db.prepare('INSERT INTO users (cookie_hash) VALUES (?)').run('v').lastInsertRowid,
  );
  const saved = process.env.DAILY_UPLOAD_LIMIT;
  const set = (v) => { if (v === undefined) delete process.env.DAILY_UPLOAD_LIMIT;
    else process.env.DAILY_UPLOAD_LIMIT = v; };
  t.after(() => set(saved));


  set('5');
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const r = request.consumeQuota({ userId });
    seen.push(r.allowed ? r.remaining : 'refused');
  }
  assert.deepEqual(seen, [4, 3, 2, 1, 0, 'refused']);
  assert.equal(db.prepare('SELECT daily_quota_used u FROM users WHERE id = ?').get(userId).u, 5);


  set('0');
  for (let i = 0; i < 10; i++) {
    const r = request.consumeQuota({ userId });
    assert.equal(r.allowed, true, `upload ${i} with the limit off`);
    assert.equal(r.remaining, QUOTA_OFF_SENTINEL);
    assert.equal(r.limit, 0);
  }

  assert.equal(db.prepare('SELECT daily_quota_used u FROM users WHERE id = ?').get(userId).u, 5);

  set(undefined);
  assert.equal(dailyLimit(), 3, 'unset falls back to 3');
});

test('a junk DAILY_UPLOAD_LIMIT is rejected rather than silently defaulted', (t) => {
  const saved = process.env.DAILY_UPLOAD_LIMIT;
  t.after(() => { if (saved === undefined) delete process.env.DAILY_UPLOAD_LIMIT;
    else process.env.DAILY_UPLOAD_LIMIT = saved; });
  for (const bad of ['-1', 'three', '3.5', 'off', '1e3', '200000']) {
    process.env.DAILY_UPLOAD_LIMIT = bad;
    assert.throws(() => dailyLimit(), /DAILY_UPLOAD_LIMIT/, `value ${JSON.stringify(bad)}`);
  }
});
