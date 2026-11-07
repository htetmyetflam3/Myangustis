import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const bridge = new URL('../../../Architecture/Engine/init/bridge.js', import.meta.url).href;
const manager = new URL('../../../B.Parser/main/parser/manager.js', import.meta.url).href;
const secure = new URL('../../../Architecture/Engine/.data/secure.js', import.meta.url).href;
const cli = new URL('../../../B.Parser/extend/parse-bridge.js', import.meta.url);
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

  const parserCode = `const { Manager } = await import(${JSON.stringify(manager)}); const m = new Manager(); await m.close();`;
  const parsed = child(parserCode, state);
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.equal(parsed.stdout, '');
  assert.match(parsed.stderr, /dispatchStream[\s\S]*unknown contexts/u);
  const again = child(parserCode, state);
  assert.doesNotMatch(again.stderr, /dispatchStream/u);
});

test('--quiet persists for 24 hours and unseen guidance appears after expiry', (t) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-quiet-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const parserCode = `const { Manager } = await import(${JSON.stringify(manager)}); const m = new Manager(); await m.close();`;
  const quiet = child(parserCode, state, ['--quiet']);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.doesNotMatch(quiet.stderr, /dispatchStream/u);
  const until = Number(fs.readFileSync(path.join(state, 'quiet-until'), 'utf8'));
  assert.ok(until - Date.now() > 23.9 * 60 * 60 * 1000);
  const later = child(parserCode, state);
  assert.doesNotMatch(later.stderr, /dispatchStream/u);
  fs.writeFileSync(path.join(state, 'quiet-until'), String(Date.now() - 1));
  const expired = child(parserCode, state);
  assert.match(expired.stderr, /dispatchStream/u);
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

test('the Parser command accepts --quiet and saves the mute even on usage errors', (t) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-cli-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [cli.pathname, '--quiet'], {
    encoding: 'utf8', env: { ...process.env, MYANGUSTIS_STATE_DIR: state, MYANGUSTIS_QUIET: '' },
  });
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stderr, /unknown flag/u);
  assert.ok(Number(fs.readFileSync(path.join(state, 'quiet-until'), 'utf8')) > Date.now());
});

test('unwritable advisory state never blocks work and reports a local-only mute', () => {
  const state = path.join(os.devNull, 'not-a-directory');
  const code = `const { Manager } = await import(${JSON.stringify(manager)}); const m = new Manager(); await m.close();`;
  const first = child(code, state);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /dispatchStream/u);
  const quiet = child(code, state, ['--quiet']);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.match(quiet.stderr, /applies to this process only/u);
  assert.doesNotMatch(quiet.stderr, /dispatchStream/u);
});

test('the Python Manager bridge preserves terminal guidance on stderr', (t) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-python-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  const moduleDir = path.resolve('B.Parser/main/Python/modules');
  const snippet = [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(moduleDir)})`,
    'import node_manager',
    'try:',
    '    node_manager._request({"job": "invalid"})',
    'except node_manager.ManagerError:',
    '    pass',
  ].join('\n');
  const script = [
    'import json, os, pty, subprocess, sys',
    'master, slave = pty.openpty()',
    `p = subprocess.Popen([sys.executable, '-c', ${JSON.stringify(snippet)}], stdout=subprocess.PIPE, stderr=slave)`,
    'os.close(slave)',
    'stdout = p.stdout.read().decode("utf-8")',
    'data = bytearray()',
    'while True:',
    '    try:',
    '        chunk = os.read(master, 4096)',
    '    except OSError:',
    '        break',
    '    if not chunk: break',
    '    data.extend(chunk)',
    'os.close(master)',
    'print(json.dumps({"code": p.wait(), "stdout": stdout, "stderr": data.decode("utf-8")}))',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script], {
    encoding: 'utf8', env: { ...process.env, MYANGUSTIS_STATE_DIR: state, MYANGUSTIS_QUIET: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.code, 0);
  assert.equal(value.stdout, '');
  assert.match(value.stderr, /\[Parser\].*dispatchStream/u);
});
