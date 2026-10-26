// secretloader.js — single .env/environment loader for the entire repo (ESM).
//
// Resolution order (first win per key):
//   1. Real process.env already set in the environment (shell, CI, Docker, Codespaces).
//   2. Caller's own .env — a .env sitting next to the file that imports secretloader
//      (resolved from import.meta.url).
//   3. Repo root .env — walks UP from the caller until package.json is found
//      and looks for .env there. The shared dev default.
//   4. <repo>/.data/.env — the sealed-key companion file (secrets beside master.json.enc).
//
// If NO .env file is found anywhere, process.env is the sole source (Codespaces /
// deployed case). Only callers that request required keys throw on miss.
//
// Syntax accepted:  KEY=val | export KEY=val | quoted (""/'') | # and // comments | blank lines.
// No shell interpolation — values are literal. Duplicate keys: later wins.
//
// Real environment variables ALWAYS win — a key already present in process.env is
// never overwritten by anything read from disk. Matches the existing Bridge
// contract and what Codespaces/CI rely on.
//
// Usage in any JS module:
//   import { loadSecrets, secret, requireSecret, requireAll } from '../../secretloader.js';
//   await loadSecrets(import.meta.url);           // fill process.env from disk, idempotent
//   const k = secret('API_KEY');                  // string | ''
//   const k = requireSecret('MASTER_JSON_KEY');   // throws if missing/empty
//   requireAll(['API_KEY', 'COOKIE_SECRET']);     // batch require

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const _loaded = new Set();

// ── parsing ──────────────────────────────────────────────────────────────────

export function parseDotenv(text) {
  const out = Object.create(null);
  for (const rawLine of text.split(/\r?\n/u)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.at(-1) === val[0]) {
      val = val.slice(1, -1);
    } else {
      const ci = val.indexOf(' #');
      if (ci !== -1) val = val.slice(0, ci).trim();
    }
    out[key] = val;
  }
  return out;
}

// ── discovery ────────────────────────────────────────────────────────────────

export function findRepoRoot(startDir) {
  let d = startDir;
  const { root } = path.parse(d);
  while (d && d !== root) {
    if (fs.existsSync(path.join(d, 'package.json'))) return d;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return null;
}

/**
 * Candidate .env files in priority order (caller → root → .data/).
 * Only returns existing files.
 */
export function candidateEnvFiles(callerFile) {
  const callerDir = path.dirname(callerFile);
  const cands = [];
  const local = path.join(callerDir, '.env');
  if (fs.existsSync(local) && fs.statSync(local).isFile()) cands.push(local);
  const repoRoot = findRepoRoot(callerDir);
  if (repoRoot) {
    const rootEnv = path.join(repoRoot, '.env');
    if (fs.existsSync(rootEnv) && fs.statSync(rootEnv).isFile() && rootEnv !== local) {
      cands.push(rootEnv);
    }
    const dataEnv = path.join(repoRoot, '.data', '.env');
    if (fs.existsSync(dataEnv) && fs.statSync(dataEnv).isFile()) cands.push(dataEnv);
  }
  return cands;
}

function safeRead(file) {
  try { return parseDotenv(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function applyToProcessEnv(values) {
  const set = [];
  for (const [k, v] of Object.entries(values)) {
    if (process.env[k] === undefined || process.env[k] === '') {
      process.env[k] = v;
      set.push(k);
    }
  }
  return set;
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Load .env files for a caller and fill gaps in process.env. Idempotent per
 * caller file; calling twice is a no-op.
 *
 * @param {string|URL} callerMetaUrl  typically `import.meta.url`
 * @returns {{ applied: Record<string,string>, sources: string[] }}
 */
export function loadSecretsSync(callerMetaUrl) {
  const callerFile = (typeof callerMetaUrl === 'string' && callerMetaUrl.startsWith('file:'))
    ? fileURLToPath(callerMetaUrl)
    : (callerMetaUrl instanceof URL ? fileURLToPath(callerMetaUrl) : String(callerMetaUrl));
  if (_loaded.has(callerFile)) return { applied: {}, sources: [] };
  _loaded.add(callerFile);
  const files = candidateEnvFiles(callerFile);
  const merged = Object.create(null);
  // Apply farther-from-caller first so closer values win.
  for (const f of [...files].reverse()) Object.assign(merged, safeRead(f));
  applyToProcessEnv(merged);
  return { applied: merged, sources: files };
}

/** Async alias — file IO is synchronous but this keeps API symmetry. */
export async function loadSecrets(callerMetaUrl) {
  return loadSecretsSync(callerMetaUrl);
}

/**
 * Read a single secret. Priority: process.env → fallback. Empty string = not set.
 * @param {string} key
 * @param {string} [fallback]
 */
export function secret(key, fallback) {
  const v = process.env[key];
  if (v !== undefined && v !== '') return v;
  return fallback !== undefined ? String(fallback) : '';
}

/**
 * Require a secret. Throws with a helpful message naming where we searched.
 * @param {string} key
 * @param {string|URL} [callerMetaUrl]
 */
export function requireSecret(key, callerMetaUrl) {
  const v = process.env[key];
  if (v !== undefined && v !== '') return v;
  let searched = [];
  if (callerMetaUrl) {
    const callerFile = (typeof callerMetaUrl === 'string' && callerMetaUrl.startsWith('file:'))
      ? fileURLToPath(callerMetaUrl)
      : String(callerMetaUrl);
    searched = candidateEnvFiles(callerFile);
  }
  const loc = searched.length
    ? `Searched .env at: ${searched.join(', ')}, plus process.env.`
    : 'No .env file was found; set the variable in the environment.';
  throw new Error(`Missing required secret "${key}". ${loc}`);
}

/**
 * Require several keys at once; returns { key: value }.
 * @param {string[]} keys
 * @param {string|URL} [callerMetaUrl]
 */
export function requireAll(keys, callerMetaUrl) {
  const out = Object.create(null);
  for (const k of keys) out[k] = requireSecret(k, callerMetaUrl);
  return out;
}

/** Test helper: forget which callers have already loaded. */
export function _resetForTests() { _loaded.clear(); }

export default { loadSecrets, loadSecretsSync, secret, requireSecret, requireAll, parseDotenv, candidateEnvFiles, findRepoRoot, _resetForTests };
