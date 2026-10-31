import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { PDFDocument } from 'pdf-lib';

// These are deliberately small test limits, not production configuration.
process.env.UPLOAD_MAX_MB = '1';
process.env.PRASER_MAX_PAGES = '1';
process.env.PRASER_MAX_TEXT_CHARS = '10';
process.env.PRASER_MAX_STREAM_MB = '1';
process.env.PRASER_MAX_DOCX_ENTRIES = '2';
process.env.PRASER_MAX_OCR_PAGES = '1';
const ownerKey = 'unit-test-owner-key';
const fallbackKey = 'unit-test-fallback-key';
const ownerHash = crypto.createHash('sha256').update(ownerKey).digest('hex');
process.env.CURL_KEY_SHA256 = ownerHash;
process.env.CURL_KEY = fallbackKey;

const { Manager } = await import('../../../B.Parser/main/parser/manager.js');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'parser-owner-test-'));
const manager = new Manager({ outputDir: directory });

test.after(async () => {
  await manager.close();
  await fs.rm(directory, { recursive: true, force: true });
});

async function makePdf(name, texts, { largeStream = false, largeFile = false } = {}) {
  const document = await PDFDocument.create();
  for (const text of texts) document.addPage().drawText(text);
  if (largeStream) {
    const comment = `%${'x'.repeat(1024 * 1024 + 32)}\n`;
    const stream = document.context.register(document.context.flateStream(comment));
    document.getPages()[0].node.addContentStream(stream);
  }
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const contents = largeFile
    ? Buffer.concat([bytes, Buffer.from(`\n%${'x'.repeat(1024 * 1024)}\n`)])
    : bytes;
  const file = path.join(directory, name);
  await fs.writeFile(file, contents);
  return file;
}

const pdfJob = (file, extra = {}) => ({
  job: 'extracting', method: 'default', output: 'txt', inputKind: 'pdf',
  filename: path.basename(file), inPath: file, includeText: true, ...extra,
});
const signed = { ownerKey };

const twoPage = await makePdf('two-pages.pdf', ['One', 'Two']);
const textPage = await makePdf('text.pdf', ['Hello World']);
const streamPage = await makePdf('large-stream.pdf', ['A'], { largeStream: true });
const filePage = await makePdf('large-input.pdf', ['A'], { largeFile: true });

