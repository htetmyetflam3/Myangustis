import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SlotLimiter } from '../../../Architecture/host/job-store.js';
import { BASE_DIR } from '../../../Architecture/Engine/_path.js';
import { BindEngine, JUNK_DIR } from '../../../Architecture/_index.js';
import { consumePos } from '../../../Architecture/Engine/init/pos-guard.js';
import { readFromApi } from '../../../Architecture/Engine/MonoSyllabism/generators/input.js';
import { runSegmentor } from '../../../Architecture/Engine/MonoSyllabism/main/phoneme/lexer.js';
import { fullstopHolder } from '../../../Architecture/Engine/MonoSyllabism/generators/pos-input.js';
import { runTagger } from '../../../Architecture/Engine/MonoSyllabism/main/phoneme/phonology.js';
import { runRuleEngine } from '../../../Architecture/Engine/bridge/Ginit.js';
import { toBurmeseLine, toBurmeseLineWithPos } from '../../../Architecture/Engine/MonoSyllabism/utilities/formatter.js';

const text = 'ကောင်းကင် စမ်းသပ်။\n';
const hash = n => String(n).repeat(72);
const collect = stream => Array.fromAsync(stream);

test('bridge accepts strings, validates flags and 72-character caller hashes', () => {
  assert.throws(() => BindEngine({ sourceText: text }), /flag/);
  assert.throws(() => BindEngine({ flag: 'syllable', sourceText: 123 }), /string/);
  assert.throws(() => BindEngine({ flag: 'syllable', inputPath: 'input.txt', sourceText: text }), /paths/);
  assert.throws(() => BindEngine({ flag: 'syllable', outputPath: 'output.txt', sourceText: text }), /paths/);
  assert.throws(() => BindEngine({ flag: 'syllable', sourceText: text, hash: 'x'.repeat(71) }), /72/);
  assert.throws(() => BindEngine({ flag: 'syllable', sourceText: text, hash: 'x'.repeat(73) }), /72/);
  assert.throws(() => BindEngine({ flag: 'pos', sourceText: text, hash: '../' + 'x'.repeat(69) }), /72/);
  assert.throws(() => BindEngine({ flag: 'pos', sourceText: text, debug: 'true' }), /boolean/);
});

test('syllables stream per line and hashed callers receive positional lines', async () => {
  const input = `${text}\nမြန်မာစာ။\n`;
  const plain = BindEngine({ flag: 'syllable', sourceText: input });
  assert.equal(typeof plain[Symbol.asyncIterator], 'function');
  const lines = await collect(plain);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^ကောင်း {2}ကင်/);
  assert.equal(lines[1], '');
  const positions = await collect(BindEngine({ flag: 'syllable', sourceText: input, hash: hash(1) }));
  assert.deepEqual(positions[0], { index: 'က', syllable: ['5', '2', '3', '2'] });
  assert.equal(positions.length, 2);
});

test('POS streams paired syllable and tagged views; hashed POS guard consumes and returns its placeholder', async () => {
  const input = 'ကောင်းကင် စမ်းသပ်။\nမြန်မာစာ။ နေကောင်းလား။\n';
  const units = fullstopHolder(runSegmentor(readFromApi(input)));
  const expected = [];
  for await (const line of runRuleEngine(runTagger(units), undefined)) {
    expected.push({ syllable: toBurmeseLine(line), rawPos: toBurmeseLineWithPos(line, 'rawPos') });
  }
  assert.ok(expected.length >= 2);
  assert.deepEqual(await collect(BindEngine({ flag: 'pos', sourceText: input })), expected);
  assert.deepEqual(await collect(BindEngine({ flag: 'pos', sourceText: input, debug: false })), expected);
  assert.equal(await BindEngine({ flag: 'pos', sourceText: input, hash: hash(3) }), 'pos tagging finish');
  assert.equal(await BindEngine({ flag: 'pos', sourceText: input, hash: hash(4), debug: false }), 'pos tagging finish');
  async function* broken() { yield 'one'; throw new Error('broken stream'); }
  await assert.rejects(consumePos(broken()), /broken stream/);
});

