import fs from 'node:fs';
import path from 'node:path';
import { MAP_DIR } from '../../../_path.js';

const cache = new Map();

export function mapNameForPath(file) {
  const relative = path.relative(MAP_DIR, path.resolve(file));
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative) && relative.endsWith('.json') ? relative : null;
}

export function loadMapJson(name) {
  if (typeof name !== 'string' || path.isAbsolute(name) || !name.endsWith('.json')) {
    throw new TypeError('Expected a relative JSON map name');
  }
  const file = path.resolve(MAP_DIR, name);
  if (!mapNameForPath(file)) throw new Error('JSON map must be inside the parser map directory');
  const realRoot = fs.realpathSync(MAP_DIR);
  const realFile = fs.realpathSync(file);
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('JSON map must be inside the parser map directory');
  }
  const stat = fs.statSync(realFile, { bigint: true });
  const version = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  let entry = cache.get(realFile);
  if (!entry || entry.version !== version) {
    const value = JSON.parse(fs.readFileSync(realFile, 'utf8'));
    entry = { version, value };
    cache.set(realFile, entry);
  }
  return globalThis.structuredClone(entry.value);
}