test('only the verified key lifts page limits; owner workers never become public workers', async () => {
  const job = pdfJob(twoPage);
  await assert.rejects(manager.dispatch(job), /1 page cap/);
  await assert.rejects(manager.dispatch(job, 'site', { ownerKey: fallbackKey }), /Invalid owner key/);
  await assert.rejects(manager.dispatch(job, 'site', { ownerKey: 'wrong' }), /Invalid owner key/);
  await assert.rejects(manager.dispatch({ ...job, ownerKey, owner: true, unlimited: true }, 'site',
    { owner: true, unlimited: true }), /1 page cap/);

  const owner = await manager.dispatch(job, 'site', signed);
  assert.equal(owner.pages, 2);
  assert.doesNotMatch(JSON.stringify(owner), /unit-test-owner-key/);
  await assert.rejects(manager.dispatch(job), /1 page cap/);

  const [first, second] = await Promise.allSettled([
    manager.dispatch(job, 'site', signed), manager.dispatch(job),
  ]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(first.value.pages, 2);
  assert.equal(second.status, 'rejected');
  assert.match(second.reason.message, /1 page cap/);
  assert.equal(manager._worker, undefined);
  assert.equal(manager.workers, undefined);
});

test('the existing plain key is accepted only when the hash is not configured', async () => {
  process.env.CURL_KEY_SHA256 = '';
  try {
    assert.equal((await manager.dispatch(pdfJob(twoPage), 'site', { ownerKey: fallbackKey })).pages, 2);
    await assert.rejects(manager.dispatch(pdfJob(twoPage), 'site', signed), /Invalid owner key/);
    process.env.CURL_KEY = '';
    await assert.rejects(manager.dispatch(pdfJob(twoPage), 'site', { ownerKey: fallbackKey }), /Invalid owner key/);
  } finally {
    process.env.CURL_KEY_SHA256 = ownerHash;
    process.env.CURL_KEY = fallbackKey;
  }
});

test('owner authorization also reaches the main-thread manual PDF writer', async () => {
  const result = await manager.dispatch(pdfJob(twoPage, { method: 'manual' }), 'site', signed);
  assert.equal(result.pages, 2);
  assert.deepEqual(result.ocrPages, []);
  await assert.rejects(manager.dispatch(pdfJob(twoPage, { method: 'manual' })), /1 page cap/);
});

test('text, input-size and decompressed content-stream caps remain public-only', async () => {
  await assert.rejects(manager.dispatch(pdfJob(textPage)), /10 character cap/);
  assert.ok((await manager.dispatch(pdfJob(textPage), 'site', signed)).textChars > 10);

  await assert.rejects(manager.dispatch(pdfJob(filePage)), /1 MB cap/);
  assert.equal((await manager.dispatch(pdfJob(filePage), 'site', signed)).pages, 1);

  await assert.rejects(manager.dispatch(pdfJob(streamPage)), /content stream exceeds/);
  assert.equal((await manager.dispatch(pdfJob(streamPage), 'site', signed)).pages, 1);
});

test('plain text rendering and DOCX archive processing honor the same authorization', async () => {
  const input = path.join(directory, 'input.txt');
  const output = path.join(directory, 'input.docx');
  await fs.writeFile(input, 'Hello World');
  await assert.rejects(manager.renderPlainText({ inPath: input, outPath: output }), /10 character cap/);
  const rendered = await manager.renderPlainText({ inPath: input, outPath: output }, signed);
  assert.equal(rendered.text, 'Hello World');
  const job = {
    job: 'extracting', method: 'default', output: 'txt', inputKind: 'docx',
    filename: 'input.docx', inPath: output, includeText: true,
  };
  await assert.rejects(manager.dispatch(job), /2 member cap/);
  assert.ok((await manager.dispatch(job, 'site', signed)).textChars > 10);
});

test('the Python bridge sends the key separately and Node verifies it', async () => {
  const modulePath = path.resolve('B.Parser/main/Python/modules/node_manager.py');
  const out = path.join(directory, 'python.txt');
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('parser_node_manager', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
key = json.loads(sys.stdin.read())['ownerKey']
try:
    module.dispatch_path(sys.argv[2], sys.argv[3], method='default', owner_key='wrong')
    raise AssertionError('wrong key accepted')
except module.ManagerError as exc:
    assert 'Invalid owner key' in str(exc)
result = module.dispatch_path(sys.argv[2], sys.argv[3], method='default', owner_key=key)
assert result['pages'] == 2
assert key not in json.dumps(result)
print('ok')
`;
  const child = spawnSync('python3', ['-c', script, modulePath, twoPage, out], {
    input: JSON.stringify({ ownerKey }), encoding: 'utf8', env: process.env, timeout: 30000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'ok');
});

test('Python wrapper does not impose its timeout on a supplied owner key', () => {
  const modulePath = path.resolve('B.Parser/main/Python/modules/node_manager.py');
  const script = `
import importlib.util, json, os, sys, types
spec = importlib.util.spec_from_file_location('parser_node_manager', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
os.environ['PRASER_PYTHON_TIMEOUT_SECONDS'] = '3'
calls = []
def run(*args, **kwargs):
    if args[0][-1] == '--verify-owner':
        calls.append(('verify', kwargs['timeout'], kwargs['input']))
        if kwargs['input'] == 'bad':
            return types.SimpleNamespace(returncode=1, stderr='Invalid owner key')
        return types.SimpleNamespace(returncode=0, stderr='')
    payload = kwargs['input']
    presented = None
    if args[0][-1] == '--owner-request':
        header, payload = payload.split('\\n', 1)
        presented = json.loads(header)['ownerKey']
    request = json.loads(payload)
    assert 'ownerKey' not in request and 'ownerKey' not in request['job']
    calls.append(('job', kwargs['timeout'], presented))
    with open(request['responsePath'], 'w', encoding='utf-8') as response:
        json.dump({'ok': True}, response)
    return types.SimpleNamespace(returncode=0, stderr='')
module.subprocess.run = run
module._request({})
module._request({}, owner_key='test')
try:
    module._request({}, owner_key='bad')
    raise AssertionError('invalid key accepted')
except module.ManagerError:
    pass
assert calls == [('job', 3, None), ('verify', 3, 'test'), ('job', None, 'test'), ('verify', 3, 'bad')]
`;
  const child = spawnSync('python3', ['-c', script, modulePath], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('the Python bridge checks the owner header before accepting a large request', async () => {
  const entry = path.resolve('B.Parser/extend/python-entry.js');
  const responsePath = path.join(directory, 'large-response.json');
  const request = {
    job: pdfJob(twoPage, { meta: { padding: 'x'.repeat(1_000_001) } }),
    caller: 'site', responsePath,
  };
  const body = JSON.stringify(request);
  const publicCall = spawnSync(process.execPath, [entry], { input: body, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(publicCall.status, 0);
  assert.match(publicCall.stderr, /Manager request is too large/);
  const invalid = spawnSync(process.execPath, [entry, '--owner-request'], {
    input: `${JSON.stringify({ ownerKey: 'wrong' })}\n{}`, encoding: 'utf8', timeout: 30000,
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid owner key/);
  const malformed = spawnSync(process.execPath, [entry, '--owner-request'], {
    input: `{"ownerKey":"${ownerKey}" bad}\n{}`, encoding: 'utf8', timeout: 30000,
  });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /Invalid owner authorization/);
  assert.doesNotMatch(malformed.stderr, /unit-test-owner-key/);
  const authorized = spawnSync(process.execPath, [entry, '--owner-request'], {
    input: `${JSON.stringify({ ownerKey })}\n${body}`, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(authorized.status, 0, authorized.stderr);
  const response = await fs.readFile(responsePath, 'utf8');
  assert.equal(JSON.parse(response).pages, 2);
  assert.doesNotMatch(response, /unit-test-owner-key/);
});

test('owner worker resource profiles remove PDF, DOCX and OCR quotas', async () => {
  const limitsUrl = new URL('../../../B.Parser/main/parser/core/limits.js', import.meta.url).href;
  const pdfUrl = new URL('../../../B.Parser/main/parser/read/pdf-extract.js', import.meta.url).href;
  const docxUrl = new URL('../../../B.Parser/main/parser/read/docx-extract.js', import.meta.url).href;
  async function profile(owner) {
    const code = `
      const { parentPort } = require('node:worker_threads');
      Promise.all([import(${JSON.stringify(limitsUrl)}), import(${JSON.stringify(pdfUrl)}), import(${JSON.stringify(docxUrl)})])
        .then(([l,p,d]) => parentPort.postMessage({
          input:l.MAX_INPUT_BYTES, pages:l.MAX_PAGES, text:l.MAX_TEXT_CHARS,
          pixels:l.MAX_OCR_PIXELS, ocrPages:l.MAX_OCR_PAGES,
          streams:p.MAX_STREAM_MB, objects:p.MAX_PDF_OBJECTS,
          members:d.MAX_DOCX_ENTRIES, memberSize:d.MAX_MEMBER_MB,
          totalSize:d.MAX_DOCX_TOTAL_MB, ratio:d.MAX_MEMBER_RATIO,
        })).catch(error => { throw error; });
    `;
    const worker = new Worker(code, { eval: true, workerData: { parserOwner: owner } });
    try {
      return await new Promise((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      });
    } finally {
      await worker.terminate();
    }
  }
  const publicProfile = await profile(false);
  const ownerProfile = await profile(true);
  for (const [name, value] of Object.entries(publicProfile)) {
    assert.ok(Number.isFinite(value), `${name} must be capped for public workers`);
    assert.equal(ownerProfile[name], Infinity, `${name} must not cap an owner worker`);
  }
});

test('large ToUnicode ranges stay bounded publicly but are not truncated for owner workers', async () => {
  const pdfUrl = new URL('../../../B.Parser/main/parser/read/pdf-extract.js', import.meta.url).href;
  const code = `
    const { parentPort } = require('node:worker_threads');
    import(${JSON.stringify(pdfUrl)}).then(({parseToUnicodeStream}) => {
      const cmap = '1 beginbfrange\\n<000000> <010000> <00000041>\\nendbfrange';
      parentPort.postMessage(parseToUnicodeStream(Buffer.from(cmap)).size);
    }).catch(error => { throw error; });
  `;
  async function count(owner) {
    const worker = new Worker(code, { eval: true, workerData: { parserOwner: owner } });
    try {
      return await new Promise((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      });
    } finally { await worker.terminate(); }
  }
  assert.equal(await count(false), 0);
  assert.equal(await count(true), 65537);
});

test('owner jobs are not subject to the public worker timeout', async () => {
  const managerUrl = new URL('../../../B.Parser/main/parser/manager.js', import.meta.url).href;
  const script = `
    const assert = require('node:assert/strict');
    (async () => {
      const { Manager } = await import(${JSON.stringify(managerUrl)});
      const m = new Manager({outputDir:process.argv[3]});
      const job = {job:'extracting',method:'default',output:'txt',inputKind:'pdf',inPath:process.argv[2]};
      try {
        await assert.rejects(m.dispatch(job), /worker exceeded 1 ms/);
        assert.equal((await m.dispatch(job, 'site', {ownerKey:process.env.TEST_OWNER_KEY})).pages, 2);
      } finally { await m.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const file = path.join(directory, 'timeout-test.cjs');
  await fs.writeFile(file, script);
  const child = spawnSync(process.execPath, [file, twoPage, directory], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PRASER_TIMEOUT_MS: '1', TEST_OWNER_KEY: ownerKey },
  });
  assert.equal(child.status, 0, child.stderr);
});

test('the authenticated Site curl route forwards the key without changing the public path', async (t) => {
  const express = await import('express').then((mod) => mod.default, () => null);
  const multerAvailable = await import('multer').then(() => true, () => false);
  if (!express || !multerAvailable) return t.skip('Site dependencies are not installed');
  process.env.PARSER_RUNTIME_DIR = path.join(directory, 'site');
  process.env.CURL_ENDPOINT = '/owner-convert';
  process.env.CURL_MAX_MB = '0';
  const { createCurlRouter } = await import('../../../F.Site/Backend/gateway/api/curl.js');
  const { closePraserManager, createPdfParser } = await import('../../../F.Site/Backend/file/praser.js');
  const intent = {
    source: 'converter', job: 'extracting', method: 'default', outputFormat: 'txt',
    inputFormat: 'pdf', uploadName: 'two-pages.pdf',
  };
  await assert.rejects(createPdfParser().parse(twoPage, null, { intent }),
    (error) => error.cause && /1 page cap/.test(error.cause.message));
  const app = express();
  const { path: suffix, router } = createCurlRouter();
  app.use(suffix, router);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const url = `http://127.0.0.1:${server.address().port}${suffix}`;
  try {
    const wrong = await fetch(url, { method: 'POST', headers: { 'x-curl-key': 'wrong' } });
    assert.equal(wrong.status, 404);
    const form = new FormData();
    form.append('file', new Blob([await fs.readFile(twoPage)], { type: 'application/pdf' }), 'two-pages.pdf');
    const response = await fetch(url, { method: 'POST', headers: { 'x-curl-key': ownerKey }, body: form });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /unit-test-owner-key/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await closePraserManager();
  }
});
