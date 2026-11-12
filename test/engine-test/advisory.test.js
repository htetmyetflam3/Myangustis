import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const bridge = new URL('../../A.Engine/architecture/init/bridge.js', import.meta.url).href;
const parserDoor = new URL('../../B.Parser/index.js', import.meta.url).href;
const secure = new URL('../../A.Engine/architecture/.data/secure.js', import.meta.url).href;
const tty = `Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });`;

function child(code, state, args = []) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `${tty}\n${code}`, '--', ...args], {
    encoding: 'utf8', env: { ...process.env, MYANGUSTIS_STATE_DIR: state, MYANGUSTIS_QUIET: '' },
  });
}

test('Engine and Parser show first-use guidance on stderr, once across runs', (t) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-test-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const engineCode = `const { BindEngine } = await import(${JSON.stringify(bridge)}); BindEngine({flag:'pos',sourceText:'က',log:false});`;
  const first = child(engineCode, state);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, '');
  assert.match(first.stderr, /streams hash-free syllable or POS/u);
  const second = child(engineCode, state);
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stderr, /streams hash-free syllable or POS/u);

  const parserCode = `await import(${JSON.stringify(parserDoor)});`;
  const parsed = child(parserCode, state);
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.equal(parsed.stdout, '');
  assert.match(parsed.stderr, /convert\(\)[\s\S]*unknown contexts/u);
  const again = child(parserCode, state);
  assert.doesNotMatch(again.stderr, /convert\(\)/u);
});

test('--quiet persists for 24 hours and unseen guidance appears after expiry', (t) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-quiet-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const parserCode = `await import(${JSON.stringify(parserDoor)});`;
  const quiet = child(parserCode, state, ['--quiet']);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.doesNotMatch(quiet.stderr, /convert\(\)/u);
  const until = Number(fs.readFileSync(path.join(state, 'quiet-until'), 'utf8'));
  assert.ok(until - Date.now() > 23.9 * 60 * 60 * 1000);
  const later = child(parserCode, state);
  assert.doesNotMatch(later.stderr, /convert\(\)/u);
  fs.writeFileSync(path.join(state, 'quiet-until'), String(Date.now() - 1));
  const expired = child(parserCode, state);
  assert.match(expired.stderr, /convert\(\)/u);
});

test('secure data guidance directs validation to POS and does not print master data', (t) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-secure-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const code = `const data = await import(${JSON.stringify(secure)}); data.readMasterText();`;
  const result = child(code, state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /word validation[\s\S]*hash-free POS bridge/u);
});

test('unwritable advisory state never blocks work and reports a local-only mute', () => {
  const state = path.join(os.devNull, 'not-a-directory');
  const code = `await import(${JSON.stringify(parserDoor)});`;
  const first = child(code, state);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /convert\(\)/u);
  const quiet = child(code, state, ['--quiet']);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(quiet.stderr, /applies to this process only/u);
  assert.doesNotMatch(quiet.stderr, /convert\(\)/u);
});

