import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createProcessingQueue } from '../../../F.Site/Backend/gateway/queue/processingQueue.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

for (const owner of ['Architecture/Engine/_path.js', 'Architecture/host/path.js']) {
  test(`${owner}: setup creates directories and preserves earlier runs`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-retain-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const component = path.join(root, 'component');
    fs.mkdirSync(component);
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    const entry = path.join(component, '_path.js');
    fs.copyFileSync(path.join(repo, owner), entry);
    const api = await import(pathToFileURL(entry).href);
    api.configureWorkspace({ treeDir: path.join(root, 'tree'), outputDir: path.join(root, 'output'), logDir: path.join(root, 'log') });
    const directories = owner.includes('/Engine/') ? ['output', 'log'] : ['tree', 'output', 'log'];
    api.ensureWorkspace();
    for (const dir of directories) {
      assert.ok(fs.statSync(path.join(root, dir)).isDirectory());
      fs.writeFileSync(path.join(root, dir, 'previous.txt'), 'previous run');
      fs.mkdirSync(path.join(root, dir, 'nested'));
      fs.writeFileSync(path.join(root, dir, 'nested/keep.txt'), 'nested output');
    }
    api.ensureWorkspace();
    api.onPathEnsure(path.join(root, 'output'));
    for (const dir of directories) {
      assert.equal(fs.readFileSync(path.join(root, dir, 'previous.txt'), 'utf8'), 'previous run');
      assert.equal(fs.readFileSync(path.join(root, dir, 'nested/keep.txt'), 'utf8'), 'nested output');
    }
    assert.equal(api.resetWorkspace, undefined);
  });
}

for (const owner of ['Architecture/Engine/bridge/logen.js', 'Bridge/logen/logen.js']) {
  test(`${owner}: startup and debug initialization append instead of wiping`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'log-retain-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'writer.log'), 'previous writer log\n');
    fs.writeFileSync(path.join(root, 'normalize-debug.log'), 'previous debug log\n');
    const source = read(owner).replace(/import \{ LogFile \} from [^;]+;/,
      `const LogFile = () => ${JSON.stringify(root)};`);
    for (let run = 0; run < 2; run++) {
      execFileSync(process.execPath, ['--input-type=module', '-e', `
        const l = await import(${JSON.stringify(moduleUrl(source))});
        l.init({ DEBUG: true }); l.debugLogInit();
      `], { stdio: 'pipe' });
    }
    assert.equal(fs.readFileSync(path.join(root, 'writer.log'), 'utf8'), 'previous writer log\n');
    const debug = fs.readFileSync(path.join(root, 'normalize-debug.log'), 'utf8');
    assert.ok(debug.startsWith('previous debug log\n'));
    assert.equal((debug.match(/--- /g) || []).length, 2);
  });
}

for (const options of [{ max: 1 }, { ttlMs: -1 }]) {
  test(`queue eviction retains files: ${JSON.stringify(options)}`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-retain-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const files = ['input.txt', 'final.txt', 'raw.txt', 'original.txt'].map(name => path.join(root, name));
    for (const file of files) fs.writeFileSync(file, 'keep');
    const queue = createProcessingQueue(options);
    t.after(() => queue.dispose());
    const request = id => ({ formId: id, userId: 'user', sessionId: 'session', inputPath: files[0],
      file: { mimetype: 'text/plain' }, intent: { source: 'converter', outputFormat: 'txt', inputFormat: 'txt', originalName: 'input.txt' } });
    await queue.enqueue(request('first'));
    await queue.managerFinished('first', { file: files[1], output: 'txt' });
    await queue.bindSavedResult('first', { submitId: 'submit', bridgePath: files[2], originalPath: files[3] });
    await queue.ready('first', { file: files[1], mimeType: 'text/plain' });
    await queue.enqueue(request('second'));
    assert.equal(queue.getByFormId('first'), null);

    for (const file of files) assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
  });
}

test('startup, rebuild and maintenance no longer clear runtime directories', () => {
  assert.doesNotMatch(read('F.Site/index.js'), /cleanupExpiredRuntimeFiles|runArtifactCleanup|cleanupTimer/);
  assert.equal(fs.existsSync(path.join(repo, 'F.Site/Backend/file/runtimeCleanup.js')), false);
  for (const config of ['F.Site/Frontend/frontend-react/vite.config.js', 'F.Site/Frontend/frontend-react/vite.config.ts']) {
    assert.match(read(config), /emptyOutDir: false/);
  }
  const bootstrap = read('tools-box/bash/bootstrap.sh');
  assert.doesNotMatch(bootstrap, /resetWorkspace/);
  assert.match(bootstrap, /ensureWorkspace\(\)/);
  const clean = bootstrap.slice(bootstrap.lastIndexOf('  clean)'));
  assert.doesNotMatch(clean, /rm -rf.*(?:ENGINE_DIR|LOGS_DIR)/);
});
