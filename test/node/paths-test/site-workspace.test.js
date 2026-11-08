import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

for (const scenario of ['shared', 'missing-root', 'missing-entry', 'broken-entry', 'invalid-export']) {
  test(`Site workspace and environment: ${scenario}`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-path-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const site = path.join(root, 'B.Parser/host');
    fs.mkdirSync(path.join(site, 'Backend/file'), { recursive: true });
    fs.mkdirSync(path.join(root, 'B.Parser'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(root, '.env'), 'SITE_CHAIN=root\nSITE_SHELL=root\n');
    fs.writeFileSync(path.join(site, '.env'), 'SITE_CHAIN=local\nSITE_SHELL=local\n');
    for (const file of ['B.Parser/index-path.js', 'B.Parser/host/_path.js', 'B.Parser/host/Backend/file/paths.js',
      'B.Parser/host/Backend/file/saveOriginfile.js', 'B.Parser/host/Backend/gateway/generator/rawSaver.js',
      'B.Parser/host/Backend/gateway/generator/responses.js', 'Architecture/Engine/.data/secure.js',
      'Architecture/host/advisory.js']) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(path.join(repo, file), path.join(root, file));
    }
    fs.writeFileSync(path.join(root, 'B.Parser/_path.js'), `
      export const OUTPUT_FONT_DIR = "/fonts/used";
      export async function getEngineData() { return import('../Architecture/Engine/.data/secure.js'); }
    `);
    if (scenario !== 'missing-root') fs.copyFileSync(path.join(repo, 'index-path.js'), path.join(root, 'index-path.js'));
    if (scenario !== 'missing-entry') {
      const entry = scenario === 'broken-entry' ? 'throw new Error("broken entry")' :
        scenario === 'invalid-export' ? 'export const JUNK_DIR = "relative"; export const ENV_RESULT = {sources:[]};' :
          fs.readFileSync(path.join(repo, 'B.Parser/host/_index.js'), 'utf8');
      fs.writeFileSync(path.join(site, '_index.js'), entry);
    }
    const env = { ...process.env, SITE_SHELL: 'shell' };
    delete env.SITE_CHAIN;
    delete env.PARSER_RUNTIME_DIR;
    delete env.DB_FILE;
    const entryUrl = pathToFileURL(path.join(site, '_path.js')).href;
    const pathsUrl = pathToFileURL(path.join(site, 'Backend/file/paths.js')).href;
    const saverUrl = pathToFileURL(path.join(site, 'Backend/gateway/generator/rawSaver.js')).href;
    const parserUrl = pathToFileURL(path.join(root, 'B.Parser/_path.js')).href;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
      const p = await import(${JSON.stringify(entryUrl)});
      const paths = await import(${JSON.stringify(pathsUrl)});
      const secure = await (await import(${JSON.stringify(parserUrl)})).getEngineData();
      const fs = await import('node:fs');
      const before = fs.readdirSync(p.SITE_RUNTIME_DIR).sort();
      const upload = await paths.ensureUploadDir('sample.pdf');
      const { createRawSaver } = await import(${JSON.stringify(saverUrl)});
      const saved = await createRawSaver()({ formId:'form', textContent:'hello', metadata:{visitorHash:'hash'} });
      console.log(JSON.stringify({base:p.BASE_DIR, runtime:p.SITE_RUNTIME_DIR, output:p.SITE_OUTPUT_DIR,
        input:upload, raw:saved.rawPath, text:fs.readFileSync(saved.rawPath, 'utf8'),
        db:paths.abs(paths.DB_FILE), master:secure.MASTER_ENC, sources:p.ENV_RESULT.sources,
        value:process.env.SITE_CHAIN, shell:process.env.SITE_SHELL, before}));
    `], { cwd: os.tmpdir(), env, encoding: 'utf8' }));
    const shared = scenario === 'shared';
    const runtime = shared ? path.join(root, 'Junk/Site') : site;
    assert.equal(result.base, shared ? path.join(root, 'Junk') : site);
    assert.equal(result.runtime, runtime);
    assert.equal(result.output, path.join(runtime, '.output'));
    assert.equal(result.input, path.join(runtime, 'upload/input/pdf'));
    assert.equal(path.dirname(result.raw), path.join(runtime, '.output/txt'));
    assert.equal(result.text, 'hello');
    assert.equal(result.db, path.join(site, '.data/site.db'));
    assert.equal(result.master, path.join(root, 'Architecture/Engine/.data/master.json.enc'));
    assert.equal(result.value, shared ? 'root' : 'local');
    assert.equal(result.shell, 'shell');
    assert.deepEqual(result.sources, [path.join(shared ? root : site, '.env')]);
    assert.ok(fs.statSync(result.output).isDirectory());
    assert.ok(fs.statSync(result.input).isDirectory());
    assert.ok(!fs.existsSync(path.join(runtime, 'upload/input/docx')));
    assert.ok(!fs.existsSync(path.join(runtime, 'upload/quarantine')));
    assert.ok(!fs.existsSync(path.join(runtime, '.output/original')));
    assert.ok(!fs.existsSync(path.join(runtime, '.output/.tree')));
    if (shared) assert.deepEqual(result.before, ['.output']);
    if (!shared) assert.equal(fs.existsSync(path.join(root, 'Junk')), false);
  });
}

test('Site fallback preserves previous output', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-preserve-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const site = path.join(root, 'B.Parser/host');
  const output = path.join(site, '.output');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(repo, 'B.Parser/host/_path.js'), path.join(site, '_path.js'));
  fs.writeFileSync(path.join(output, 'keep.txt'), 'previous');
  const env = { ...process.env };
  delete env.PARSER_RUNTIME_DIR;
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    await import(${JSON.stringify(pathToFileURL(path.join(site, '_path.js')).href)});
  `], { cwd: os.tmpdir(), env });
  assert.equal(fs.readFileSync(path.join(output, 'keep.txt'), 'utf8'), 'previous');
});
