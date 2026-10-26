import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHiddenProcessor } from './hidden.js';
import { createProcessingQueue } from '../queue/processingQueue.js';
const ANALYSIS_INTENT = {
  source: 'analysis', method: 'extracting', task: 'default', content: 'text',
  outputFormat: 'txt', originalName: 'doc.pdf', uploadName: 'stamp__doc.pdf',
  inputFormat: 'pdf', clickedAt: '2026-09-30T00:00:00Z',
  detector: { name: 'pdf.js', textBytes: 10 },
};
async function seed(queue, dir, intent = ANALYSIS_INTENT, submitId = 'submit') {
  const input = path.join(dir, `${submitId}_in.pdf`);
  const output = path.join(dir, `${submitId}_out.txt`);
  const raw = path.join(dir, `${submitId}.txt`);
  await fs.writeFile(input, 'in');
  await fs.writeFile(output, 'parsed');
  await fs.writeFile(raw, 'parsed');
  const formId = `form-${submitId}`;
  await queue.enqueue({
    formId, userId: 'user', sessionId: 'session', clientIp: '',
    inputPath: input, file: { mimetype: 'application/pdf' }, intent,
  });
  queue.managerQueued(formId);
  queue.managerStarted(formId);
  await queue.managerFinished(formId, { file: output, output: 'txt' });
  await queue.bindSavedResult(formId, { submitId, filename: `${submitId}.txt`, bridgePath: raw });
  await queue.ready(formId, { file: output });
  return formId;
}
const dispatcherOf = (impl, configured = true) => ({ configured, dispatch: impl });
test('hidden fires only for analysis metadata — conversion uploads skip it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-hidden-'));
  const queue = createProcessingQueue();
  const calls = [];
  const processor = createHiddenProcessor({
    queue,
    dispatcher: dispatcherOf(async (meta) => {
      calls.push(meta);
      return { accepted: true };
    }),
    jobTimeoutMs: 60_000,
  });
  const conversionFormId = await seed(queue, dir, {
    ...ANALYSIS_INTENT, source: 'converter', job: 'ocr', method: 'default', task: undefined,
  }, 'conv');
  const skip = await processor({ formId: conversionFormId });
  assert.equal(skip.fired, false);
  assert.equal(skip.reason, 'not-an-analysis-job');
  assert.equal(calls.length, 0);
  assert.equal(queue.getByFormId(conversionFormId).state, 'FINISHED');
  assert.equal(queue.getByFormId(conversionFormId).jobToken, null);
  const extractingFormId = await seed(queue, dir, {
    ...ANALYSIS_INTENT, source: 'converter', job: 'extracting', method: 'default', task: undefined,
  }, 'extr');
  assert.equal((await processor({ formId: extractingFormId })).reason, 'not-an-analysis-job');
  assert.equal(calls.length, 0);
  await fs.rm(dir, { recursive: true, force: true });
});
test('hidden fires for both analysis jobs and sends metadata only', async () => {
  for (const job of ['extracting-analysis', 'conversion-analysis']) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-hidden-'));
    const queue = createProcessingQueue();
    const calls = [];
    const processor = createHiddenProcessor({
      queue,
      dispatcher: dispatcherOf(async (meta) => {
        calls.push(meta);
        return { accepted: true };
      }),
      jobTimeoutMs: 60_000,
    });
    const formId = await seed(queue, dir, { ...ANALYSIS_INTENT, job }, `submit-${job}`);
    const outcome = await processor({ formId });
    assert.equal(outcome.fired, true);
    assert.equal(calls.length, 1);
    const meta = calls[0];
    assert.deepEqual(Object.keys(meta).sort(), [
      'extension', 'filename', 'formId', 'job', 'jobToken', 'method', 'sessionId', 'submitId', 'task', 'userId',
    ]);
    assert.match(meta.jobToken, /^[0-9a-f]{32}$/);
    assert.equal(meta.filename, 'stamp__doc.pdf');
    assert.equal(meta.userId, 'user');
    assert.equal(meta.sessionId, 'session');
    // analysis labels: handling in `method`, mode in `task`.
    assert.equal(meta.method, 'extracting');
    assert.equal(meta.task, 'default');
    assert.equal(meta.job, job);
    assert.equal(queue.getByFormId(formId).state, 'ENGINE_ACCEPTED');
    assert.ok(!('fileUrl' in meta) && !('path' in meta) && !('apiKey' in meta));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('hidden also fires for analysis text metadata, not raw text alone', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-hidden-'));
  const queue = createProcessingQueue();
  const calls = [];
  const processor = createHiddenProcessor({
    queue,
    dispatcher: dispatcherOf(async (meta) => {
      calls.push(meta);
      return { accepted: true };
    }),
    jobTimeoutMs: 60_000,
  });
  const formId = await seed(queue, dir, {
    ...ANALYSIS_INTENT,
    inputFormat: 'txt',
    originalName: 'pasted.txt',
    uploadName: 'stamp__pasted.txt',
    detector: { name: 'text', textBytes: 20 },
  }, 'text-submit');
  const outcome = await processor({ formId });
  assert.equal(outcome.fired, true);
  assert.equal(calls[0].filename, 'stamp__pasted.txt');
  assert.equal(calls[0].method, 'extracting');
  assert.equal(calls[0].task, 'default');
  // no `job` under analysis -- that is the converter column's label.
  assert.equal(calls[0].job, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a blank Engine configuration skips with zero side effects', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-hidden-'));
  const queue = createProcessingQueue();
  let dispatched = 0;
  const processor = createHiddenProcessor({
    queue,
    dispatcher: dispatcherOf(async () => { dispatched += 1; return { accepted: true }; }, false),
    jobTimeoutMs: 60_000,
  });
  const formId = await seed(queue, dir);
  const outcome = await processor({ formId });
  assert.equal(outcome.fired, false);
  assert.equal(outcome.reason, 'engine-not-configured');
  assert.equal(dispatched, 0);
  const record = queue.getByFormId(formId);
  assert.equal(record.state, 'FINISHED');
  assert.equal(record.jobToken, null);
  assert.equal(record.error, null);
  await fs.rm(dir, { recursive: true, force: true });
});
test('a refused dispatch fails safely back to the locally finished job', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-hidden-'));
  const queue = createProcessingQueue();
  const processor = createHiddenProcessor({
    queue,
    dispatcher: dispatcherOf(async () => ({ accepted: false, reason: 'engine-unreachable:ECONNREFUSED' })),
    jobTimeoutMs: 60_000,
  });
  const formId = await seed(queue, dir);
  const outcome = await processor({ formId });
  assert.equal(outcome.fired, false);
  assert.equal(outcome.reason, 'dispatch-refused');
  const record = queue.getByFormId(formId);
  assert.equal(record.state, 'FINISHED');
  assert.equal(record.jobToken, null);
  assert.equal(record.error, 'Analysis service is unavailable');
  assert.ok(record.finalPath);
  await fs.rm(dir, { recursive: true, force: true });
});
test('hidden never fires twice for the same finished job', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-hidden-'));
  const queue = createProcessingQueue();
  let calls = 0;
  const processor = createHiddenProcessor({
    queue,
    dispatcher: dispatcherOf(async () => { calls += 1; return { accepted: true }; }),
    jobTimeoutMs: 60_000,
  });
  const formId = await seed(queue, dir);
  assert.equal((await processor({ formId })).fired, true);
  const again = await processor({ formId });
  assert.equal(again.fired, false);
  assert.equal(again.reason, 'state');
  assert.equal(calls, 1);
  queue.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});