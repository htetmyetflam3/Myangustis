-- FILE: Site/Backend/db/schema.sql
-- Database schema for the site server — SQLite (better-sqlite3).
--
-- This file is THE BASELINE: the shape of a brand-new user_version=1 database.
-- It is NOT the migration. Every statement is IF NOT EXISTS, which means it can
-- create a missing table but can never reshape one that already exists — so a
-- database written by an older build would keep its old columns forever and
-- then fail, either at CREATE INDEX on boot or on the first query under load.
--
-- Versioned steps live in backend/db/migrate.js and the applied version is
-- recorded in PRAGMA user_version. ensureSchema() (backend/db/db.js) runs them.
--
-- CHANGING THE SCHEMA: do not edit a table definition here expecting existing
-- databases to follow. Append a migration step in migrate.js, and edit this
-- file only so that a FRESH database comes out in the same shape. The migration
-- test asserts the two agree.
--
-- There is no server and no phpMyAdmin door onto a SQLite file — the old
-- hand-import step is gone.
--
-- What the MySQL → SQLite move changed in the SQL itself:
--   AUTO_INCREMENT   → INTEGER PRIMARY KEY AUTOINCREMENT
--   INT UNSIGNED     → INTEGER   (SQLite has one integer type, no widths)
--   VARCHAR(n)       → TEXT      (SQLite does not enforce a length)
--   NOW()            → the ISO-8601 UTC expression below (no date type either)
--   UNIQUE KEY (…)   → CREATE UNIQUE INDEX (a separate statement)
--   KEY idx_… (…)    → CREATE INDEX
--   ENGINE/CHARSET/COLLATE → dropped: SQLite is UTF-8 only, always.
--
-- Dates are TEXT, ISO-8601 UTC with milliseconds — they sort chronologically,
-- compare as strings, and JSON-serialise to the same shape mysql2's Date did.
--
-- No MySQL: nothing here needs to know; the file is the database.
-- The `sessions` table is NOT here: the session store creates it on first run
-- (Backend/db/sessionStore.js), exactly as express-mysql-session did.

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  cookie_hash          TEXT    NOT NULL,
  visitor_id           TEXT,
  cf_header_ip         TEXT,
  cf_country           TEXT,
  user_agent           TEXT,
  device_fingerprint   TEXT,
  local_storage_token  TEXT,
  t                    INTEGER NOT NULL DEFAULT 0,
  daily_quota_used     INTEGER NOT NULL DEFAULT 0,
  daily_quota_reset    TEXT,
  -- read by cookieDBCheck (Backend/cookie/sanitized.js), written by nothing:
  -- the column was missing from the MySQL schema too. Kept so the lookup works.
  last_submission_date TEXT,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_cookie_hash ON users (cookie_hash);
CREATE INDEX IF NOT EXISTS idx_users_fingerprint ON users (device_fingerprint);

CREATE TABLE IF NOT EXISTS submissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id   TEXT    NOT NULL,           -- formId (UUID from createUploadSession)
  user_id         INTEGER NOT NULL,
  session_id      TEXT,                       -- visitor hash
  source          TEXT,                       -- 'file' | 'text' | 'existing'
  status          TEXT    DEFAULT 'pending',  -- 'pending' | 'processed'
  file_name       TEXT,
  submit_id       TEXT,                       -- rawSaver submitId
  bridge_path     TEXT,                       -- path to the raw text file
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_submissions_submission_id ON submissions (submission_id);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions (user_id, created_at);

CREATE TABLE IF NOT EXISTS user_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  action     TEXT,
  details    TEXT,
  timestamp  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_user_logs_user ON user_logs (user_id, timestamp);