test('normal output, including the POS guard, does not write output files', async () => {
  await collect(BindEngine({ flag: 'pos', sourceText: text }));
  const writes = [];
  const originals = {};
  for (const name of ['writeFileSync', 'appendFileSync', 'createWriteStream']) {
    originals[name] = fs[name];
    fs[name] = (...args) => { writes.push(args[0]); return originals[name](...args); };
  }
  try {
    await collect(BindEngine({ flag: 'syllable', sourceText: text }));
    await collect(BindEngine({ flag: 'syllable', sourceText: text, hash: hash(1) }));
    await collect(BindEngine({ flag: 'pos', sourceText: text }));
    await BindEngine({ flag: 'pos', sourceText: text, hash: hash(2) });
    assert.deepEqual(writes, []);
  } finally {
    Object.assign(fs, originals);
  }
});

test('web slots limit active hashed streams and are released on early return', async () => {
  const acquire = SlotLimiter.prototype.acquire;
  const release = SlotLimiter.prototype.release;
  let active = 0;
  let maxActive = 0;
  let acquired = 0;
  SlotLimiter.prototype.acquire = async function () {
    assert.equal(this.max, 2);
    await acquire.call(this);
    active += 1;
    acquired += 1;
    maxActive = Math.max(active, maxActive);
  };
  SlotLimiter.prototype.release = function () {
    active -= 1;
    return release.call(this);
  };
  const streams = [1, 2, 3].map(n => BindEngine({ flag: 'syllable', sourceText: text + text, hash: hash(n) }));
  try {
    await Promise.all([streams[0].next(), streams[1].next()]);
    assert.equal(active, 2);
    const waiting = streams[2].next();
    assert.equal(await Promise.race([waiting.then(() => 'started'), new Promise(resolve => setTimeout(() => resolve('waiting'), 20))]), 'waiting');
    await collect(BindEngine({ flag: 'syllable', sourceText: text }));
    assert.equal(acquired, 2, 'hash-free call bypasses web slots');
    await streams[0].return();
    await waiting;
    assert.equal(acquired, 3);
    assert.equal(maxActive, 2);
  } finally {
    await Promise.all(streams.map(s => s.return()));
    SlotLimiter.prototype.acquire = acquire;
    SlotLimiter.prototype.release = release;
  }
  assert.equal(active, 0);
});

test('debug without a caller hash injects an internal hash and writes the same five views', async () => {
  const result = await BindEngine({ flag: 'syllable', sourceText: text, debug: true });
  const files = [result.syllablePath, result.rawPosPath, result.idsPath, result.idMapperPath, result.idMergedPath];
  try {
    assert.ok(result.hash);
    assert.equal(result.lineCount, 1);
    for (const file of files) {
      assert.equal(path.dirname(file), path.join(JUNK_DIR, 'output'));
      assert.ok(fs.existsSync(file));
    }
  } finally {
    for (const file of files) fs.rmSync(file, { force: true });
  }
});

test('debug retains five file views under the fixed Junk output directory', async () => {
  const callerHash = randomBytes(36).toString('hex');
  assert.equal(BASE_DIR, JUNK_DIR);
  const outputDir = path.join(BASE_DIR, 'output');
  const suffixes = ['syllable', 'raw_pos', 'ids', 'id_mapper', 'id_merged'];
  const files = suffixes.map(s => path.join(outputDir, `segmented_${callerHash}_${s}.txt`));
  for (const file of files) assert.equal(fs.existsSync(file), false, `test must not overwrite ${file}`);
  try {
    const result = await BindEngine({ flag: 'pos', sourceText: text, hash: callerHash, debug: true });
    assert.equal(result.hash, callerHash);
    assert.equal(result.lineCount, 1);
    assert.deepEqual([result.syllablePath, result.rawPosPath, result.idsPath, result.idMapperPath, result.idMergedPath], files);
    for (const file of files) assert.ok(fs.existsSync(file));
    assert.match(fs.readFileSync(result.syllablePath, 'utf8'), /ကောင်း {2}ကင်/);
    assert.match(fs.readFileSync(result.rawPosPath, 'utf8'), /\{n\}/);
    const earlier = files.map(file => fs.readFileSync(file, 'utf8'));
    await assert.rejects(BindEngine({ flag: 'pos', sourceText: text, hash: callerHash, debug: true }), /already exists/);
    assert.deepEqual(files.map(file => fs.readFileSync(file, 'utf8')), earlier);
  } finally {
    for (const file of files) fs.rmSync(file, { force: true });
  }
});
