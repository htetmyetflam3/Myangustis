import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const SITE_ROOT = path.dirname(fileURLToPath(import.meta.url));

async function resolveWorkspace() {
  try {
    const entry = await import('./_index.js');
    if (typeof entry.JUNK_DIR !== 'string' || !path.isAbsolute(entry.JUNK_DIR) ||
        !entry.ENV_RESULT || !Array.isArray(entry.ENV_RESULT.sources)) {
      throw new TypeError('Invalid workspace or environment export');
    }
    return { base: entry.JUNK_DIR, env: entry.ENV_RESULT, shared: true };
  } catch {
    const sources = [];
    const applied = [];
    const envFile = path.join(SITE_ROOT, '.env');
    try {
      const values = parseEnv(fs.readFileSync(envFile, 'utf8'));
      sources.push(envFile);
      for (const [key, value] of Object.entries(values)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
            (process.env[key] === undefined || process.env[key] === '')) {
          process.env[key] = value;
          applied.push(key);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return { base: SITE_ROOT, env: { sources, applied }, shared: false };
  }
}

const resolved = await resolveWorkspace();
export const BASE_DIR = resolved.base;
export const ENV_RESULT = resolved.env;
const override = String(process.env.PARSER_RUNTIME_DIR || '').trim();
export const SITE_RUNTIME_DIR = override ? path.resolve(SITE_ROOT, override) :
  resolved.shared ? path.join(BASE_DIR, 'Site') : SITE_ROOT;
export const SITE_OUTPUT_DIR = path.join(SITE_RUNTIME_DIR, '.output');
fs.mkdirSync(SITE_OUTPUT_DIR, { recursive: true, mode: 0o700 });

export async function getLogen() {
  const entry = await import('./_index.js');
  return entry.getLogen();
}
