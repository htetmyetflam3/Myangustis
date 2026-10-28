import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { File } from 'node:buffer';
import express from 'express';
import multer from 'multer';
import { Document, Packer, Paragraph } from 'docx';
import { buildPayload } from '../../../F.Site/Frontend/frontend-bootstrap/js/upload.js';

const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-conversion-'));
process.env.PARSER_RUNTIME_DIR = runtime;
const { ensureUploadDir } = await import('../../../F.Site/Backend/file/paths.js');
const { createIncomingRouter } = await import('../../../F.Site/Backend/gateway/api/incoming.js');
const { createProcessingQueue } = await import('../../../F.Site/Backend/gateway/queue/processingQueue.js');
const { closePraserManager } = await import('../../../F.Site/Backend/file/praser.js');

async function until(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for document conversion');
}

test('pre-production analysis documents convert without engine; analysis text stops after raw saver', async t => {
  const finalized = [];
  const request = {
    checkQuota: async () => ({ allowed: true }),
    consumeQuota: async () => ({ allowed: true, remaining: 9 }),
    createUploadSession: async () => crypto.randomUUID(),
    validateSubmission: async () => ({ ok: true }),
    failUpload: async () => {},
    finalizeUpload: async meta => { finalized.push(meta); },
  };
  const queue = createProcessingQueue({ metadataStore: request, engineWired: () => true });
  let dispatches = 0;
  const upload = multer({ storage: multer.diskStorage({
    destination: (_req, file, cb) => ensureUploadDir(file.originalname).then(dir => cb(null, dir), cb),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
  }) });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = 'user'; req.visitorHash = 'session'; next(); });
  app.use('/api/submit', createIncomingRouter({ upload, request, queue, hiddenProcessor: async () => { dispatches++; } }));
  const listener = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    queue.dispose();
    await closePraserManager();
    await new Promise(resolve => listener.close(resolve));
    await fs.rm(runtime, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${listener.address().port}/api/submit`;
  const plan = { name: 'sample.pdf', inputFormat: 'pdf', kind: 'pdf-text', readable: true,
    detector: { name: 'pdf.js', pages: 6, textPages: 6, imagePages: 0, myanmarChars: 1,
      myanmarLetters: 1, imageBytes: 0, textBytes: 1 } };
  const intent = buildPayload({ plan, flow: 'analysis', outputFormat: 'txt', confirmed: true });
  const form = new FormData();
  const bytes = await fs.readFile('F.Site/Frontend/frontend-bootstrap/public/samples/sample.pdf');
  form.append('file', new File([bytes], intent.uploadName, { type: 'application/pdf' }));
  form.append('metadata', JSON.stringify(intent));
  const response = await fetch(base, { method: 'POST', body: form });
  assert.equal(response.status, 202);
  const doc = await response.json();
  await until(() => queue.getByFormId(doc.formId)?.state === 'FINISHED');
  const record = queue.getByFormId(doc.formId);
  assert.equal(record.source, 'analysis');
  assert.equal(record.requestMetadata.source, 'analysis');
  assert.equal(record.task, 'conversion');
  assert.equal(record.managerFormat, 'txt');
  assert.equal(record.engineRound, null);
  assert.throws(() => queue.mintAnalysisToken(doc.formId, { ttlMs: 1000 }), /not an analysis task/);
  assert.equal(dispatches, 0);
  const download = await fetch(`${base}/file/${doc.submitId}`);
  assert.equal(download.status, 200);
  assert.ok((await download.text()).length > 0);

  const docxPlan = { ...plan, name: 'sample.docx', inputFormat: 'docx', kind: 'docx-text',
    detector: { ...plan.detector, name: 'mammoth' } };
  const docxIntent = buildPayload({ plan: docxPlan, flow: 'analysis', outputFormat: 'txt', confirmed: true });
  const docxBytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('မင်္ဂလာပါ။')] }] }));
  const docxForm = new FormData();
  docxForm.append('file', new File([docxBytes], docxIntent.uploadName,
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  docxForm.append('metadata', JSON.stringify(docxIntent));
  const docxResponse = await fetch(base, { method: 'POST', body: docxForm });
  assert.equal(docxResponse.status, 202);
  const docxJob = await docxResponse.json();
  await until(() => ['FINISHED', 'FAILED'].includes(queue.getByFormId(docxJob.formId)?.state));
  const docxRecord = queue.getByFormId(docxJob.formId);
  assert.equal(docxRecord.state, 'FINISHED', docxRecord.error);
  assert.equal(docxRecord.source, 'analysis');
  assert.equal(docxRecord.task, 'conversion');
  assert.equal(docxRecord.managerFormat, 'txt');
  assert.equal((await fetch(`${base}/file/${docxJob.submitId}`)).status, 200);
  assert.equal(dispatches, 0);

  const textIntent = { v: 1, source: 'analysis', originalName: 'sample.txt',
    uploadName: '20261029T100000Z__sample.txt', fileFormat: 'txt', conversion: 'txt', desired: 'txt',
    content: 'text', method: 'false', clickedAt: '2026-10-29T10:00:00Z',
    detector: { name: 'text', pages: 0, textPages: 0, imagePages: 0, myanmarChars: 0,
      myanmarLetters: 0, imageBytes: 0, textBytes: 10, confirmed: true } };
  const text = 'မင်္ဂလာပါ။';
  const textResponse = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, metadata: textIntent }) });
  assert.equal(textResponse.status, 200);
  const saved = await textResponse.json();
  assert.equal(saved.text, text);
  assert.equal(saved.status, 'SAVED');
  assert.equal(queue.getByFormId(saved.formId), null);
  assert.equal(dispatches, 0);
  const savedMeta = finalized.find(item => item.formId === saved.formId);
  assert.equal(await fs.readFile(savedMeta.bridgePath, 'utf8'), text);
});
