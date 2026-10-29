import session from 'express-session';
import { setInterval, clearInterval } from 'node:timers';
const TABLE = 'sessions';
export class SqliteSessionStore extends session.Store {
  constructor({
    db,
    tableName = TABLE,
    expirationMs = 24 * 60 * 60 * 1000,
    checkExpirationIntervalMs = 15 * 60 * 1000,
  } = {}) {
    super();
    if (!db) throw new Error('SqliteSessionStore needs an open better-sqlite3 db');
    this.db = db;
    this.tableName = tableName;
    this.expirationMs = expirationMs;
    const table = `"${String(tableName).replace(/"/g, '""')}"`;
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (
         session_id TEXT PRIMARY KEY NOT NULL,
         expires    INTEGER NOT NULL,   -- epoch ms; expires <= now is dead
         data       TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_${String(tableName).replace(/[^A-Za-z0-9_]/g, '_')}_expires
         ON ${table} (expires);`,
    );
    this.statements = {
      get: db.prepare(`SELECT data, expires FROM ${table} WHERE session_id = ?`),
      set: db.prepare(
        `INSERT INTO ${table} (session_id, expires, data) VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET expires = excluded.expires, data = excluded.data`,
      ),
      destroy: db.prepare(`DELETE FROM ${table} WHERE session_id = ?`),
      touch: db.prepare(`UPDATE ${table} SET expires = ? WHERE session_id = ?`),
      length: db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE expires > ?`),
      clear: db.prepare(`DELETE FROM ${table}`),
      all: db.prepare(`SELECT data FROM ${table} WHERE expires > ?`),
      sweep: db.prepare(`DELETE FROM ${table} WHERE expires <= ?`),
    };
    if (checkExpirationIntervalMs > 0) {
      this.timer = setInterval(() => this.sweep(), checkExpirationIntervalMs);
      if (typeof this.timer.unref === 'function') this.timer.unref();
    }
  }
  #expiresAt(sess) {
    const fromCookie = sess?.cookie?.expires;
    const ms = fromCookie ? new Date(fromCookie).getTime() : NaN;
    return Number.isFinite(ms) ? ms : Date.now() + this.expirationMs;
  }
  #fail(err, cb) {
    if (this.listenerCount('error') > 0) this.emit('error', err);
    if (cb) cb(err);
  }
  get(sid, cb) {
    try {
      const row = this.statements.get.get(sid);
      if (!row || row.expires <= Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (err) {
      this.#fail(err, cb);
    }
  }
  set(sid, sess, cb) {
    try {
      this.statements.set.run(sid, this.#expiresAt(sess), JSON.stringify(sess));
      cb?.(null);
    } catch (err) {
      this.#fail(err, cb);
    }
  }
  destroy(sid, cb) {
    try {
      this.statements.destroy.run(sid);
      cb?.(null);
    } catch (err) {
      this.#fail(err, cb);
    }
  }
  touch(sid, sess, cb) {
    try {
      this.statements.touch.run(this.#expiresAt(sess), sid);
      cb?.(null);
    } catch (err) {
      this.#fail(err, cb);
    }
  }
  length(cb) {
    try {
      cb(null, this.statements.length.get(Date.now()).n);
    } catch (err) {
      this.#fail(err, cb);
    }
  }
  clear(cb) {
    try {
      this.statements.clear.run();
      cb?.(null);
    } catch (err) {
      this.#fail(err, cb);
    }
  }
  all(cb) {
    try {
      cb(null, this.statements.all.all(Date.now()).map((r) => JSON.parse(r.data)));
    } catch (err) {
      this.#fail(err, cb);
    }
  }
  sweep() {
    try {
      return this.statements.sweep.run(Date.now()).changes;
    } catch (err) {
      this.#fail(err);
      return 0;
    }
  }
  close() {
    clearInterval(this.timer);
    this.timer = null;
  }
}