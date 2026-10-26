import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import express from 'express';
import { createEngineQueueRouter } from './engineCollect.js';
import { createProcessingQueue } from '../queue/processingQueue.js';
const ENGINE_KEY = 'f'.repeat(32);
const SOURCE_TEXT = 'မြန်မာစာ parsed text here';
const RESULT_MIME = new Map([
  ['txt', 'text/plain'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['pdf', 'application/pdf'],
]);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
async function newFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-enginequeue-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }).catch(() => {}));
  const queue = createProcessingQueue();
  const app = express();
  app.use(
    '/api/internal/engine/queue',
    createEngineQueueRouter({
      queue,
      engineToSiteKey: ENGINE_KEY,
      outputDir: path.join(dir, 'final'),
      log: () => {},
    }),
  );
  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { dir, queue, server, base };
}
async function seedJob(
  fixture,
  {
    submitId = 'submit',
    ttlMs = 60_000,
    source = SOURCE_TEXT,
    outputFormat = 'txt',
    managerOutput = 'txt',
  } = {},
) {
  const { dir, queue } = fixture;
  const input = path.join(dir, `${submitId}_in.pdf`);
  const output = path.join(dir, `${submitId}_out.${managerOutput}`);
  const raw = path.join(dir, `${submitId}.txt`);
  await fs.writeFile(input, 'input');
  await fs.writeFile(output, managerOutput === 'docx' ? 'PK\u0003\u0004 staged docx' : 'parsed');
  await fs.writeFile(raw, source);
  const formId = `form-${submitId}`;
  await queue.enqueue({
    formId, userId: 'user-1', sessionId: 'session-1', clientIp: '',
    inputPath: input, file: { mimetype: 'application/pdf' },
    intent: {
      source: 'analysis', method: 'extracting', task: 'default', content: 'text',
      outputFormat, originalName: 'doc.pdf', uploadName: 'stamp__doc.pdf',
      inputFormat: 'pdf', clickedAt: '2026-09-30T00:00:00Z',
      detector: { name: 'pdf.js', textBytes: 10 },
    },
  });
  queue.managerQueued(formId);
  await queue.managerFinished(formId, { file: output, output: managerOutput });
  await queue.bindSavedResult(formId, { submitId, filename: `${submitId}.txt`, bridgePath: raw });
  await queue.ready(formId, { file: output });
  const jobToken = queue.mintAnalysisToken(formId, { ttlMs });
  return {
    formId, submitId, jobToken, raw,
    meta: {
      jobToken, formId, submitId, userId: 'user-1', sessionId: 'session-1',
      filename: 'stamp__doc.pdf', extension: outputFormat,
    },
    resultHeaders: {
      'x-api-key': ENGINE_KEY,
      'x-job-token': jobToken,
      'x-form-id': formId,
      'x-submit-id': submitId,
      'x-user-id': 'user-1',
      'x-session-id': 'session-1',
      'x-filename': encodeURIComponent(`answer.${outputFormat}`),
      'x-extension': outputFormat,
      'x-mime-type': RESULT_MIME.get(outputFormat) || 'application/octet-stream',
    },
  };
}
const post = (base, p, { headers = {}, body, json } = {}) =>
  fetch(`${base}${p}`, {
    method: 'POST',
    headers: json
      ? { 'content-type': 'application/json', ...headers }
      : { 'content-type': 'application/octet-stream', ...headers },
    body: json ? JSON.stringify(json) : body,
  });
