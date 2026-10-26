import test from 'node:test';
import assert from 'node:assert/strict';
import { managerPayload } from './managerHandoff.js';

test('passes conversion output selected by the user', () => {
  assert.deepEqual(
    managerPayload({ job: 'extracting', method: 'default', outputFormat: 'pdf' }),
    { job: 'extracting', method: 'default', output: 'pdf' },
  );
});

test('analysis manager output is always staged as docx', () => {
  for (const intent of [
    { source: 'analysis', method: 'extracting', task: 'default', outputFormat: 'pdf' },
    { source: 'analysis', method: 'extracting', task: 'manual', outputFormat: 'txt' },
    { source: 'analysis', method: 'ocr', task: 'manual', outputFormat: 'pdf' },
  ]) {
    assert.deepEqual(
      managerPayload(intent),
      { job: intent.method, method: intent.task, output: 'docx' },
    );
  }
});
