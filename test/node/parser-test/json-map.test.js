import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAP_DIR } from '../../../B.Parser/_path.js';
import { loadSidecarMap } from '../../../B.Parser/main/parser/read/pdf-extract.js';

const repo = new URL('../../../', import.meta.url);

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-json-map-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parser = path.join(root, 'B.Parser');
  const core = path.join(parser, 'main/parser/core');
  const maps = path.join(parser, 'main/parser/jason-map');
  fs.mkdirSync(core, { recursive: true });
  fs.mkdirSync(path.join(maps, 'vector'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(parser, '_path.js'), `export const MAP_DIR = ${JSON.stringify(maps)};`);
  fs.copyFileSync(new URL('B.Parser/main/parser/core/json-map.js', repo), path.join(core, 'json-map.js'));
  const loader = await import(pathToFileURL(path.join(core, 'json-map.js')).href);
  return { root, maps, ...loader };
}

test('loads maps only on request, caches parsing, isolates callers and refreshes changed files', async t => {
  const f = await fixture(t);
  const file = path.join(f.maps, 'first.json');
  fs.writeFileSync(file, '{"nested":{"number":1}}');
  fs.writeFileSync(path.join(f.maps, 'vector/second.json'), '[1,2]');
  const parse = JSON.parse;
  let count = 0;
  JSON.parse = (...args) => { count += 1; return parse(...args); };
  try {
    assert.equal(count, 0);
    const first = f.loadMapJson('first.json');
    assert.equal(count, 1);
    first.nested.number = 99;
    assert.deepEqual(f.loadMapJson('./first.json'), { nested: { number: 1 } });
    assert.equal(count, 1);
    assert.deepEqual(f.loadMapJson('vector/second.json'), [1, 2]);
    assert.equal(count, 2);
    fs.writeFileSync(file, '{"nested":{"number":123}}');
    assert.deepEqual(f.loadMapJson('first.json'), { nested: { number: 123 } });
    assert.equal(count, 3);
    assert.deepEqual(f.loadMapJson('first.json'), { nested: { number: 123 } });
    assert.equal(count, 3);
  } finally {
    JSON.parse = parse;
  }
});

test('the parser sidecar consumer uses the shared map cache', () => {
  const parse = JSON.parse;
  let count = 0;
  JSON.parse = (...args) => { count += 1; return parse(...args); };
  try {
    assert.ok(loadSidecarMap().size > 0);
    assert.equal(count, 1);
    assert.ok(loadSidecarMap(path.join(MAP_DIR, 'cipher-map.json')).size > 0);
    assert.equal(count, 1);
  } finally {
    JSON.parse = parse;
  }
});

test('rejects escaped paths and recovers from missing or malformed maps', async t => {
  const f = await fixture(t);
  const file = path.join(f.maps, 'later.json');
  assert.throws(() => f.loadMapJson('later.json'), { code: 'ENOENT' });
  fs.writeFileSync(file, '{broken');
  assert.throws(() => f.loadMapJson('later.json'), SyntaxError);
  fs.writeFileSync(file, '{"ready":true}');
  assert.deepEqual(f.loadMapJson('later.json'), { ready: true });
  assert.throws(() => f.loadMapJson('../outside.json'), /inside/);
  assert.throws(() => f.loadMapJson(path.join(f.maps, 'later.json')), /relative/);
  assert.throws(() => f.loadMapJson('later.txt'), /relative/);
  fs.writeFileSync(path.join(f.root, 'outside.json'), '{}');
  fs.symlinkSync(path.join(f.root, 'outside.json'), path.join(f.maps, 'link.json'));
  assert.throws(() => f.loadMapJson('link.json'), /inside/);
});
