import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const engineEntry = await import('../../A.Engine/_index.js');
const { BindEngine } = engineEntry;
const SAMPLE = 'ကောင်းကင်သည် ကြည်လင်သည်။\nအင်ဂျင် စမ်းသပ်ချက်။\n';
const callerHash = () => randomBytes(36).toString('hex');

test('engine entry exposes the single-boundary surface only', () => {
  assert.equal(typeof BindEngine, 'function');
  assert.deepEqual(Object.keys(engineEntry).sort(), ['BindEngine', 'ENV_RESULT', 'JUNK_DIR', 'getEngineData', 'getLogen']);
  assert.equal(fs.existsSync(path.join(REPO, 'Bridge')), false);
});

test('hash-free syllable calls stream Burmese lines without POS', async () => {
  const lines = await Array.fromAsync(BindEngine({ flag: 'syllable', sourceText: SAMPLE }));
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('က'));
  assert.ok(!lines[0].includes('{'));
});

test('hash-free POS calls stream paired syllable and raw POS views', async () => {
  const units = await Array.fromAsync(BindEngine({ flag: 'pos', sourceText: SAMPLE }));
  assert.ok(units.length >= 1);
  assert.ok(units[0].syllable.includes('က'));
  assert.match(units[0].rawPos, /\{[^{}]+\}/);
  assert.ok(units[0].rawPos.includes('<eos>'));
});

test('concurrent hashed syllable callers receive separate positional streams', async () => {
  const inputs = [SAMPLE, 'မြန်မာစာ။\n'];
  const results = await Promise.all(inputs.map(sourceText =>
    Array.fromAsync(BindEngine({ flag: 'syllable', hash: callerHash(), sourceText }))));
  assert.equal(results[0][0].index, 'က');
  assert.equal(results[1][0].index, 'မ');
});

test('invalid calls do not alter workspace or block a subsequent call', async () => {
  const { GetOutputDir, GetLogDir } = await import('../../A.Engine/architecture/_path.js');
  const previous = [GetOutputDir(), GetLogDir()];
  assert.throws(() => BindEngine({ flag: 'syllable', hash: callerHash() }), /sourceText/);
  const result = await Array.fromAsync(BindEngine({ flag: 'syllable', sourceText: SAMPLE }));
  assert.ok(result[0].includes('က'));
  assert.deepEqual([GetOutputDir(), GetLogDir()], previous);
});

for (const invalid of ['', 123, 'short']) {
  test(`BindEngine rejects invalid external hash: ${String(invalid)}`, () => {
    assert.throws(() => BindEngine({ flag: 'syllable', hash: invalid, sourceText: SAMPLE }), /72/);
  });
}

test('missing and null hashes select internal calls', async () => {
  const a = await Array.fromAsync(BindEngine({ flag: 'syllable', sourceText: SAMPLE }));
  const b = await Array.fromAsync(BindEngine({ flag: 'syllable', sourceText: SAMPLE, hash: null }));
  assert.deepEqual(a, b);
});
