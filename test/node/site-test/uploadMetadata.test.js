import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readUploadMetadata,
  validateUploadedFileSignature,
} from './uploadMetadata.js';
const intent = {
  v: 1,
  source: 'converter', content: 'text', job: 'extracting', method: 'default',
  originalName: 'book.pdf', uploadName: '20260930T141233Z__book.pdf',
  clickedAt: '2026-09-30T14:12:33Z', fileFormat: 'pdf', conversion: 'txt', desired: 'txt',
  detector: { name: 'pdf.js', pages: 2, textPages: 2, imagePages: 0,
    myanmarChars: 20, myanmarLetters: 18, imageBytes: 0, textBytes: 100,
    confirmed: false },
};
const file = { originalname: intent.uploadName };
test('preserves the complete valid v1 metadata object', () => {
  const result = readUploadMetadata({ metadata: JSON.stringify(intent) }, file);
  assert.deepEqual(result, intent);
});
test('accepts a Myanmar display name with a literal space and Myanmar digits', () => {
  const unicodeIntent = {
    ...intent,
    originalName: 'တင်းဟောက် ၁-၅၀၀.pdf',
    uploadName: '20260930T141233Z__file.pdf',
  };
  const result = readUploadMetadata(
    { metadata: JSON.stringify(unicodeIntent) },
    { originalname: unicodeIntent.uploadName },
  );
  assert.equal(result.originalName, unicodeIntent.originalName);
  assert.equal(result.uploadName, '20260930T141233Z__file.pdf');
});
test('plain text requests require upload metadata too', () => {
  assert.throws(() => readUploadMetadata({}, null), /metadata JSON/);
  const textIntent = {
    ...intent,
    // already text: nothing to parse, so the handling is "false"
    job: 'false',
    method: undefined,
    fileFormat: 'txt',
    originalName: 'pasted.txt',
    uploadName: '20260930T141233Z__pasted.txt',
    detector: { ...intent.detector, name: 'text', pages: 0, textPages: 0, imagePages: 0 },
  };
  const result = readUploadMetadata({ metadata: textIntent }, null);
  assert.equal(result.inputFormat, 'txt');
  assert.equal(result.detector.name, 'text');
});
test('rejects missing metadata and filename mismatches for files', () => {
  assert.throws(() => readUploadMetadata({}, file), /require metadata/);
  assert.throws(
    () => readUploadMetadata({ metadata: JSON.stringify(intent) }, { originalname: 'other.pdf' }),
    /uploadName/,
  );
});
test('rejects demo metadata because demos never reach the server', () => {
  const demo = {
    v: 1, source: 'demo', originalName: 'sample.pdf', uploadName: 'sample.pdf',
    fileFormat: 'pdf', conversion: 'txt', desired: 'txt',
  };
  assert.throws(
    () => readUploadMetadata(
      { metadata: JSON.stringify(demo) },
      { originalname: 'sample.pdf' },
    ),
    /Unsupported metadata.source/,
  );
});
test('accepts tested large PDFs and rejects only above the parser page cap', () => {
  /* The cap is CONFIGURED, so the test has to read it the way the module
     does. Hardcoding the default made this pass under `npm test` -- which
     does not load .env -- while asserting something untrue of a deployment
     that sets PRASER_MAX_PAGES. Caught by running the suite inside the
     server, where .env is loaded. */
  const raw = process.env.PRASER_MAX_PAGES;
  const parsed = /^\d+$/.test(String(raw ?? '')) ? Number.parseInt(raw, 10) : 10_000;
  const cap = parsed >= 1 && parsed <= 500_000 ? parsed : 10_000;

  const large = {
    ...intent,
    detector: { ...intent.detector, pages: Math.min(7694, cap), textPages: 3985 },
  };
  assert.equal(
    readUploadMetadata({ metadata: JSON.stringify(large) }, file).detector.pages,
    Math.min(7694, cap),
  );
  const oversized = {
    ...large,
    detector: { ...large.detector, pages: cap + 1 },
  };
  assert.throws(
    () => readUploadMetadata({ metadata: JSON.stringify(oversized) }, file),
    new RegExp(`${cap + 1} pages.*at most ${cap} pages`),
  );
});
test('rejects contradictory routing combinations', () => {
  const ocrOnText = { ...intent, job: 'ocr', content: 'text' };
  assert.throws(() => readUploadMetadata({ metadata: JSON.stringify(ocrOnText) }, file), /OCR handling/);
  // mixed and null are one fact under two headings; neither stands alone
  const mixedNoNull = { ...intent, content: 'mixed' };
  assert.throws(() => readUploadMetadata({ metadata: JSON.stringify(mixedNoNull) }, file), /require each other/);
  const nullNotMixed = { ...intent, job: 'null' };
  assert.throws(() => readUploadMetadata({ metadata: JSON.stringify(nullNotMixed) }, file), /require each other/);
  // the other column's labels are not synonyms
  const wrongColumn = { ...intent, source: 'analysis' };
  assert.throws(() => readUploadMetadata({ metadata: JSON.stringify(wrongColumn) }, file), /converter label/);
  // the mode decides the output
  const skipToDocx = { ...intent, desired: 'docx', conversion: 'docx' };
  assert.throws(() => readUploadMetadata({ metadata: JSON.stringify(skipToDocx) }, file), /cannot produce docx/);
  const carryToTxt = { ...intent, method: 'manual' };
  assert.throws(() => readUploadMetadata({ metadata: JSON.stringify(carryToTxt) }, file), /docx or pdf output/);
});
test('rejects unsafe display filenames', () => {
  const bad = { ...intent, originalName: '../book.pdf' };
  assert.throws(
    () => readUploadMetadata({ metadata: JSON.stringify(bad) }, file),
    /safe filename/,
  );
});
test('validates PDF bytes rather than trusting extension or Content-Type', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-signature-test-'));
  const validPath = path.join(dir, 'valid.pdf');
  const fakePath = path.join(dir, 'fake.pdf');
  try {
    await fs.writeFile(validPath, '%PDF-1.4\n1 0 obj\nendobj\n%%EOF\n');
    await fs.writeFile(fakePath, 'not a pdf');
    assert.equal(
      await validateUploadedFileSignature({ path: validPath, originalname: 'book.pdf' }),
      'pdf',
    );
    await assert.rejects(
      validateUploadedFileSignature({ path: fakePath, originalname: 'book.pdf' }),
      /signature|truncated/i,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('each column carries only its own labels, and desired is the output', () => {
  const converter = (job, desired = 'txt') => readUploadMetadata({ metadata: JSON.stringify({
    ...intent, source: 'converter', job, method: desired === 'txt' ? 'default' : 'manual', desired,
    conversion: 'txt', content: job === 'ocr' ? 'image' : 'text',
  }) }, file);
  const analysis = (handling, desired = 'txt') => {
    const { job, method, ...rest } = intent;
    return readUploadMetadata({ metadata: JSON.stringify({
      ...rest, source: 'analysis', method: handling,
      task: desired === 'txt' ? 'default' : 'manual', desired, conversion: 'txt',
      content: handling === 'ocr' ? 'image' : 'text',
    }) }, file);
  };
  assert.equal(converter('extracting').source, 'converter');
  assert.equal(converter('extracting').job, 'extracting');
  assert.equal(converter('extracting', 'pdf').desired, 'pdf');
  // analysis spells the handling `method` and the mode `task`, and has no job
  assert.equal(analysis('extracting').method, 'extracting');
  assert.equal(analysis('extracting').task, 'default');
  assert.equal(analysis('extracting').job, undefined);
  assert.equal(analysis('ocr').method, 'ocr');
  assert.throws(() => converter('extracting', 'txt') && readUploadMetadata({ metadata: JSON.stringify({
    ...intent, source: 'unknown',
  }) }, file), /Unsupported metadata.source/);
});
