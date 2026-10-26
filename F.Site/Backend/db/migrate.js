import fs from 'node:fs';

export class SchemaDriftError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'SchemaDriftError';
    this.details = details;
  }
}

export const BASELINE_TABLES = {
  users: [
    'id', 'cookie_hash', 'visitor_id', 'cf_header_ip', 'cf_country',
    'user_agent', 'device_fingerprint', 'local_storage_token', 't',
    'daily_quota_used', 'daily_quota_reset', 'last_submission_date',
    'created_at', 'updated_at',
  ],
  submissions: [
    'id', 'submission_id', 'user_id', 'session_id', 'source', 'status',
    'file_name', 'submit_id', 'bridge_path', 'created_at', 'updated_at',
  ],
  user_logs: ['id', 'user_id', 'action', 'details', 'timestamp'],
};

const tableNames = (db) =>
  new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name),
  );

const columnNames = (db, table) =>
  new Set(db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((c) => c.name));

export function baselineDrift(db) {
  const present = tableNames(db);
  const missingTables = [];
  const missingColumns = {};
  for (const [table, expected] of Object.entries(BASELINE_TABLES)) {
    if (!present.has(table)) {
      missingTables.push(table);
      continue;
    }
    const actual = columnNames(db, table);
    const missing = expected.filter((c) => !actual.has(c));
    if (missing.length) missingColumns[table] = missing;
  }
  return { missingTables, missingColumns };
}


export function hasApplicationTables(db) {
  const present = tableNames(db);
  return Object.keys(BASELINE_TABLES).some((t) => present.has(t));
}

function adoptLegacyDatabase(db, schemaSql) {
  const { missingTables, missingColumns } = baselineDrift(db);
  const columnProblems = Object.entries(missingColumns);

  
  
  
  if (columnProblems.length) {
    const detail = columnProblems
      .map(([table, cols]) => `  - ${table} is missing: ${cols.join(', ')}`)
      .join('\n');
    throw new SchemaDriftError(
      'This SQLite file predates schema versioning and does not match the ' +
        'current baseline, so it cannot be adopted automatically:\n' +
        `${detail}\n\n` +
        'Nothing has been changed. Back the file up, then either migrate it by ' +
        'hand (ALTER TABLE ... ADD COLUMN) and re-run, or point DB_FILE at a ' +
        'fresh path to start clean.',
      { missingTables, missingColumns },
    );
  }

  try {
    db.exec(schemaSql);
  } catch (error) {
    throw new SchemaDriftError(
      'This SQLite file predates schema versioning and the baseline could not ' +
        `be applied to it: ${error.message}\n\n` +
        'A common cause is existing rows that violate a unique index (for ' +
        'example duplicate users.cookie_hash). Nothing has been changed. ' +
        'Resolve the conflicting rows, or point DB_FILE at a fresh path.',
      { cause: error.message },
    );
  }
}

export const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline',
    apply(db, { schemaSql }) {
      db.exec(schemaSql);
    },
  },
  {
    version: 2,
    name: 'referential-integrity',
    
    
    
    apply(db) {
      db.exec(`
        CREATE TABLE submissions_v2 (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          submission_id   TEXT    NOT NULL,
          user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          session_id      TEXT,
          source          TEXT    CHECK (source IS NULL OR source IN ('file', 'text')),
          status          TEXT    DEFAULT 'pending'
                                  CHECK (status IS NULL OR status IN ('pending', 'processed', 'failed')),
          file_name       TEXT,
          submit_id       TEXT,
          bridge_path     TEXT,
          created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        INSERT INTO submissions_v2
          (id, submission_id, user_id, session_id, source, status, file_name,
           submit_id, bridge_path, created_at, updated_at)
          SELECT id, submission_id, user_id, session_id, source, status, file_name,
                 submit_id, bridge_path, created_at, updated_at
            FROM submissions
           WHERE user_id IN (SELECT id FROM users)
             AND (source IS NULL OR source IN ('file', 'text'))
             AND (status IS NULL OR status IN ('pending', 'processed', 'failed'));
        DROP TABLE submissions;
        ALTER TABLE submissions_v2 RENAME TO submissions;
        CREATE UNIQUE INDEX uq_submissions_submission_id ON submissions (submission_id);
        CREATE INDEX idx_submissions_user ON submissions (user_id, created_at);

        CREATE TABLE user_logs_v2 (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          action     TEXT,
          details    TEXT,
          timestamp  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        INSERT INTO user_logs_v2 (id, user_id, action, details, timestamp)
          SELECT id, user_id, action, details, timestamp
            FROM user_logs
           WHERE user_id IN (SELECT id FROM users);
        DROP TABLE user_logs;
        ALTER TABLE user_logs_v2 RENAME TO user_logs;
        CREATE INDEX idx_user_logs_user ON user_logs (user_id, timestamp);
      `);
    },
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;


export function migrate(db, { schemaFile, log = () => {} }) {
  const schemaSql = fs.readFileSync(schemaFile, 'utf8');
  let version = Number(db.pragma('user_version', { simple: true })) || 0;
  const from = version;
  const applied = [];

  if (version === 0 && hasApplicationTables(db)) {
    
    
    adoptLegacyDatabase(db, schemaSql);
    db.pragma('user_version = 1');
    version = 1;
    applied.push('1:adopt-legacy');
    log('[db] adopted an unversioned database as schema v1');
  }

  for (const step of MIGRATIONS) {
    if (step.version <= version) continue;
    const fkWasOn = Number(db.pragma('foreign_keys', { simple: true })) === 1;
    if (fkWasOn) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        step.apply(db, { schemaSql });
        db.pragma(`user_version = ${step.version}`);
      })();
    } catch (error) {
      throw new Error(
        `Schema migration ${step.version} (${step.name}) failed and was rolled ` +
          `back: ${error.message}`,
        { cause: error },
      );
    } finally {
      if (fkWasOn) db.pragma('foreign_keys = ON');
    }
    
    const violations = db.pragma('foreign_key_check');
    if (violations.length) {
      throw new Error(
        `Schema migration ${step.version} (${step.name}) left ` +
          `${violations.length} foreign key violation(s).`,
      );
    }
    version = step.version;
    applied.push(`${step.version}:${step.name}`);
    log(`[db] applied schema migration ${step.version} (${step.name})`);
  }

  return { from, to: version, applied };
}
