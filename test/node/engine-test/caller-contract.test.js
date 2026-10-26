// External-caller contract tests — Scraper and Proofreading entering the
// engine through its SINGLE door (Engine/index.js, re-exported by the
// repo-root Bridge/path.js facade). No deep MonoSyllabism imports exist on
// either caller path; these tests pin that shape.
//
// Run: node --test Engine/test/caller-contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// .bin/node/engine-test -> three levels up (.bin/node/engine-test ->
// .bin/node -> .bin -> repo root)
const REPO = path.resolve(HERE, '..', '..', '..');

// The door under test — imported exactly as an external service would.
const engineEntry = await import('../../../Engine/index.js');
const { BindEngine, readFileContent, getDateTimeHash, hashKind } = engineEntry;
const facade = await import(path.join(REPO, 'Bridge', 'path.js'));

const SAMPLE = 'ကောင်းကင်သည် ကြည်လင်သည်။\nအင်ဂျင် စမ်းသပ်ချက်။\n';
const uniqueHash = (label) => `${getDateTimeHash()}_${label}_${process.pid}`;

test('engine entry exposes the single-boundary surface only', () => {
  assert.equal(typeof BindEngine, 'function');
  assert.equal(typeof readFileContent, 'function');
  assert.equal(typeof getDateTimeHash, 'function');
  assert.equal(typeof hashKind, 'function');
  // Root Bridge facade is a pure re-export of the same entry references.
  assert.equal(facade.BindEngine, BindEngine);
  assert.equal(facade.readFileContent, readFileContent);
});

test('SCRAPER call: BindEngine("scraper") runs path B (syllables only, memory head)', async () => {
  const hash = uniqueHash('scraper');
  const result = await BindEngine('scraper', { hash, sourceText: SAMPLE });

  assert.equal(result.hash, hash);
  assert.ok(result.syllablePath, 'path B must return a syllable output path');
  assert.equal(result.rawPosPath, null, 'scraper never builds the POS tagger');
  assert.ok(result.lineCount >= 2, 'one count per input line');

  const text = await readFileContent(result.syllablePath);
  assert.ok(text.includes('က'), 'syllable output carries Burmese surfaces');
  assert.ok(fs.existsSync(result.syllablePath));
  assert.ok(hashKind(hash), 'hash is a flat output token');
});

test('PROOFREADING call: BindEngine("proofreading") runs path A (tagger, dual writers)', async () => {
  const hash = uniqueHash('proof');
  const result = await BindEngine('proofreading', { hash, sourceText: SAMPLE });

  assert.ok(result.syllablePath, 'proofreading keeps the syllable view');
  assert.ok(result.rawPosPath, 'proofreading requires the raw POS view');
  // Path A counts fullstopHolder sentence units (a unit completes at the
  // second ။), not input lines — the two-line sample yields one unit.
  assert.ok(result.lineCount >= 1);

  const rawPos = await readFileContent(result.rawPosPath);
  assert.match(rawPos, /\{[^{}]+\}/, 'raw POS view carries tag markers');
  assert.ok(rawPos.includes('<eos>'), 'sentence end markers survive the kernel');
});

test('memory head and file head are interchangeable for proofreading', async () => {
  const tmp = path.join(os.tmpdir(), `caller-contract-${process.pid}.txt`);
  fs.writeFileSync(tmp, SAMPLE, 'utf8');
  try {
    const mem = await BindEngine('proofreading', { hash: uniqueHash('mem'), sourceText: SAMPLE });
    const file = await BindEngine('proofreading', { hash: uniqueHash('file'), inputPath: tmp });
    const a = await readFileContent(mem.rawPosPath);
    const b = await readFileContent(file.rawPosPath);
    // Same engine output modulo the hash-named file path header lines.
    assert.equal(a.replace(/\s+/g, ' ').trim(), b.replace(/\s+/g, ' ').trim());
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('proofreading bridge wrapper: both/syllable views and work-dir retarget', async () => {
  const { tagProofreading } = await import(
    path.join(REPO, 'Bridge', 'proofreading-tagger.mjs')
  );
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-work-'));
  try {
    const both = await tagProofreading({ sourceText: SAMPLE, work, views: 'both' });
    assert.ok(both.syllablePath);
    assert.ok(both.rawPosPath);
    assert.equal(typeof both.rawPos, 'string');
    assert.equal(typeof both.syllable, 'string');

    const syllableOnly = await tagProofreading({
      sourceText: SAMPLE,
      work,
      views: 'syllable',
      hash: uniqueHash('sylview'),
    });
    assert.equal(syllableOnly.rawPosPath, null);
    assert.equal(syllableOnly.rawPos, null);
    assert.ok(syllableOnly.syllablePath);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('scraper segment_bridge CLI: one facade import, U+001D stdin contract preserved', () => {
  const bin = path.join(REPO, 'Scraper', 'main', 'crawler', 'bin', 'segment_bridge.mjs');
  const source = fs.readFileSync(bin, 'utf8');
  // Static guard: the old deep-import shape must never come back.
  assert.ok(!source.includes('MonoSyllabism/'), 'no deep engine imports in the scraper bridge');
  assert.ok(source.includes('BindEngine'), 'the scraper bridge calls the single boundary');
  assert.ok(source.includes('Bridge', ) && source.includes('path.js'), 'goes through the root facade');

  const outFile = path.join(os.tmpdir(), `segment-out-${process.pid}.txt`);
  const SEP = '\u001d';
  const run = spawnSync(process.execPath, [bin, outFile], {
    input: ['ကောင်းကင် စမ်းသပ်', 'နေ့သစ် မနက်ဖြန်', ''].join(SEP),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = fs.readFileSync(outFile, 'utf8');
  const docs = out.split(SEP);
  assert.equal(docs.length, 3, 'document separator preserved end to end');
  assert.ok(docs[0].trim().length > 0);
  assert.ok(docs[1].trim().length > 0);
  assert.equal(docs[2], '', 'empty input document maps to empty output document');
  fs.rmSync(outFile, { force: true });
});
