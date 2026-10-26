import fs from 'node:fs/promises';
import path from 'node:path';
import {
  INPUT_DIR,
  QUARANTINE_DIR,
  RAW_TXT_DIR,
  ORIGINAL_DIR,
  abs,
} from './paths.js';
const RUNTIME_ROOTS = [INPUT_DIR, QUARANTINE_DIR, RAW_TXT_DIR, ORIGINAL_DIR];
async function cleanDirectory(directory, cutoff) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removed += await cleanDirectory(target, cutoff);
      continue;
    }
    try {
      const stat = await fs.lstat(target);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(target);
        removed += 1;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}
export async function cleanupExpiredRuntimeFiles({ maxAgeMs }) {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const root of RUNTIME_ROOTS) {
    removed += await cleanDirectory(abs(root), cutoff);
  }
  return removed;
}