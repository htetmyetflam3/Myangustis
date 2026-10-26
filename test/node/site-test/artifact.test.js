import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { storeAnalysisArtifact } from './artifact.js';
test('stores the validated Engine result atomically in Site-owned storage', async () => {
  const content = Buffer.from('grammar result');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-artifact-'));
  const result = await storeAnalysisArtifact({
    bytes: content,
    filename: '../answer.txt',
    submitId: 'submit',
    outputDir: dir,
  });
  assert.equal(result.filename, 'answer.txt');
  assert.equal(result.bytes, content.byteLength);
  assert.equal(
    result.sha256,
    crypto.createHash('sha256').update(content).digest('hex'),
  );
  assert.equal(path.dirname(result.file), dir);
  assert.equal(path.basename(result.file), 'submit_answer.txt');
  assert.deepEqual(await fs.readFile(result.file), content);
  assert.deepEqual(
    (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp')),
    [],
  );
  await fs.rm(dir, { recursive: true, force: true });
});
test('requires buffered bytes and a submitId — never accepts a URL', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linga-artifact-'));
  await assert.rejects(
    storeAnalysisArtifact({ bytes: 'not-a-buffer', filename: 'a.txt', submitId: 's', outputDir: dir }),
    /Buffer/,
  );
  await assert.rejects(
    storeAnalysisArtifact({
      bytes: Buffer.from('x'),
      filename: 'a.txt',
      submitId: '',
      outputDir: dir,
    }),
    /submitId/,
  );
  assert.equal(typeof storeAnalysisArtifact.length, 'number');
  assert.deepEqual(await fs.readdir(dir), []);
  await fs.rm(dir, { recursive: true, force: true });
});