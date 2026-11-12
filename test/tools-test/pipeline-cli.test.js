import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

// Every Parser conversion of a PDF goes through qpdf preparation. It uses an
// operator override, a system qpdf binary, or the bundled JS/WASM CLI.
const { qpdfRunner } = await import('../../B.Parser/architecture/@init/pdf/helper/decrypt.js');
const runner = qpdfRunner();
const PDF_SKIP = (() => {
  if (runner.bin === 'qpdf-wasm') return false;
  try {
    execFileSync(runner.bin, [...runner.args, '--version'], { stdio: 'pipe' });
    return false;
  } catch {
    return `no qpdf runner available (${runner.bin})`;
  }
})();
const CLI = path.join(REPO, 'tools-box/js/pipeline-cli.js');
const ENGINE_ENTRY = path.join(REPO, 'A.Engine/public/index.js');
const SITE_ENTRY = path.join(REPO, 'B.Parser/public/index.js');
const ENDPOINT = '/UchihaItachiIsMyFavChar';
const inputText = 'ကောင်းကင် စမ်းသပ်။\nမြန်မာစာ။\n';
let dir;
let pdf;
let text;
let commonEnv;
let engine;
let site;
let engineBase;
let siteBase;

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function runCli(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO, env: { ...commonEnv, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function startServer(entry, port, ready, extraEnv = {}) {
  const child = spawn(process.execPath, [entry], {
    cwd: REPO, env: { ...commonEnv, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const boot = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server startup timed out: ${path.basename(entry)}`)), 30_000);
    const data = chunk => {
      log = (log + chunk).slice(-20_000);
      if (ready.test(log)) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', data);
    child.stderr.on('data', data);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited before readiness (${code}): ${log}`)); });
  });
  try { await boot; }
  catch (error) { child.kill('SIGTERM'); throw error; }
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    timer.unref();
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

test.before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-cli-test-'));
  pdf = path.join(dir, 'source with spaces.pdf');
  text = path.join(dir, 'text input.txt');
  const doc = await PDFDocument.create();
  doc.addPage().drawText('Hello from page one');
  doc.addPage().drawText('Hello from page two');
  await fs.writeFile(pdf, await doc.save());
  await fs.writeFile(text, inputText, 'utf8');

  const frontend = process.env.PIPELINE_CLI_FRONTEND_DIR || path.join(dir, 'frontend');
  if (!process.env.PIPELINE_CLI_FRONTEND_DIR) {
    // The API tests exercise the real Site process, not the SPA build.
    await fs.mkdir(path.join(frontend, 'react'), { recursive: true });
    await fs.writeFile(path.join(frontend, 'index.html'), '<!doctype html><title>API test</title>');
    await fs.writeFile(path.join(frontend, 'react/index.html'), '<!doctype html><title>API test</title>');
  }
  const key = crypto.randomBytes(24).toString('hex');
  commonEnv = {
    ...process.env,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    COOKIE_SECRET: crypto.randomBytes(32).toString('hex'),
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    CURL_KEY: key,
    CURL_KEY_SHA256: crypto.createHash('sha256').update(key).digest('hex'),
    CURL_ENDPOINT: ENDPOINT,
    DB_FILE: path.join(dir, 'site.db'),
    PARSER_RUNTIME_DIR: path.join(dir, 'site-runtime'),
    FRONTEND_DIR: frontend,
    PRASER_REGISTER: path.join(dir, 'parser-register.log'),
    MYANGUSTIS_STATE_DIR: path.join(dir, 'state'),
    PRASER_MAX_PAGES: '1',
    EDGE_SECRET: crypto.randomBytes(32).toString('hex'),
    EDGE_GUARD_OPEN_PATHS: `/healthz,${ENDPOINT}`,
  };
  const enginePort = await unusedPort();
  engineBase = `http://127.0.0.1:${enginePort}`;
  engine = await startServer(ENGINE_ENTRY, enginePort, /\[standalone-web\] listening/);
  const sitePort = await unusedPort();
  siteBase = `http://127.0.0.1:${sitePort}`;
  site = await startServer(SITE_ENTRY, sitePort, /\[site\] listening/);
});

