import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

for (const component of ['parser', 'engine']) {
  for (const scenario of ['shared', 'missing-root', 'missing-entry', 'broken-entry', 'invalid-result']) {
    test(`${component} environment chain: ${scenario}`, t => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myangustis-env-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
      fs.mkdirSync(path.join(root, '.data'));
      fs.writeFileSync(path.join(root, '.data/.env'), 'CHAIN_OLD=forbidden\n');
      fs.mkdirSync(path.join(root, 'Architecture/Engine/.data'), { recursive: true });
      fs.writeFileSync(path.join(root, '.env'), 'CHAIN_VALUE=root\nCHAIN_SHELL=file\nCHAIN_EMPTY=filled\n');
      fs.writeFileSync(path.join(root, 'Architecture/Engine/.data/.env'), 'CHAIN_VALUE=data\nCHAIN_DATA=data\n');
      const part = component === 'parser' ? path.join(root, 'B.Parser') : path.join(root, 'Architecture/Engine');
      const entry = component === 'parser' ? path.join(part, '_index.js') : path.join(root, 'Architecture/_index.js');
      const source = component === 'parser' ? 'B.Parser/_path.js' : 'Architecture/Engine/_path.js';
      fs.mkdirSync(part, { recursive: true });
      fs.copyFileSync(path.join(repo, source), path.join(part, '_path.js'));
      fs.writeFileSync(path.join(part, '.env'), 'CHAIN_VALUE=local\nCHAIN_SHELL=local\nCHAIN_EMPTY=local-filled\n');
      if (scenario !== 'missing-root') fs.copyFileSync(path.join(repo, 'index-path.js'), path.join(root, 'index-path.js'));
      if (scenario !== 'missing-entry') {
        const relative = '../index-path.js';
        const code = scenario === 'broken-entry' ? 'throw new Error("unavailable");' :
          scenario === 'invalid-result' ? 'export const JUNK_DIR = "/valid"; export const ENV_RESULT = null;' :
            `export { JUNK_DIR, ENV_RESULT } from '${relative}';`;
        fs.writeFileSync(entry, code);
      }
      const env = { ...process.env, CHAIN_SHELL: 'shell', CHAIN_EMPTY: '' };
      delete env.CHAIN_VALUE;
      delete env.CHAIN_DATA;
      delete env.CHAIN_OLD;
      const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
        const p = await import(${JSON.stringify(pathToFileURL(path.join(part, '_path.js')).href)});
        console.log(JSON.stringify({base:p.BASE_DIR, env:p.ENV_RESULT, value:process.env.CHAIN_VALUE,
          shell:process.env.CHAIN_SHELL, empty:process.env.CHAIN_EMPTY, data:process.env.CHAIN_DATA ?? null, old:process.env.CHAIN_OLD ?? null}));
      `], { cwd: os.tmpdir(), env, encoding: 'utf8' }));
      const shared = scenario === 'shared';
      assert.equal(result.base, shared ? path.join(root, 'Junk') : part);
      assert.equal(result.value, shared ? 'root' : 'local');
      assert.equal(result.shell, 'shell');
      assert.equal(result.empty, shared ? 'filled' : 'local-filled');
      assert.equal(result.data, shared ? 'data' : null);
      assert.equal(result.old, null);
      assert.deepEqual(result.env.sources, shared ? [path.join(root, '.env'), path.join(root, 'Architecture/Engine/.data/.env')] : [path.join(part, '.env')]);
      assert.ok(result.env.applied.includes('CHAIN_VALUE'));
      assert.ok(!result.env.applied.includes('CHAIN_SHELL'));
    });
  }
}

test('real engine entry loads the root environment before host configuration', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myangustis-engine-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, '.env'), 'PORT=43217\n');
  for (const file of ['index-path.js', 'Architecture/_index.js', 'Architecture/Engine/_path.js',
    'Architecture/Engine/init/bridge.js', 'Architecture/host/config.js', 'Architecture/host/job-store.js']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(repo, file), path.join(root, file));
  }
  const env = { ...process.env };
  delete env.PORT;
  const enginePath = pathToFileURL(path.join(root, 'Architecture/Engine/_path.js')).href;
  const configPath = pathToFileURL(path.join(root, 'Architecture/host/config.js')).href;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    const p = await import(${JSON.stringify(enginePath)});
    const { config } = await import(${JSON.stringify(configPath)});
    console.log(JSON.stringify({port:config.port, sources:p.ENV_RESULT.sources}));
  `], { cwd: os.tmpdir(), env, encoding: 'utf8' }));
  assert.equal(result.port, 43217);
  assert.deepEqual(result.sources, [path.join(root, '.env')]);
});

test('standalone engine reads its local data with its local environment', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myangustis-engine-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engine = path.join(root, 'Engine');
  fs.mkdirSync(path.join(engine, '.data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(repo, 'Architecture/Engine/_path.js'), path.join(engine, '_path.js'));
  fs.copyFileSync(path.join(repo, 'Architecture/Engine/.data/secure.js'), path.join(engine, '.data/secure.js'));
  const key = 'ab'.repeat(32);
  fs.writeFileSync(path.join(engine, '.env'), `MASTER_JSON_KEY=${key}\n`);
  const { createCipheriv } = await import('node:crypto');
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const body = Buffer.concat([cipher.update('{"fixture":true}', 'utf8'), cipher.final()]);
  fs.writeFileSync(path.join(engine, '.data/master.json.enc'), Buffer.concat([Buffer.from('MGR1'), iv, cipher.getAuthTag(), body]));
  const env = { ...process.env };
  delete env.MASTER_JSON_KEY;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    const p = await import(${JSON.stringify(pathToFileURL(path.join(engine, '_path.js')).href)});
    const data = await p.getEngineData();
    console.log(JSON.stringify({master:data.MASTER_ENC, result:data.readMasterJson(), sources:p.ENV_RESULT.sources}));
  `], { cwd: os.tmpdir(), env, encoding: 'utf8' }));
  assert.equal(result.master, path.join(engine, '.data/master.json.enc'));
  assert.deepEqual(result.result, { fixture: true });
  assert.deepEqual(result.sources, [path.join(engine, '.env')]);
});

test('shared entry reaches the single engine-owned master', async () => {
  const root = await import('../../../index-path.js');
  const entry = await import('../../../Architecture/_index.js');
  const engine = await import('../../../Architecture/Engine/_path.js');
  const fromRoot = await root.getEngineData();
  const fromEntry = await entry.getEngineData();
  const fromEngine = await engine.getEngineData();
  assert.strictEqual(fromRoot, fromEngine);
  assert.strictEqual(fromEntry, fromEngine);
  assert.equal(fromRoot.MASTER_ENC, path.join(repo, 'Architecture/Engine/.data/master.json.enc'));
  assert.equal(fs.existsSync(path.join(repo, '.data')), false);
  assert.ok(fs.existsSync(fromRoot.MASTER_ENC));
});
