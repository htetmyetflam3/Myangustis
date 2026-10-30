import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));



function loadRootEnv() {
  const sources = [];
  const applied = [];
  for (const file of [path.join(__dirname, '.env'), path.join(__dirname, 'Architecture', 'Engine', '.data', '.env')]) {
    let values;
    try {
      values = parseEnv(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    sources.push(file);
    for (const [key, value] of Object.entries(values)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
          (process.env[key] === undefined || process.env[key] === '')) {
        process.env[key] = value;
        applied.push(key);
      }
    }
  }
  return { sources, applied };
}

export const ENV_RESULT = loadRootEnv();
export const JUNK_DIR = path.resolve(__dirname, './Junk');
fs.mkdirSync(JUNK_DIR, { recursive: true });



export async function getEngineData() {
  return import('./Architecture/Engine/.data/secure.js');
}

export async function getLogen() {
  return import('./logen.js');
}

export async function getEngineBinding() {
  const entry = await import('./Architecture/_index.js');
  return entry.BindEngine;
}

export default { JUNK_DIR, ENV_RESULT, getEngineData, getLogen, getEngineBinding };
