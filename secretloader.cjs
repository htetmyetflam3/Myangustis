// secretloader.cjs — CommonJS entry. Delegates to the ESM module via dynamic import
// so CJS-only contexts (rare in this repo, but some scripts may still require())
// share the same loader state.
'use strict';

// Load synchronously where possible; for truly synchronous CJS consumers we
// provide a minimal sync re-implementation so require('...') works without await.
const fs = require('node:fs');
const path = require('node:path');

let _loaded = new Set();

function parseDotenv(text) {
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

function findRepoRoot(startDir) {
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

function candidateEnvFiles(callerFile) {
  const callerDir = path.dirname(callerFile);
  const cands = [];
  const local = path.join(callerDir, '.env');
  if (fs.existsSync(local) && fs.statSync(local).isFile()) cands.push(local);
  const repoRoot = findRepoRoot(callerDir);
  if (repoRoot) {
    const rootEnv = path.join(repoRoot, '.env');
    if (fs.existsSync(rootEnv) && fs.statSync(rootEnv).isFile() && rootEnv !== local) cands.push(rootEnv);
    const dataEnv = path.join(repoRoot, '.data', '.env');
    if (fs.existsSync(dataEnv) && fs.statSync(dataEnv).isFile()) cands.push(dataEnv);
  }
  return cands;
}

function loadSecretsSync(callerFile) {
  callerFile = path.resolve(callerFile);
  if (_loaded.has(callerFile)) return { applied: {}, sources: [] };
  _loaded.add(callerFile);
  const files = candidateEnvFiles(callerFile);
  const merged = {};
  for (const f of [...files].reverse()) {
    try { Object.assign(merged, parseDotenv(fs.readFileSync(f, 'utf8'))); } catch {}
  }
  const set = [];
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] === undefined || process.env[k] === '') { process.env[k] = v; set.push(k); }
  }
  return { applied: merged, sources: files, set };
}

function secret(key, fallback) {
  const v = process.env[key];
  if (v !== undefined && v !== '') return v;
  return fallback !== undefined ? String(fallback) : '';
}

function requireSecret(key, callerFile) {
  const v = process.env[key];
  if (v !== undefined && v !== '') return v;
  const searched = callerFile ? candidateEnvFiles(path.resolve(callerFile)) : [];
  const loc = searched.length
    ? `Searched .env at: ${searched.join(', ')}, plus process.env.`
    : 'No .env file was found; set the variable in the environment.';
  throw new Error(`Missing required secret "${key}". ${loc}`);
}

function requireAll(keys, callerFile) {
  const out = {};
  for (const k of keys) out[k] = requireSecret(k, callerFile);
  return out;
}

function _resetForTests() { _loaded = new Set(); }

module.exports = { loadSecrets: (f) => Promise.resolve(loadSecretsSync(f)), loadSecretsSync, secret, requireSecret, requireAll, parseDotenv, candidateEnvFiles, findRepoRoot, _resetForTests };
