#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMasterText } from '../master/secure.js';
import { runBuild, runBuildPos } from './sketch.js';
import { CACHE_MANIFEST, writeCacheManifest } from '../../../Architecture/Engine/MonoSyllabism/main/grapheme/cache-integrity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const TARGET = path.join(REPO, 'Architecture/Engine/.cache-tree');
const FILES = [
  'syllable.tree.json', 'syllable.mapped.txt', 'rtl-tree.json',
  'ref-syllables.json', 'pos.tree.json',
];
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'myangustis-trees-'));

function atomicWrite(destination, data) {
  const tmp = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode: 0o644, flag: 'wx' });
    fs.renameSync(tmp, destination);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

try {
  const sourceHash = crypto.createHash('sha256').update(readMasterText(), 'utf8').digest('hex');
  const { refArray } = await runBuild(null, stage);
  await runBuildPos(stage, refArray);
  const failedPath = path.join(stage, 'pos-fail.txt');
  const failedCount = fs.existsSync(failedPath)
    ? fs.readFileSync(failedPath, 'utf8').split('\n').filter(Boolean).length
    : 0;
  fs.rmSync(failedPath, { force: true });
  for (const file of FILES) {
    const target = path.join(stage, file);
    if (!fs.statSync(target).isFile()) throw new Error(`Tree output is missing: ${file}`);
  }
  const manifest = writeCacheManifest(stage, {
    rebuilt: new Date().toISOString().slice(0, 10),
    note: 'Prebuilt syllable, reverse and POS trees from the encrypted master; verified by cache-integrity.js.',
    sourceMasterSha256: sourceHash,
    excludedPosEntries: failedCount,
  });
  manifest.treeDir = path.relative(REPO, TARGET);
  fs.writeFileSync(path.join(stage, CACHE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

  fs.mkdirSync(TARGET, { recursive: true });
  const names = [...FILES, CACHE_MANIFEST];
  const before = new Map(names.map((name) => {
    const file = path.join(TARGET, name);
    return [name, fs.existsSync(file) ? fs.readFileSync(file) : null];
  }));
  const replaced = [];
  try {
    for (const name of names) {
      atomicWrite(path.join(TARGET, name), fs.readFileSync(path.join(stage, name)));
      replaced.push(name);
    }
  } catch (error) {
    for (const name of replaced.reverse()) {
      const original = before.get(name);
      if (original) atomicWrite(path.join(TARGET, name), original);
      else fs.rmSync(path.join(TARGET, name), { force: true });
    }
    throw error;
  }
  console.log(`[trees] rebuilt ${FILES.length} files; POS entries not represented: ${failedCount}`);
  console.log(`[trees] manifest: ${path.relative(REPO, path.join(TARGET, CACHE_MANIFEST))}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
