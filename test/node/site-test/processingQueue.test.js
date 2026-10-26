import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createProcessingQueue, publicQueueStatus } from './processingQueue.js';
test('holds immutable input and measured manager/final file information', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-queue-'));
  const input = path.join(dir, 'upload.pdf');
  const output = path.join(dir, 'result.docx');
  const raw = path.join(dir, 'submit.txt');
  await fs.writeFile(input, 'before');
  await fs.writeFile(output, 'after manager');
  await fs.writeFile(raw, 'extracted raw text');
  const finalized = [];
  const queue = createProcessingQueue({
    metadataStore: {
      finalizeUpload(query) { finalized.push(query); },
    },
  });
  await queue.enqueue({
    formId: 'form', userId: 'user', sessionId: 'session', clientIp: '203.0.113.7',
    inputPath: input, file: { mimetype: 'application/pdf' },
    intent: { source: 'converter', job: 'extracting', method: 'default', content: 'text',
      outputFormat: 'docx', originalName: 'a.pdf', uploadName: 'stamp__a.pdf',
      inputFormat: 'pdf', clickedAt: '2026-09-30T00:00:00Z',
      detector: { name: 'pdf.js', textBytes: 99 } },
  });
  const afterEnqueue = queue.getByFormId('form');
  assert.equal(afterEnqueue.state, 'RECEIVED');
  queue.managerQueued('form');
  queue.managerStarted('form');
  assert.equal(queue.getByFormId('form').state, 'SITE_PROCESSING');
  await queue.managerFinished('form', {
    file: output, output: 'docx', lineCount: 4, textChars: 20, textBytes: 25, pages: 2,
    counts: { ZAWGYI: 1, UNICODE: 2, UNKNOWN: 0 },
  });
  assert.equal(queue.getByFormId('form').state, 'SOURCE_READY');
  await queue.bindSavedResult('form', {
    submitId: 'submit', filename: 'submit.docx', bridgePath: raw,
  });
  await queue.ready('form', { file: output, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const record = queue.getBySubmitId('submit');
  assert.equal(record.inputBytes, 6);
  assert.equal(record.clientIp, '203.0.113.7');
  assert.equal(record.requestedExtension, 'docx');
  assert.equal(record.managerBytes, 13);
  assert.equal(record.finalBytes, 13);
  assert.equal(record.rawBytes, Buffer.byteLength('extracted raw text'));
  assert.equal(record.rawSha256, crypto.createHash('sha256').update('extracted raw text').digest('hex'));
  assert.equal(record.lineCount, 4);
  assert.deepEqual(record.encodingCounts, { ZAWGYI: 1, UNICODE: 2, UNKNOWN: 0 });
  assert.equal(record.requestMetadata.method, 'default');
  assert.equal(record.requestMetadata.detector.textBytes, 99);
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].formId, 'form');
  assert.equal(finalized[0].originalName, 'a.pdf');
  assert.equal(finalized[0].bridgePath, raw);
  assert.equal(record.state, 'FINISHED');
  assert.deepEqual(publicQueueStatus(record), {
    submitId: 'submit',
    state: 'FINISHED',
    finalFilename: 'result.docx',
    finalBytes: 13,
    downloadUrl: '/api/submit/file/submit',
    error: null,
  });
  assert.match(record.managerFinishedAt, /Z$/);
  await fs.rm(dir, { recursive: true, force: true });
});
const ANALYSIS_INTENT = {
  source: 'analysis', method: 'extracting', task: 'default', content: 'text',
  outputFormat: 'txt', originalName: 'doc.pdf', uploadName: 'stamp__doc.pdf',
  inputFormat: 'pdf', clickedAt: '2026-09-30T00:00:00Z',
  detector: { name: 'pdf.js', textBytes: 10 },
};
async function seedAnalysisJob(queue, dir, { userId = 'user', sessionId = 'session', submitId = 'submit' } = {}) {
  const input = path.join(dir, `${submitId}_in.pdf`);
  const output = path.join(dir, `${submitId}_out.txt`);
  const raw = path.join(dir, `${submitId}.txt`);
  await fs.writeFile(input, 'input');
  await fs.writeFile(output, 'parsed');
  await fs.writeFile(raw, 'parsed');
  const formId = `form-${submitId}`;
  await queue.enqueue({
    formId, userId, sessionId, clientIp: '198.51.100.5',
    inputPath: input, file: { mimetype: 'application/pdf' }, intent: ANALYSIS_INTENT,
  });
  queue.managerQueued(formId);
  queue.managerStarted(formId);
  await queue.managerFinished(formId, { file: output, output: 'txt' });
  await queue.bindSavedResult(formId, { submitId, filename: `${submitId}.txt`, bridgePath: raw });
  await queue.ready(formId, { file: output });
  return { formId, raw };
}
const metaFor = (formId, submitId, token, over = {}) => ({
  jobToken: token, formId, submitId, userId: 'user', sessionId: 'session',
  filename: 'stamp__doc.pdf', extension: 'txt', ...over,
});
test('Engine round: random one-time token, atomic states, replay refused', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-queue-round-'));
  const queue = createProcessingQueue();
  const { formId } = await seedAnalysisJob(queue, dir);
  assert.equal(queue.getByFormId(formId).state, 'FINISHED');
  const tokenA = queue.mintAnalysisToken(formId, { ttlMs: 60_000 });
  assert.match(tokenA, /^[0-9a-f]{32}$/);
  assert.equal(queue.getByFormId(formId).state, 'ENGINE_ACCEPTED');
  await seedAnalysisJob(queue, dir, { submitId: 'other' });
  const other = queue.getBySubmitId('other');
  const tokenB = queue.mintAnalysisToken(other.formId, { ttlMs: 60_000 });
  assert.notEqual(tokenA, tokenB);
  assert.throws(
    () => queue.beginAnalysis(metaFor(formId, 'submit', tokenB)),
    (e) => e.kind === 'mismatch',
  );
  assert.throws(
    () => queue.beginAnalysis(metaFor(formId, 'submit', tokenA, { userId: 'intruder' })),
    (e) => e.kind === 'mismatch',
  );
  assert.throws(
    () => queue.beginAnalysis(metaFor('nope', 'nope', tokenA)),
    (e) => e.kind === 'unknown',
  );
  const job = queue.beginAnalysis(metaFor(formId, 'submit', tokenA));
  assert.equal(job.state, 'ANALYSING');
  assert.ok(job.rawPath.endsWith('submit.txt'));
  assert.equal(queue.getByFormId(formId).state, 'ANALYSING');
  assert.throws(
    () => queue.beginAnalysis(metaFor(formId, 'submit', tokenA)),
    (e) => e.kind === 'state',
  );
  assert.throws(
    () => queue.beginAnalysis(metaFor(formId, 'submit', tokenB)),
    (e) => e.kind === 'mismatch',
  );
  assert.equal(queue.getByFormId(other.formId).state, 'ENGINE_ACCEPTED');
  assert.throws(
    () => queue.beginAnalysisResult(metaFor(other.formId, 'other', tokenB)),
    (e) => e.kind === 'state',
  );
  const done = queue.completeAnalysis(formId, {
    file: job.rawPath, filename: 'answer.txt', mimeType: 'text/plain',
    bytes: 6, sha256: crypto.createHash('sha256').update('parsed').digest('hex'),
  });
  assert.equal(done.state, 'FINISHED');
  assert.equal(done.finalFilename, 'answer.txt');
  assert.equal(publicQueueStatus(done).downloadUrl, '/api/submit/file/submit');
  assert.throws(
    () => queue.beginAnalysisResult(metaFor(formId, 'submit', tokenA)),
    (e) => e.kind === 'mismatch',
  );
  await fs.rm(dir, { recursive: true, force: true });
});
test('Engine round: conversion tasks cannot enter; dispatch abort restores FINISHED', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-queue-gate-'));
  const queue = createProcessingQueue();
  const { formId } = await seedAnalysisJob(queue, dir);
  const conversionFormId = 'form-conv';
  const input = path.join(dir, 'conv_in.pdf');
  await fs.writeFile(input, 'x');
  await queue.enqueue({
    formId: conversionFormId, userId: 'user', sessionId: 'session', clientIp: '',
    inputPath: input, file: { mimetype: 'application/pdf' },
    intent: { ...ANALYSIS_INTENT, source: 'converter', method: 'default', task: undefined, job: 'extracting' },
  });
  const output = path.join(dir, 'conv_out.txt');
  await fs.writeFile(output, 'y');
  await queue.managerFinished(conversionFormId, { file: output, output: 'txt' });
  await queue.bindSavedResult(conversionFormId, { submitId: 'conv', filename: 'conv.txt', bridgePath: output });
  await queue.ready(conversionFormId, { file: output });
  assert.throws(
    () => queue.mintAnalysisToken(conversionFormId, { ttlMs: 1000 }),
    (e) => e.kind === 'state',
  );
  const token = queue.mintAnalysisToken(formId, { ttlMs: 1000 });
  assert.equal(queue.getByFormId(formId).state, 'ENGINE_ACCEPTED');
  const aborted = queue.abortAnalysis(formId, 'Analysis service is unavailable');
  assert.equal(aborted.state, 'FINISHED');
  assert.equal(aborted.jobToken, null);
  assert.equal(aborted.error, 'Analysis service is unavailable');
  assert.throws(
    () => queue.beginAnalysis(metaFor(formId, 'submit', token)),
    (e) => e.kind === 'mismatch',
  );
  await fs.rm(dir, { recursive: true, force: true });
});
test('Engine round: untouched rounds expire terminally', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-queue-exp-'));
  const queue = createProcessingQueue();
  const { formId } = await seedAnalysisJob(queue, dir);
  const token = queue.mintAnalysisToken(formId, { ttlMs: 40 });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const record = queue.getByFormId(formId);
  assert.equal(record.state, 'EXPIRED');
  assert.equal(record.error, 'Analysis job expired');
  assert.throws(
    () => queue.beginAnalysis(metaFor(formId, 'submit', token)),
    (e) => e.kind === 'expired',
  );
  queue.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});