test.after(async () => {
  await Promise.all([stopServer(engine), stopServer(site)]);
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

test('help describes the four independent calls and never starts a server', async () => {
  const result = await runCli(['--help']);
  assert.equal(result.code, 0);
  for (const words of ['parser local', 'engine local', 'parser http', 'engine http']) {
    assert.ok(result.stdout.includes(words));
  }
});

test('the real Site and Engine entry points start independently and report healthy', async () => {
  const [engineHealth, siteHealth] = await Promise.all([
    fetch(`${engineBase}/health`).then(response => response.json()),
    fetch(`${siteBase}/healthz`).then(response => response.json()),
  ]);
  assert.equal(engineHealth.ok, true);
  assert.equal(siteHealth.ok, true);
  assert.equal(siteHealth.web, 'site');
});

test('local Parser streams a PDF to Manager without public page limits', { skip: PDF_SKIP }, async () => {
  const out = path.join(dir, 'local parsed.txt');
  const result = await runCli(['parser', 'local', pdf, '--out', out]);
  assert.equal(result.code, 0, 'local parser failed');
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.caller, 'local');
  assert.equal(summary.pages, 2);
  assert.equal(summary.file, out);
  const body = await fs.readFile(out, 'utf8');
  assert.match(body, /--- Page 1 ---/);
  assert.match(body, /Hello from page one/);
  assert.match(body, /--- Page 2 ---/);
  assert.match(body, /Hello from page two/);
  assert.equal(summary.posScan.file, `${out}.unknown.txt`);
  assert.ok((await fs.stat(summary.posScan.file)).isFile());
});

test('local Parser can produce DOCX and stream it back to text', { skip: PDF_SKIP }, async () => {
  const docx = path.join(dir, 'local.docx');
  const rendered = await runCli(['parser', 'local', pdf, '--out', docx]);
  assert.equal(rendered.code, 0, 'PDF to DOCX failed');
  assert.ok((await fs.stat(docx)).size > 0);
  const txt = path.join(dir, 'docx-parsed.txt');
  const parsed = await runCli(['parser', 'local', docx, '--out', txt]);
  assert.equal(parsed.code, 0, 'DOCX to TXT failed');
  assert.match(await fs.readFile(txt, 'utf8'), /Hello from page/);
  const pdfWithoutExtension = path.join(dir, 'rendered');
  const renderedPdf = await runCli(['parser', 'local', pdf, '--out', pdfWithoutExtension, '--format', 'pdf']);
  assert.equal(renderedPdf.code, 0, 'PDF output failed');
  const bytes = await fs.readFile(`${pdfWithoutExtension}.pdf`);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
});

test('local Engine reads text and yields hash-free Bridge syllables and POS', async () => {
  const { BindEngine } = await import('../../A.Engine/_index.js');
  const expectedSyllables = await Array.fromAsync(BindEngine({ sourceText: inputText, flag: 'syllable', log: false }));
  const syllable = await runCli(['engine', 'local', text]);
  assert.equal(syllable.code, 0, 'local syllable call failed');
  assert.equal(syllable.stdout, expectedSyllables.map(line => `${line}\n`).join(''));
  const extensionless = path.join(dir, 'plain-text');
  await fs.writeFile(extensionless, inputText);
  const noExtension = await runCli(['engine', 'local', extensionless]);
  assert.equal(noExtension.code, 0);
  assert.equal(noExtension.stdout, syllable.stdout);

  const expectedPos = await Array.fromAsync(BindEngine({ sourceText: inputText, flag: 'pos', log: false }));
  const out = path.join(dir, 'pos.jsonl');
  const pos = await runCli(['engine', 'local', text, '--flag', 'pos', '--out', out]);
  assert.equal(pos.code, 0, 'local POS call failed');
  const lines = (await fs.readFile(out, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines, expectedPos);
  assert.ok(lines.every(row => typeof row.rawPos === 'string' && typeof row.syllable === 'string'));
});

test('CLI will not overwrite the input, an existing output, or a Parser sidecar', { skip: PDF_SKIP }, async () => {
  const original = await fs.readFile(text);
  const same = await runCli(['engine', 'local', text, '--out', text]);
  assert.notEqual(same.code, 0);
  assert.deepEqual(await fs.readFile(text), original);
  const out = path.join(dir, 'occupied.txt');
  await fs.writeFile(out, 'keep existing output');
  const existing = await runCli(['parser', 'local', pdf, '--out', out]);
  assert.notEqual(existing.code, 0);
  assert.equal(await fs.readFile(out, 'utf8'), 'keep existing output');
  const outputWithSidecar = path.join(dir, 'occupied-sidecar.txt');
  await fs.writeFile(`${outputWithSidecar}.unknown.txt`, 'keep existing sidecar');
  const occupiedSidecar = await runCli(['parser', 'local', pdf, '--out', outputWithSidecar]);
  assert.notEqual(occupiedSidecar.code, 0);
  assert.equal(await fs.readFile(`${outputWithSidecar}.unknown.txt`, 'utf8'), 'keep existing sidecar');
  await assert.rejects(fs.stat(outputWithSidecar), { code: 'ENOENT' });
});

test('Engine HTTP mode calls the real public positional endpoint with a session', async () => {
  const output = await runCli(['engine', 'http', text, '--url', engineBase]);
  assert.equal(output.code, 0, 'Engine public request failed');
  const body = JSON.parse(output.stdout);
  assert.equal(typeof body.handle, 'string');
  assert.equal(body.hash.length, 72);
  assert.ok(Array.isArray(body.positions));
  assert.equal(body.positions[0].index, 'က');
  assert.ok(Array.isArray(body.positions[0].syllable));
  const file = path.join(dir, 'positions.json');
  const second = await runCli(['engine', 'http', text, '--url', `${engineBase}/api/public`, '--out', file]);
  assert.equal(second.code, 0, 'Engine public request via API root failed');
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.hash.length, 72);
  assert.deepEqual(saved.positions, body.positions);
});

test('Engine HTTP mode explains a missing Secure cookie on plain production HTTP', async () => {
  const port = await unusedPort();
  const production = await startServer(ENGINE_ENTRY, port, /\[standalone-web\] listening/, {
    NODE_ENV: 'production', TRUST_PROXY: '0',
  });
  try {
    const result = await runCli(['engine', 'http', text, '--url', `http://127.0.0.1:${port}`]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /cookie.*HTTPS/iu);
  } finally {
    await stopServer(production);
  }
});

test('Engine HTTP mode rejects oversized input without writing output', async () => {
  const huge = path.join(dir, 'too-large.txt');
  const out = path.join(dir, 'too-large-result.json');
  await fs.writeFile(huge, 'x'.repeat(17 * 1024));
  const result = await runCli(['engine', 'http', huge, '--url', engineBase, '--out', out]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /413|16\s*KiB/iu);
  await assert.rejects(fs.stat(out), { code: 'ENOENT' });
});

test('Site HTTP mode uploads to the real keyed conversion route', { skip: PDF_SKIP }, async () => {
  const output = await runCli(['parser', 'http', pdf, '--url', siteBase]);
  assert.equal(output.code, 0, 'Site PDF conversion failed');
  assert.match(output.stdout, /Hello from page one/);
  assert.match(output.stdout, /Hello from page two/);
  assert.doesNotMatch(output.stdout, /^--- Page \d+ ---$/mu);
  const file = path.join(dir, 'site.txt');
  const fullUrl = await runCli(['parser', 'http', pdf, '--url', `${siteBase}${ENDPOINT}`, '--out', file]);
  assert.equal(fullUrl.code, 0, 'Site full-endpoint conversion failed');
  assert.equal(await fs.readFile(file, 'utf8'), output.stdout);

  const docx = path.join(dir, 'site-input.docx');
  const converted = await runCli(['parser', 'local', pdf, '--out', docx]);
  assert.equal(converted.code, 0, 'Site DOCX fixture conversion failed');
  const docxResult = await runCli(['parser', 'http', docx, '--url', siteBase, '--endpoint', ENDPOINT]);
  assert.equal(docxResult.code, 0, 'Site DOCX conversion failed');
  assert.match(docxResult.stdout, /Hello from page/);
});

test('Site HTTP failure does not reveal a rejected key or create output', async () => {
  const wrong = crypto.randomBytes(24).toString('hex');
  const file = path.join(dir, 'unauthorized.txt');
  const result = await runCli(['parser', 'http', pdf, '--url', siteBase, '--out', file], { CURL_KEY: wrong });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /404/u);
  assert.equal(result.stderr.includes(wrong), false);
  assert.equal(result.stderr.includes(commonEnv.CURL_KEY), false);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  const missing = await runCli(['parser', 'http', pdf, '--url', siteBase], { CURL_KEY: ' ' });
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /CURL_KEY/u);
});

