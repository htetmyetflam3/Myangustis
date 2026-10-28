import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myangustis-master-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  for (const file of [
    'index-path.js', 'Architecture/_index.js', 'Architecture/Engine/_path.js',
    'Architecture/Engine/.data/secure.js', 'Architecture/Engine/init/bridge.js',
    'Architecture/host/config.js', 'Architecture/host/job-store.js',
    'Architecture/Engine/MonoSyllabism/main/grapheme/Tree.loaded.js',
    'Architecture/Engine/MonoSyllabism/main/grapheme/cache-integrity.js',
  ]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repo, file), target);
  }
  const dataDir = path.join(root, 'Architecture/Engine/.data');
  const master = path.join(dataDir, 'master.json.enc');
  const cache = path.join(dataDir, 'master.json.cache');
  const key = 'ab'.repeat(32);
  const seal = value => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value, null, 2), 'utf8'), cipher.final()]);
    fs.writeFileSync(master, Buffer.concat([Buffer.from('MGR1'), iv, cipher.getAuthTag(), body]));
  };
  return { root, master, cache, key, seal };
}

test('master access uses the engine cache, isolates callers and invalidates on source or key change', async t => {
  const f = fixture(t);
  const originalKey = process.env.MASTER_JSON_KEY;
  t.after(() => {
    if (originalKey === undefined) delete process.env.MASTER_JSON_KEY;
    else process.env.MASTER_JSON_KEY = originalKey;
  });
  process.env.MASTER_JSON_KEY = f.key;
  const first = { marker: 'private-fixture-marker', nested: { value: 1 }, syllables: { burmese: ['က', 'ခ'] } };
  f.seal(first);
  const entry = await import(pathToFileURL(path.join(f.root, 'index-path.js')).href);
  const data = await entry.getEngineData();
  assert.deepEqual(data.readMasterJson(), first);
  assert.equal(fs.readFileSync(f.cache).subarray(0, 4).toString(), 'MGC1');
  assert.equal(fs.readFileSync(f.cache).includes(Buffer.from(first.marker)), false);
  const originalParse = JSON.parse;
  try {
    JSON.parse = (value, ...args) => {
      if (value === JSON.stringify(first, null, 2)) throw new Error('master JSON reparsed');
      return originalParse(value, ...args);
    };
    const copy = data.readMasterJson();
    copy.nested.value = 99;
    assert.equal(data.readSecureJson(f.master).nested.value, 1);
    assert.equal(data.readSecureJson(f.master.slice(0, -4)).nested.value, 1);
  } finally {
    JSON.parse = originalParse;
  }
  const tree = await import(pathToFileURL(path.join(f.root, 'Architecture/Engine/MonoSyllabism/main/grapheme/Tree.loaded.js')).href);
  assert.deepEqual(await tree.loadSyllablesData(), ['က', 'ခ']);
  assert.deepEqual(await tree.streamSyllables(f.master), ['က', 'ခ']);
  const oldHash = data.masterFingerprint();
  f.seal({ marker: 'updated', nested: { value: 2 } });
  assert.notEqual(data.masterFingerprint(), oldHash);
  assert.deepEqual(data.readMasterJson(), { marker: 'updated', nested: { value: 2 } });
  process.env.MASTER_JSON_KEY = 'cd'.repeat(32);
  assert.throws(() => data.readMasterJson());
  delete process.env.MASTER_JSON_KEY;
  assert.throws(() => data.readMasterJson(), /Missing required secret/);
});

test('a corrupt encrypted master cache is rebuilt in a fresh process', t => {
  const f = fixture(t);
  f.seal({ marker: 'recovered' });
  fs.writeFileSync(f.cache, 'damaged');
  const code = `const root=await import(${JSON.stringify(pathToFileURL(path.join(f.root, 'index-path.js')).href)}); console.log(JSON.stringify((await root.getEngineData()).readMasterJson()));`;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: os.tmpdir(), env: { ...process.env, MASTER_JSON_KEY: f.key }, encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(output), { marker: 'recovered' });
  assert.equal(fs.readFileSync(f.cache).subarray(0, 4).toString(), 'MGC1');
  assert.equal(fs.readFileSync(f.cache).includes(Buffer.from('recovered')), false);
});
