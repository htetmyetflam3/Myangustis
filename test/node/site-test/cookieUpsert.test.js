import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';

const SCHEMA_FILE = path.resolve(import.meta.dirname, 'schema.sql');

// createOrUpdateCookie binds to the shared singleton db at import time, so the
// behaviour under test is reproduced against a throwaway database here. The
// statements mirror backend/db/cookie.js exactly.
function makeUpsert(db) {
  const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  let writes = 0;
  const upsert = db.transaction((cookieData) => {
    const hash = cookieData.userId;
    const cfHeader = cookieData.cfHeader || 'unknown';
    const cfCountry = cookieData.cfCountry || 'unknown';
    const userAgent = cookieData.userAgent || 'unknown';
    const deviceFingerprint = cookieData.deviceFingerprint || '';
    const localStorageToken = cookieData.localStorageToken || '';

    const existing = db
      .prepare(
        `SELECT id, cf_header_ip, cf_country, user_agent, device_fingerprint,
                local_storage_token FROM users WHERE cookie_hash = ?`,
      )
      .get(hash);

    if (!existing) {
      writes += 1;
      return Number(
        db
          .prepare(
            `INSERT INTO users (cookie_hash, visitor_id, cf_header_ip, cf_country,
               user_agent, device_fingerprint, local_storage_token, t,
               daily_quota_used, daily_quota_reset, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,${SQL_NOW},${SQL_NOW},${SQL_NOW})`,
          )
          .run(hash, hash, cfHeader, cfCountry, userAgent, deviceFingerprint,
            localStorageToken, 0, 0).lastInsertRowid,
      );
    }
    const changed =
      existing.cf_header_ip !== cfHeader ||
      existing.cf_country !== cfCountry ||
      existing.user_agent !== userAgent ||
      existing.device_fingerprint !== deviceFingerprint ||
      existing.local_storage_token !== localStorageToken;
    if (changed) {
      writes += 1;
      db.prepare(
        `UPDATE users SET cf_header_ip=?, cf_country=?, user_agent=?,
           device_fingerprint=?, local_storage_token=?, updated_at=${SQL_NOW}
         WHERE id = ?`,
      ).run(cfHeader, cfCountry, userAgent, deviceFingerprint, localStorageToken, existing.id);
    }
    return existing.id;
  });
  return { upsert, writes: () => writes };
}

function freshDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linga-upsert-'));
  const db = new Database(path.join(dir, 'site.db'));
  migrate(db, { schemaFile: SCHEMA_FILE });
  t.after(() => {
    try { db.close(); } catch { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

const identity = (over = {}) => ({
  userId: 'visitor-1',
  cfHeader: '203.0.113.7',
  cfCountry: 'MM',
  userAgent: 'Mozilla/5.0',
  deviceFingerprint: 'fp-1',
  localStorageToken: 'tok-1',
  ...over,
});

test('an unchanged identity does not rewrite the row on every request', (t) => {
  const db = freshDb(t);
  const { upsert, writes } = makeUpsert(db);

  const id = upsert(identity());
  assert.equal(writes(), 1, 'the insert');

  // cookieGenerator runs on EVERY /api request, including read-only GETs and
  // the status poll loop. Twenty identical requests used to mean twenty writes.
  for (let i = 0; i < 20; i++) assert.equal(upsert(identity()), id);
  assert.equal(writes(), 1, 'no further writes for an identical identity');
});

test('a changed identity still writes', (t) => {
  const db = freshDb(t);
  const { upsert, writes } = makeUpsert(db);

  const id = upsert(identity());
  assert.equal(writes(), 1);

  assert.equal(upsert(identity({ cfHeader: '198.51.100.2' })), id);
  assert.equal(writes(), 2, 'new IP is persisted');

  assert.equal(upsert(identity({ cfHeader: '198.51.100.2', userAgent: 'curl/8' })), id);
  assert.equal(writes(), 3, 'new user agent is persisted');

  const row = db.prepare('SELECT cf_header_ip, user_agent FROM users WHERE id = ?').get(id);
  assert.equal(row.cf_header_ip, '198.51.100.2');
  assert.equal(row.user_agent, 'curl/8');

  assert.equal(upsert(identity({ cfHeader: '198.51.100.2', userAgent: 'curl/8' })), id);
  assert.equal(writes(), 3, 'and then settles again');
});

test('distinct visitors still get distinct rows', (t) => {
  const db = freshDb(t);
  const { upsert } = makeUpsert(db);
  const a = upsert(identity({ userId: 'visitor-a' }));
  const b = upsert(identity({ userId: 'visitor-b' }));
  assert.notEqual(a, b);
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 2);
});
