import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { TREE_DIR, cacheInfo } from '../../../Architecture/Engine/MonoSyllabism/main/grapheme/cache-integrity.js';

const engine = fileURLToPath(new URL('../../../Architecture/Engine/', import.meta.url));
test('bundled tree path and shipped manifest are valid', () => {
  assert.equal(path.resolve(TREE_DIR), path.join(engine, '.cache-tree'));
  assert.ok(cacheInfo().files.includes('syllable.tree.json'));
});

for (const layout of ['Engine', 'Myangustis/Architecture/Engine']) {
  test(`tree location follows relocated engine: ${layout}`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-tree-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const relocated = path.join(root, layout);
    const modulePath = path.join(relocated, 'MonoSyllabism/main/grapheme/cache-integrity.js');
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    fs.copyFileSync(path.join(engine, 'MonoSyllabism/main/grapheme/cache-integrity.js'), modulePath);
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      const m = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
      let error;
      try { m.verifyCacheTree(); } catch (e) { error = e.message; }
      console.log(JSON.stringify({dir:m.TREE_DIR, exists:fs.existsSync(m.TREE_DIR), error}));
    `], { cwd: os.tmpdir(), encoding: 'utf8' }));
    assert.equal(path.resolve(result.dir), path.join(relocated, '.cache-tree'));
    assert.equal(result.exists, false, 'loading must not create an empty tree directory');
    assert.match(result.error, /prebuilt tree manifest missing/);
  });
}