test('invalid or mismatched options fail before writing or making a request', async () => {
  const invalid = await runCli(['parser', 'local', text]);
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stderr, /PDF.*DOCX/iu);
  const mismatch = await runCli(['parser', 'local', pdf, '--out', path.join(dir, 'bad.pdf'), '--format', 'txt']);
  assert.notEqual(mismatch.code, 0);
  const remoteFlag = await runCli(['engine', 'http', text, '--url', engineBase, '--flag', 'pos']);
  assert.notEqual(remoteFlag.code, 0);
  const dummyPassword = crypto.randomBytes(10).toString('hex');
  const unsafeUrl = await runCli(['parser', 'http', pdf, '--url', `https://name:${dummyPassword}@example.com/secret`]);
  assert.notEqual(unsafeUrl.code, 0);
  assert.equal(unsafeUrl.stderr.includes(dummyPassword), false);
  const cleartext = await runCli(['parser', 'http', pdf, '--url', 'http://example.com/private']);
  assert.notEqual(cleartext.code, 0);
  assert.match(cleartext.stderr, /HTTPS|insecure HTTP/u);
  const malformed = path.join(dir, 'invalid-utf8.txt');
  await fs.writeFile(malformed, Buffer.from([0xff, 0xfe, 0xfd]));
  const invalidText = await runCli(['engine', 'local', malformed]);
  assert.notEqual(invalidText.code, 0);
  assert.match(invalidText.stderr, /UTF-8/u);
});
