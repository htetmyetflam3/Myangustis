// Built-in prebuilt-tree integrity — the cache mechanism lives IN the engine.
//
// The syllable/RTL/POS trees ship prebuilt inside the engine's .cache-tree
// (the build step is not part of running anything). Their authenticity used
// to be checked by each external caller against its own CACHE-SOURCE.json
// copy before copying the tree into a work dir. That alt-tree mechanism is
// gone: the manifest now ships next to the trees and the loader verifies it
// itself, once per process, before any tree is handed out.
//
// Contract:
//   CACHE-MANIFEST.json sits in the tree dir (default: .cache-tree) and lists
//   every shipped file with its sha256. A missing manifest, a missing file or
//   a single mismatched digest is a corrupt/partial install and fails loudly —
//   the engine never silently segments against an unverified trie.
//
// writeCacheManifest() exists for the rebuild tooling only; no runtime path
// ever writes the manifest.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TreeFile } from '../../../bridge/path.js';

export const CACHE_MANIFEST = 'CACHE-MANIFEST.json';

// One verification per resolved tree dir per process; the tree getters cache
// their parsed results too, so a second run must not re-hash megabytes.
const verified = new Map();

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/**
 * Verify the prebuilt tree dir against its shipped manifest.
 * Memoized: the first tree getter of a process pays the hash cost once.
 *
 * @param {string} [treeDir] defaults to the engine's built-in .cache-tree
 * @returns {object} the parsed manifest (files, counts, rebuilt metadata)
 * @throws {Error} manifest missing/unparseable, a listed file missing, or a
 *                 digest mismatch — with the offending file named.
 */
export function verifyCacheTree(treeDir = TreeFile()) {
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

/**
 * Rebuild-tool utility: hash every tree artifact in dir and (re)write the
 * manifest. The runtime never calls this — run it once after a deliberate
 * tree rebuild, then ship the regenerated manifest with the tree.
 *
 * @param {string} [treeDir]
 * @param {object} [meta] optional provenance fields (rebuilt date, note, ...)
 * @returns {object} the manifest written
 */
export function writeCacheManifest(treeDir = TreeFile(), meta = {}) {
  const dir = path.resolve(treeDir);
  const names = fs
    .readdirSync(dir)
    .filter((name) => name !== CACHE_MANIFEST && fs.statSync(path.join(dir, name)).isFile())
    .sort();

  const files = {};
  for (const name of names) files[name] = sha256File(path.join(dir, name));

  // POS root count is the only derived stat callers report without reaching
  // into the tree themselves; compute it at manifest-write time.
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

/** Manifest metadata after verification — the safe caller-facing view. */
export function cacheInfo(treeDir = TreeFile()) {
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