function rawPost(socket) {
  return new Promise((resolve) => {
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
    setTimeout(() => {
      socket.destroy();
      resolve(Buffer.concat(chunks).toString('utf8'));
    }, 4000);
  });
}
function writeRaw(fixture, p, { headers = {}, body = Buffer.alloc(0) } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(fixture.server.address().port, '127.0.0.1');
    socket.on('error', () => {});
    const lines = Object.entries({ host: '127.0.0.1', connection: 'close', ...headers })
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    socket.write(`POST ${p} HTTP/1.1\r\n${lines}\r\ncontent-length: ${body.length}\r\n\r\n`);
    socket.write(body);
    rawPost(socket).then(resolve, reject);
  });
}
test('Engine queue refuses a wrong or missing key and destroys the connection', async (t) => {
  const fixture = await newFixture(t);
  const job = await seedJob(fixture);
  const res = await post(fixture.base, '/api/internal/engine/queue', {
    headers: { 'x-api-key': 'wrong' },
    json: job.meta,
  });
  assert.equal(res.status, 403);
  const body = await res.text();
  assert.ok(!body.includes(SOURCE_TEXT));
  const raw = await writeRaw(fixture, '/api/internal/engine/queue', {
    headers: { 'content-type': 'application/json', 'x-api-key': 'wrong' },
    body: Buffer.from(JSON.stringify(job.meta)),
  });
  assert.match(raw, /^HTTP\/1\.1 403/);
  assert.ok(!raw.includes(SOURCE_TEXT));
});
test('unknown job, wrong token and metadata mismatches are refused identically', async (t) => {
  const fixture = await newFixture(t);
  const job = await seedJob(fixture);
  const attempt = (meta) =>
    post(fixture.base, '/api/internal/engine/queue', {
      headers: { 'x-api-key': ENGINE_KEY },
      json: meta,
    });
  for (const broken of [
    { ...job.meta, formId: 'nope' },
    { ...job.meta, jobToken: 'e'.repeat(32) },
    { ...job.meta, userId: 'intruder' },
    { ...job.meta, sessionId: 'other-session' },
    { ...job.meta, filename: 'stamp__other.pdf' },
    { ...job.meta, extension: 'pdf' },
    { ...job.meta, filename: '../etc/passwd' },
  ]) {
    const res = await attempt(broken);
    assert.equal(res.status, 403, JSON.stringify(broken));
    const text = await res.text();
    assert.ok(!text.includes(SOURCE_TEXT));
    assert.ok(!/which field/i.test(text));
  }
  assert.equal(fixture.queue.getByFormId(job.formId).state, 'ENGINE_ACCEPTED');
});
test('a valid retrieval streams only the Site-owned source with full identity', async (t) => {
  const fixture = await newFixture(t);
  const job = await seedJob(fixture);
  const res = await post(fixture.base, '/api/internal/engine/queue', {
    headers: { 'x-api-key': ENGINE_KEY },
    json: job.meta,
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-job-token'), job.jobToken);
  assert.equal(res.headers.get('x-form-id'), job.formId);
  assert.equal(res.headers.get('x-submit-id'), job.submitId);
  assert.equal(res.headers.get('x-user-id'), 'user-1');
  assert.equal(res.headers.get('x-session-id'), 'session-1');
  assert.equal(res.headers.get('x-filename'), encodeURIComponent('stamp__doc.pdf'));
  assert.equal(res.headers.get('x-requested-extension'), 'txt');
  assert.equal(res.headers.get('x-content-bytes'), String(Buffer.byteLength(SOURCE_TEXT)));
  assert.equal(res.headers.get('x-content-sha256'), sha256(Buffer.from(SOURCE_TEXT)));
  assert.equal(Number(res.headers.get('content-length')), Buffer.byteLength(SOURCE_TEXT));
  assert.equal(await res.text(), SOURCE_TEXT);
  assert.equal(fixture.queue.getByFormId(job.formId).state, 'ANALYSING');
});
test('a second retrieval is refused even with the valid one-time token', async (t) => {
  const fixture = await newFixture(t);
  const job = await seedJob(fixture);
  const first = await post(fixture.base, '/api/internal/engine/queue', {
    headers: { 'x-api-key': ENGINE_KEY },
    json: job.meta,
  });
  assert.equal(first.status, 200);
  await first.arrayBuffer();
  const second = await post(fixture.base, '/api/internal/engine/queue', {
    headers: { 'x-api-key': ENGINE_KEY },
    json: job.meta,
  });
  assert.equal(second.status, 409);
  assert.ok(!(await second.text()).includes(SOURCE_TEXT));
});
test('an expired job token is refused with 410 and the round ends EXPIRED', async (t) => {
  const fixture = await newFixture(t);
  const job = await seedJob(fixture, { ttlMs: 30 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const res = await post(fixture.base, '/api/internal/engine/queue', {
    headers: { 'x-api-key': ENGINE_KEY },
    json: job.meta,
  });
  assert.equal(res.status, 410);
  assert.equal(fixture.queue.getByFormId(job.formId).state, 'EXPIRED');
});
test('result is accepted only for an ANALYSING job', async (t) => {
  const fixture = await newFixture(t);
  const job = await seedJob(fixture);
  const bytes = Buffer.from('converted answer');
  const res = await post(fixture.base, '/api/internal/engine/queue/result', {
    headers: {
      ...job.resultHeaders,
      'x-bytes': String(bytes.length),
      'x-sha256': sha256(bytes),
    },
    body: bytes,
  });
  assert.equal(res.status, 409);
  assert.equal(fixture.queue.getByFormId(job.formId).state, 'ENGINE_ACCEPTED');
});
async function analyse(t, fixture, seed) {
  const res = await post(fixture.base, '/api/internal/engine/queue', {
    headers: { 'x-api-key': ENGINE_KEY },
    json: seed.meta,
  });
  assert.equal(res.status, 200);
  await res.arrayBuffer();
  return res;
}
const tryResult = (fixture, seed, headers, bytes) =>
  post(fixture.base, '/api/internal/engine/queue/result', {
    headers: { ...seed.resultHeaders, ...headers },
    body: bytes,
  });
test('result payload violations are refused and the job ends FAILED', async (t) => {
  const bytes = Buffer.from('valid answer bytes');
  const good = sha256(bytes);
  const cases = [
    { name: 'wrong extension', headers: { 'x-extension': 'docx' } },
    { name: 'wrong filename extension', headers: { 'x-filename': encodeURIComponent('answer.pdf') } },
    { name: 'path traversal filename', headers: { 'x-filename': encodeURIComponent('../answer.txt') } },
    { name: 'wrong mime type', headers: { 'x-mime-type': 'application/pdf' } },
    { name: 'wrong byte count', headers: { 'x-bytes': String(bytes.length + 1), 'x-sha256': good } },
    { name: 'wrong digest', headers: { 'x-bytes': String(bytes.length), 'x-sha256': '0'.repeat(64) } },
    { name: 'malformed digest', headers: { 'x-bytes': String(bytes.length), 'x-sha256': 'short' } },
  ];
  for (const kase of cases) {
    const fixture = await newFixture(t);
    const seed = await seedJob(fixture, { submitId: `submit-${kase.name.replace(/\W+/g, '-')}` });
    await analyse(t, fixture, seed);
    const res = await tryResult(fixture, seed, kase.headers, bytes);
    assert.equal(res.status, 400, kase.name);
    const errorBody = await res.json();
    assert.ok(errorBody.error, kase.name);
    assert.ok(!/finalPath|rawPath|jobToken|x-sha256|Engine key/.test(JSON.stringify(errorBody)), `${kase.name}: no internals leaked`);
    assert.equal(fixture.queue.getByFormId(seed.formId).state, 'FAILED', kase.name);
    const finalExists = await fs
      .stat(path.join(fixture.dir, 'final'))
      .then((s) => s.isDirectory())
      .catch(() => false);
    assert.equal(finalExists, false, `${kase.name}: no partial artifact left`);
  }
});
test('a correct result is stored atomically, FINISHES the job and replay is refused', async (t) => {
  const fixture = await newFixture(t);
  const seed = await seedJob(fixture);
  await analyse(t, fixture, seed);
  const answer = Buffer.from('the requested .txt analysis artifact');
  const res = await tryResult(
    fixture,
    seed,
    { 'x-bytes': String(answer.length), 'x-sha256': sha256(answer) },
    answer,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, state: 'FINISHED' });
  const record = fixture.queue.getByFormId(seed.formId);
  assert.equal(record.state, 'FINISHED');
  assert.equal(record.jobToken, null);
  assert.equal(record.finalFilename, 'answer.txt');
  assert.equal(record.finalMimeType, 'text/plain');
  assert.equal(record.finalBytes, answer.length);
  assert.equal(record.finalSha256, sha256(answer));
  const stored = await fs.readFile(record.finalPath);
  assert.deepEqual(stored, answer);
  assert.equal(path.basename(record.finalPath), `${seed.submitId}_answer.txt`);
  const finalDir = await fs.readdir(path.join(fixture.dir, 'final'));
  assert.deepEqual(finalDir.filter((name) => name.includes('.tmp')), []);
  const replay = await tryResult(
    fixture,
    seed,
    { 'x-bytes': String(answer.length), 'x-sha256': sha256(answer) },
    answer,
  );
  assert.equal(replay.status, 403);
  const after = fixture.queue.getByFormId(seed.formId);
  assert.equal(after.state, 'FINISHED');
  assert.equal(after.finalBytes, answer.length);
});
test('text Engine result is finalized to requested analysis DOCX/PDF target', async (t) => {
  for (const target of ['docx', 'pdf']) {
    const fixture = await newFixture(t);
    const seed = await seedJob(fixture, {
      submitId: `submit-final-${target}`,
      outputFormat: target,
      managerOutput: 'docx',
    });
    await analyse(t, fixture, seed);
    const answer = Buffer.from(`checked analysis text for ${target}`);
    const res = await tryResult(
      fixture,
      seed,
      {
        'x-filename': encodeURIComponent('answer.txt'),
        'x-extension': 'txt',
        'x-mime-type': 'text/plain',
        'x-bytes': String(answer.length),
        'x-sha256': sha256(answer),
      },
      answer,
    );
    assert.equal(res.status, 200, `${target}: ${await res.clone().text()}`);
    const record = fixture.queue.getByFormId(seed.formId);
    assert.equal(record.state, 'FINISHED');
    assert.match(record.finalFilename, new RegExp(`\\.${target}$`));
    assert.equal(record.finalMimeType, RESULT_MIME.get(target));
    const stored = await fs.readFile(record.finalPath);
    if (target === 'docx') {
      assert.deepEqual(stored.subarray(0, 4), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    } else {
      assert.equal(stored.subarray(0, 5).toString('latin1'), '%PDF-');
    }
  }
});

test('two concurrent jobs cannot cross metadata or files', async (t) => {
  const fixture = await newFixture(t);
  const a = await seedJob(fixture, { submitId: 'submit-A', source: 'raw source text A' });
  const b = await seedJob(fixture, { submitId: 'submit-B', source: 'raw source text B' });
  const rawA = await fs.readFile(a.raw);
  const rawB = await fs.readFile(b.raw);
  assert.notDeepEqual(rawA, rawB);
  const cross = await post(fixture.base, '/api/internal/engine/queue', {
    headers: { 'x-api-key': ENGINE_KEY },
    json: { ...b.meta, jobToken: a.jobToken },
  });
  assert.equal(cross.status, 403);
  await analyse(t, fixture, a);
  await analyse(t, fixture, b);
  const answerB = Buffer.from('answer for B');
  const badResult = await post(fixture.base, '/api/internal/engine/queue/result', {
    headers: { ...b.resultHeaders, 'x-job-token': a.jobToken, 'x-bytes': String(answerB.length), 'x-sha256': sha256(answerB) },
    body: answerB,
  });
  assert.equal(badResult.status, 403);
  assert.equal(fixture.queue.getByFormId(a.formId).state, 'ANALYSING');
  assert.equal(fixture.queue.getByFormId(b.formId).state, 'ANALYSING');
  const answerA = Buffer.from('answer for A');
  const okA = await tryResult(fixture, a, { 'x-bytes': String(answerA.length), 'x-sha256': sha256(answerA), 'x-filename': encodeURIComponent('a-result.txt') }, answerA);
  assert.equal(okA.status, 200);
  assert.equal(fixture.queue.getByFormId(a.formId).finalFilename, 'a-result.txt');
  assert.equal(fixture.queue.getByFormId(b.formId).state, 'ANALYSING');
  await fs.rm(fixture.dir, { recursive: true, force: true });
});