
















import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


export const TREE_DIR = fileURLToPath(new URL('../../../.cache-tree/', import.meta.url));

export const CACHE_MANIFEST = 'CACHE-MANIFEST.json';



const verified = new Map();

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}










export function verifyCacheTree(treeDir = TREE_DIR) {
  const dir = path.resolve(treeDir);
  const cached = verified.get(dir);
  if (cached) return cached;

  const manifestPath = path.join(dir, CACHE_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `prebuilt tree manifest missing: ${manifestPath}. The engine ships a ` +
        'verified .cache-tree with CACHE-MANIFEST.json; restore it instead of ' +
        'pointing the loader at an unverified directory.',
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`prebuilt tree manifest is not valid JSON (${manifestPath}): ${err.message}`);
  }

  const files = manifest.files;
  if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
    throw new Error(`prebuilt tree manifest lists no files: ${manifestPath}`);
  }

  for (const [name, expected] of Object.entries(files)) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) {
      throw new Error(`prebuilt tree file missing: ${target} (manifest: ${manifestPath})`);
    }
    const actual = sha256File(target);
    if (actual !== expected) {
      throw new Error(
        `prebuilt tree integrity failed for ${name}: sha256 ${actual} does not match ` +
          `the shipped manifest ${expected}. Refuse to load an unverified trie.`,
      );
    }
  }

  verified.set(dir, manifest);
  return manifest;
}










export function writeCacheManifest(treeDir = TREE_DIR, meta = {}) {
  const dir = path.resolve(treeDir);
  const names = fs
    .readdirSync(dir)
    .filter((name) => name !== CACHE_MANIFEST && fs.statSync(path.join(dir, name)).isFile())
    .sort();

  const files = {};
  for (const name of names) files[name] = sha256File(path.join(dir, name));



  let counts = {};
  const posPath = path.join(dir, 'pos.tree.json');
  if (fs.existsSync(posPath)) {
    counts = { posRoots: Object.keys(JSON.parse(fs.readFileSync(posPath, 'utf8'))).length };
  }

  const manifest = {
    ...meta,
    generatedAt: new Date().toISOString(),
    treeDir: path.relative(process.cwd(), dir) || '.',
    counts,
    files,
  };
  fs.writeFileSync(path.join(dir, CACHE_MANIFEST), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  verified.delete(dir);
  return manifest;
}


export function cacheInfo(treeDir = TREE_DIR) {
  const manifest = verifyCacheTree(treeDir);
  return {
    manifest: CACHE_MANIFEST,
    treeDir: path.resolve(treeDir),
    rebuilt: manifest.rebuilt ?? null,
    generatedAt: manifest.generatedAt ?? null,
    counts: manifest.counts ?? {},
    files: Object.keys(manifest.files),
  };
}
