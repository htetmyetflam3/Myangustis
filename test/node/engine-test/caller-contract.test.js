import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const engineEntry = await import('../../../Architecture/_index.js');
const { BindEngine } = engineEntry;
const facade = await import(path.join(REPO, 'Bridge', 'path.js'));
const SAMPLE = 'ကောင်းကင်သည် ကြည်လင်သည်။\nအင်ဂျင် စမ်းသပ်ချက်။\n';
const callerHash = () => randomBytes(36).toString('hex');

test('engine entry exposes the single-boundary surface only', () => {
  assert.equal(typeof BindEngine, 'function');
  assert.deepEqual(Object.keys(engineEntry).sort(), ['BindEngine', 'ENV_RESULT', 'JUNK_DIR', 'getEngineData', 'getLogen']);
  assert.deepEqual(Object.keys(facade), ['BindEngine']);
  assert.equal(facade.BindEngine, BindEngine);
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

test('caller-read file text and memory text are interchangeable for proofreading', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caller-contract-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const file = path.join(tmp, 'input.txt');
  fs.writeFileSync(file, SAMPLE, 'utf8');
  const { tagProofreading } = await import(path.join(REPO, 'C.Proofreading', 'index.js'));
  const memory = await tagProofreading({ sourceText: SAMPLE });
  const fromFile = await tagProofreading({ source: file });
  assert.deepEqual(fromFile, memory);
});

test('proofreading caller collects both views or only syllables without output files', async t => {
  const { tagProofreading } = await import(path.join(REPO, 'C.Proofreading', 'index.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-work-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const both = await tagProofreading({ sourceText: SAMPLE, views: 'both' });
  assert.match(both.rawPos, /\{[^{}]+\}/);
  assert.ok(both.syllable.includes('က'));
  const syllables = await tagProofreading({ sourceText: SAMPLE, views: 'syllable' });
  assert.equal(syllables.rawPos, null);
  assert.ok(syllables.syllable.includes('က'));
  assert.deepEqual(fs.readdirSync(tmp), []);
  await assert.rejects(tagProofreading({ sourceText: SAMPLE, work: tmp }), /not supported/);
});

test('scraper segment CLI keeps its U+001D stdin contract', () => {
  const bin = path.join(REPO, 'E.Scraper', 'main', 'extend', 'scraper-segmented.js');
  const source = fs.readFileSync(bin, 'utf8');
  assert.ok(!source.includes('MonoSyllabism/'));
  assert.ok(source.includes('../../_index.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'segment-out-'));
  try {
    const outFile = path.join(tmp, 'result.txt');
    const SEP = '\u001d';
    const run = spawnSync(process.execPath, [bin, outFile], {
      input: ['ကောင်းကင် စမ်းသပ်', 'နေ့သစ် မနက်ဖြန်', ''].join(SEP), encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const docs = fs.readFileSync(outFile, 'utf8').split(SEP);
    assert.equal(docs.length, 3);
    assert.ok(docs[0].trim());
    assert.ok(docs[1].trim());
    assert.equal(docs[2], '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('concurrent hashed syllable callers receive separate positional streams', async () => {
  const inputs = [SAMPLE, 'မြန်မာစာ။\n'];
  const results = await Promise.all(inputs.map(sourceText =>
    Array.fromAsync(BindEngine({ flag: 'syllable', hash: callerHash(), sourceText }))));
  assert.equal(results[0][0].index, 'က');
  assert.equal(results[1][0].index, 'မ');
});

test('invalid calls do not alter workspace or block a subsequent call', async () => {
  const { GetOutputDir, GetLogDir } = await import('../../../Architecture/Engine/_path.js');
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
