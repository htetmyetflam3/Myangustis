import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

for (const scenario of ['shared', 'nested', 'standalone', 'missing-component-entry', 'broken-exporter', 'invalid-export']) {
  test(`Parser workspace: ${scenario}`, t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'myangustis-path-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const root = scenario === 'nested' ? path.join(temporary, 'Myangustis') : temporary;
    const component = path.join(root, 'B.Parser');
    fs.mkdirSync(component, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(component, '.env'), 'PARSER_LOCAL_ONLY=must-not-load\n');
    fs.copyFileSync(path.join(repo, 'B.Parser/_path.js'), path.join(component, '_path.js'));
    if (scenario !== 'missing-component-entry') {
      fs.copyFileSync(path.join(repo, 'B.Parser/_index.js'), path.join(component, '_index.js'));
    }
    if (scenario !== 'standalone') {
      fs.copyFileSync(path.join(repo, 'index-path.js'), path.join(root, 'index-path.js'));
    }
    if (scenario === 'broken-exporter') {
      fs.writeFileSync(path.join(root, 'index-path.js'), 'throw new Error("unavailable");');
    }
    if (scenario === 'invalid-export') {
      fs.writeFileSync(path.join(root, 'index-path.js'), 'export const JUNK_DIR = undefined;');
    }
    const url = pathToFileURL(path.join(component, '_path.js')).href;
    const env = { ...process.env };
    delete env.PARSER_LOCAL_ONLY;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
      const p = await import(${JSON.stringify(url)});
      console.log(JSON.stringify({runtime:p.RUNTIME_ROOT, fonts:p.FONT_DIR,
        output:p.DEFAULT_OUTPUT_DIR, source:p.PARSER_DIR, local:process.env.PARSER_LOCAL_ONLY ?? null}));
    `], { cwd: os.tmpdir(), env, encoding: 'utf8' }));
    const shared = ['shared', 'nested'].includes(scenario);
    assert.equal(result.runtime, shared ? path.join(root, 'Junk/Parser') : component);
    assert.equal(result.fonts, path.join(shared ? path.join(root, 'Junk') : component, 'fonts/Unicode'));
    assert.equal(result.source, path.join(component, 'main/parser'));
    for (const dir of [result.output]) {
      assert.ok(fs.statSync(dir).isDirectory(), dir);
    }
    assert.equal(result.local, null);
    assert.equal(fs.existsSync(result.fonts), false);
    assert.equal(fs.existsSync(path.join(result.runtime, 'upload')), false);
    assert.equal(fs.existsSync(path.join(result.output, 'txt')), false);
    if (!shared) assert.equal(fs.existsSync(path.join(root, 'Junk')), false);
  });
}

test('Parser setup preserves existing output', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-preserve-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const component = path.join(root, 'B.Parser');
  const output = path.join(component, '.output');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(repo, 'B.Parser/_path.js'), path.join(component, '_path.js'));
  fs.writeFileSync(path.join(output, 'keep.txt'), 'previous');
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    const p = await import(${JSON.stringify(pathToFileURL(path.join(component, '_path.js')).href)});
    p.ensureDirs();
  `], { cwd: os.tmpdir() });
  assert.equal(fs.readFileSync(path.join(output, 'keep.txt'), 'utf8'), 'previous');
});
