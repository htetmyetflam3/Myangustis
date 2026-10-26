import fs from 'fs';
import Database from 'better-sqlite3';
import { DB_FILE, abs, ensureDataDir, SCHEMA_FILE } from '../file/paths.js';
import { migrate } from './migrate.js';

export const dbPath = abs(DB_FILE);

export const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

ensureDataDir();

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');


export function ensureSchema({ log = console.log } = {}) {
  const result = migrate(db, { schemaFile: abs(SCHEMA_FILE), log });
  if (result.from !== result.to) {
    log(`[db] schema ${result.from} → ${result.to}`);
  }
  return dbPath;
}


export function secureDbFiles() {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.chmodSync(file, 0o600);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}


export function closeDb() {
  db.close();
}

export function dbInfo() {
  return { file: dbPath, exists: fs.existsSync(dbPath) };
}
