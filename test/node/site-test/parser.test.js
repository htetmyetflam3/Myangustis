import test from 'node:test';
import assert from 'node:assert/strict';
import { createParser } from './parser.js';
import { createPdfAnalysisParser } from './pdfanalysis.js';

test('file parser keeps pdfanalysis behind analysis intent', async () => {
  const calls = [];
  const parser = createParser({
    saveOriginal: async () => '/tmp/upload.pdf',
    pdfParser: async () => {
      calls.push('normal-pdf');
      return 'normal';
    },
    analysisPdfParser: async () => {
      calls.push('analysis-pdf');
      return 'analysis';
    },
    docxParser: async () => {
      calls.push('normal-docx');
      return 'normal-docx';
    },
    analysisDocxParser: async () => {
      calls.push('analysis-docx');
      return 'analysis-docx';
    },
  });

  assert.equal(
    (await parser({ originalname: 'book.pdf' }, {}, {
      savedPath: '/tmp/upload.pdf',
      intent: { task: 'conversion', source: 'converter', job: 'extracting' },
    })).textContent,
    'normal',
  );
  assert.equal(
    (await parser({ originalname: 'book.pdf' }, {}, {
      savedPath: '/tmp/upload.pdf',
      intent: { task: 'analysis', source: 'analysis', job: 'extracting-analysis' },
    })).textContent,
    'analysis',
  );
  assert.deepEqual(calls, ['normal-pdf', 'analysis-pdf']);
});

test('pdfanalysis parser refuses non-analysis uploads before praser dispatch', async () => {
  const parser = createPdfAnalysisParser();
  await assert.rejects(
    parser.parse('/tmp/not-read.pdf', {}, {
      intent: { task: 'conversion', source: 'converter', job: 'extracting' },
    }),
    /refused a non-analysis upload/,
  );
});
