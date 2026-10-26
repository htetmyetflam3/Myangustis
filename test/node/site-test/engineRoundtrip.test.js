import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-roundtrip-'));
process.env.PARSER_RUNTIME_DIR = runtime;
const { abs, inputDirFor, OUTPUT_DIR, RAW_TXT_DIR, ORIGINAL_DIR, ensurePraserDirs } =
  await import('../file/paths.js');
ensurePraserDirs();
const { createProcessingQueue } = await import('./queue/processingQueue.js');
const { closePraserManager } = await import('../file/praser.js');
const { createIncomingRouter } = await import('./api/incoming.js');
const { createEngineQueueRouter } = await import('./api/engineCollect.js');
const { createHiddenProcessor } = await import('./api/hidden.js');
const { engineConfig, createEngineDispatcher } = await import('./generator/engine.js');
const SAMPLE_PDF = path.resolve(
  'frontend/frontend-bootstrap/public/samples/sample.pdf',
);
const SITE_TO_ENGINE_KEY = 'a'.repeat(32);
const ENGINE_TO_SITE_KEY = 'b'.repeat(32);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const timestampedName = (stem = 'sample') => {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}__${stem}.pdf`;
};
function uploadIntent(uploadName, overrides = {}) {
  return {
    v: 1,
    source: 'converter',
    originalName: 'sample.pdf',
    uploadName,
    fileFormat: 'pdf',
    conversion: 'txt',
    desired: 'txt',
    content: 'text',
    job: 'extracting',
    method: 'default',
    clickedAt: new Date().toISOString(),
    detector: {
      name: 'pdf.js', pages: 100, textPages: 100, imagePages: 0,
      myanmarChars: 1, myanmarLetters: 1, imageBytes: 0, textBytes: 1,
      confirmed: true,
    },
    ...overrides,
  };
}

/* The analysis column has no `job`: handling is `method`, mode is `task`. */
function analysisIntent(uploadName, handling = 'extracting') {
  const { job, method, ...rest } = uploadIntent(uploadName);
  return { ...rest, source: 'analysis', method: handling, task: method };
}
function createFakeTransport() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: JSON.parse(init.body),
    });
    return { ok: true, status: 202, text: async () => '' };
  };
  return { calls, fetchImpl };
}
function createRequestStub() {
  return {
    checkQuota: async () => ({ allowed: true }),
    consumeQuota: async () => ({ allowed: true, remaining: 9 }),
    createUploadSession: async ({ userId }) => `form-${userId}-${crypto.randomUUID()}`,
    validateSubmission: async () => ({ ok: true }),
    failUpload: async () => {},
    finalizeUpload: async () => {},
  };
}
async function waitFor(predicate, timeoutMs = 8000, what = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}
test('Site round: one analysis upload, hidden fires once, Engine queue round trip', async (t) => {
  const queue = createProcessingQueue({ metadataStore: createRequestStub() });
  const request = createRequestStub();
  const engineCfg = engineConfig({
    ENGINE_JOB_URL: 'https://engine.internal/job',
    SITE_TO_ENGINE_KEY,
    ENGINE_TO_SITE_KEY,
    ENGINE_ACCEPT_TIMEOUT_MS: '2000',
    ENGINE_JOB_TIMEOUT_MS: '60000',
  });
  const fake = createFakeTransport();
  const dispatcher = createEngineDispatcher({
    jobUrl: engineCfg.jobUrl,
    key: engineCfg.siteToEngineKey,
    acceptTimeoutMs: engineCfg.acceptTimeoutMs,
    log: () => {},
    fetchImpl: fake.fetchImpl,
  });
  assert.equal(dispatcher.configured, true);
  const hiddenProcessor = createHiddenProcessor({
    queue,
    dispatcher,
    jobTimeoutMs: engineCfg.jobTimeoutMs,
  });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, file, cb) => cb(null, abs(inputDirFor(file.originalname))),
      filename: (_req, file, cb) =>
        cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 32 * 1024 * 1024, files: 1, fields: 4, parts: 5, fieldSize: 64 * 1024 },
  });
  const app = express();
  app.use((req, _res, next) => {
    req.userId = 'round-user';
    req.visitorHash = 'round-session';
    next();
  });
  app.use(
    '/api/internal/engine/queue',
    createEngineQueueRouter({
      queue,
      engineToSiteKey: engineCfg.engineToSiteKey,
      outputDir: path.join(abs(OUTPUT_DIR), 'final'),
      log: () => {},
    }),
  );
  app.use(
    '/api/submit',
    createIncomingRouter({
      upload,
      db: null,
      request,
      artifactTtlMs: 15 * 60 * 1000,
      queue,
      hiddenProcessor,
    }),
  );
  app.use((error, _req, res, _next) => {
    console.error('[roundtrip]', error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    res.status(status).json({ error: error.publicMessage || error.message });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    queue.dispose();
    await closePraserManager().catch(() => {});
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(runtime, { recursive: true, force: true }).catch(() => {});
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const submit = async (intent) => {
    const source = await fs.readFile(SAMPLE_PDF);
    const form = new FormData();
    form.append('file', new File([source], intent.uploadName, { type: 'application/pdf' }));
    form.append('metadata', JSON.stringify(intent));
    return fetch(`${base}/api/submit`, { method: 'POST', body: form });
  };
  const convName = timestampedName('conversion');
  const convRes = await submit(uploadIntent(convName));
  assert.equal(convRes.status, 202);
  const convBody = await convRes.json();
  // The upload is accepted immediately (the parse continues in the
  // background), so the response carries the pollable submitId.
  assert.match(convBody.submitId, /^[0-9a-f-]{36}$/);
  const status = (submitId) =>
    fetch(`${base}/api/submit/status/${encodeURIComponent(submitId)}`).then((r) => r.json());
  const convDone = await waitFor(
    async () => {
      const s = await status(convBody.submitId);
      return !['RECEIVED', 'SITE_PROCESSING', 'SOURCE_READY', 'UNKNOWN'].includes(s.state);
    },
    30000,
    'conversion to finish',
  ).then(() => status(convBody.submitId));
  assert.equal(convDone.state, 'FINISHED');
  assert.match(convDone.downloadUrl, /^\/api\/submit\/file\//);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(fake.calls.length, 0, 'no Engine call for a conversion upload');
  const anaName = timestampedName('analysis');
  const anaRes = await submit(
    analysisIntent(anaName, 'extracting'),
  );
  assert.equal(anaRes.status, 202);
  const anaBody = await anaRes.json();
  assert.match(anaBody.submitId, /^[0-9a-f-]{36}$/);
  const anaDone = await waitFor(
    async () => {
      const s = await status(anaBody.submitId);
      // The hidden processor flips FINISHED -> ENGINE_ACCEPTED within
      // milliseconds of the site finishing, so the poller must accept any
      // "site is done" state, not just the FINISHED instant.
      return ['FINISHED', 'ENGINE_ACCEPTED', 'ANALYSING', 'FAILED', 'EXPIRED'].includes(s.state);
    },
    30000,
    'analysis upload to finish',
  ).then(() => status(anaBody.submitId));
  assert.ok(['FINISHED', 'ENGINE_ACCEPTED'].includes(anaDone.state));
  assert.equal(Object.hasOwn(anaBody, 'engine'), false);
  assert.equal(Object.hasOwn(anaBody, 'jobToken'), false);
  await waitFor(() => fake.calls.length === 1, 8000, 'hidden dispatch');
  assert.equal(fake.calls.length, 1);
  const dispatch = fake.calls[0];
  assert.equal(dispatch.url, 'https://engine.internal/job');
  assert.equal(dispatch.method, 'POST');
  assert.equal(dispatch.headers['x-api-key'], SITE_TO_ENGINE_KEY);
  assert.deepEqual(Object.keys(dispatch.body).sort(), [
    'extension', 'filename', 'formId', 'job', 'jobToken', 'method', 'sessionId', 'submitId', 'task', 'userId',
  ]);
  assert.match(dispatch.body.jobToken, /^[0-9a-f]{32}$/);
  assert.equal(dispatch.body.submitId, anaBody.submitId);
  assert.equal(dispatch.body.userId, 'round-user');
  assert.equal(dispatch.body.sessionId, 'round-session');
  assert.equal(dispatch.body.filename, anaName);
  assert.equal(dispatch.body.extension, 'txt');
  // The label is the signal: a payload carrying `task` is analysis. Nothing
  // has to be told that separately.
  // analysis: handling is `method`, mode is `task`.
  assert.equal(dispatch.body.task, 'default');
  let state = (await status(anaBody.submitId)).state;
  assert.equal(state, 'ENGINE_ACCEPTED');
  const pull = await fetch(`${base}/api/internal/engine/queue`, {
    method: 'POST',
    headers: { 'x-api-key': ENGINE_TO_SITE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(dispatch.body),
  });
  assert.equal(pull.status, 200);
  const servedBytes = Buffer.from(await pull.arrayBuffer());
  const rawOnDisk = await fs.readFile(abs(`${RAW_TXT_DIR}/${anaBody.submitId}.txt`));
  assert.deepEqual(servedBytes, rawOnDisk);
  assert.equal(pull.headers.get('x-content-sha256'), sha256(servedBytes));
  assert.equal(pull.headers.get('x-job-token'), dispatch.body.jobToken);
  assert.equal(pull.headers.get('x-user-id'), 'round-user');
  const originals = await fs.readdir(abs(ORIGINAL_DIR));
  assert.equal(originals.length, 2);
  assert.ok(
    originals.every(
      (name) =>
        abs(`${ORIGINAL_DIR}/${name}`) !== abs(`${RAW_TXT_DIR}/${anaBody.submitId}.txt`),
    ),
  );
  const answer = Buffer.from('Engine analysis answer — the .txt artifact the user asked for.');
  const result = await fetch(`${base}/api/internal/engine/queue/result`, {
    method: 'POST',
    headers: {
      'x-api-key': ENGINE_TO_SITE_KEY,
      'content-type': 'application/octet-stream',
      'x-job-token': dispatch.body.jobToken,
      'x-form-id': dispatch.body.formId,
      'x-submit-id': dispatch.body.submitId,
      'x-user-id': 'round-user',
      'x-session-id': 'round-session',
      'x-filename': encodeURIComponent('answer.txt'),
      'x-extension': 'txt',
      'x-mime-type': 'text/plain',
      'x-bytes': String(answer.length),
      'x-sha256': sha256(answer),
    },
    body: answer,
  });
  assert.equal(result.status, 200);
  assert.equal(fake.calls.length, 1);
  state = (await status(anaBody.submitId)).state;
  assert.equal(state, 'FINISHED');
  const download = await fetch(`${base}/api/submit/file/${encodeURIComponent(anaBody.submitId)}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') || '', /answer\.txt/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), answer);
  const otherApp = express();
  otherApp.use((req, _res, next) => {
    req.userId = 'round-user';
    req.visitorHash = 'OTHER-session';
    next();
  });
  otherApp.use('/api/submit', createIncomingRouter({
    upload, db: null, request, artifactTtlMs: 15 * 60 * 1000, queue, hiddenProcessor: null,
  }));
  const other = otherApp.listen(0);
  await new Promise((resolve) => other.once('listening', resolve));
  const forbidden = await fetch(
    `http://127.0.0.1:${other.address().port}/api/submit/file/${encodeURIComponent(anaBody.submitId)}`,
  );
  assert.equal(forbidden.status, 403);
  await new Promise((resolve) => other.close(resolve));
  queue.dispose();
});