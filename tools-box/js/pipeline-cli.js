#!/usr/bin/env node

// The HTTP commands are clients of already-running servers; this file never
// imports or starts either server. Local commands use the existing front doors.
import '../../index-path.js';
import crypto from 'node:crypto';
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs, TextDecoder } from 'node:util';

const HELP = `Usage: node tools-box/js/pipeline-cli.js <parser|engine> <local|http> INPUT [options]

  parser local FILE.pdf|FILE.docx [--out FILE] [--format txt|docx|pdf]
      [--job extracting|ocr|null] [--method default|manual|null]
      [--encoding auto|unicode|zawgyi-one] [--cleanup] [--quiet]
  engine local TEXT_FILE [--flag syllable|pos] [--out FILE] [--quiet]
  engine http  TEXT_FILE --url ENGINE_BASE_URL [--out FILE] [--timeout SECONDS]
      [--allow-insecure-http]
  parser http  FILE.pdf|FILE.docx --url SITE_URL [--endpoint PATH]
      [--out FILE] [--timeout SECONDS] [--allow-insecure-http]

Examples (start the HTTP servers separately):
  node tools-box/js/pipeline-cli.js parser local book.pdf --out parsed.txt
  node tools-box/js/pipeline-cli.js engine local text.txt --flag pos --out pos.jsonl
  node tools-box/js/pipeline-cli.js engine http text.txt --url http://localhost:9000
  node tools-box/js/pipeline-cli.js parser http book.pdf --url http://localhost:3000/UchihaItachiIsMyFavChar

Local Parser runs the Parser chain door (InitInput -> parseDecoding ->
writeOutputFile) and prints its result as JSON. The output defaults to a unique
file in the Parser output directory; its path and the unknown-POS sidecar
appear in the result. --out selects a new output file.
Local Engine reads the whole UTF-8 text file because BindEngine takes a string;
it calls the Bridge without a caller hash. Syllables are text lines; POS is JSON
Lines with syllable and rawPos fields.

Engine HTTP calls the public positional syllable API using its session
handshake and prints the API JSON response (including positions); the temporary
handle is deleted afterward. --url is the host root or its /api/public path.
The API accepts at most 16 KiB of JSON and returns positional data, not finished
segmented text.

Parser HTTP calls the Site's keyed conversion-only route, not the SPA upload
lane. Its plain-text response carries no page headers. Give --url as
the complete route, or as the Site root and set CURL_ENDPOINT in the existing
environment. --endpoint appends an explicit path to --url. Set CURL_KEY in the
environment; never put the key in the URL.
HTTP output goes to stdout unless --out is supplied. The CLI never starts a
server, and it refuses to overwrite existing output files. HTTP timeout defaults
to 300 seconds. Remote plain HTTP requires --allow-insecure-http because it can
expose a key or session cookie; prefer HTTPS. --quiet mutes advisories for 24 hours.
`;

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  out: { type: 'string' },
  format: { type: 'string' },
  job: { type: 'string' },
  method: { type: 'string' },
  encoding: { type: 'string' },
  cleanup: { type: 'boolean' },
  quiet: { type: 'boolean' },
  flag: { type: 'string' },
  url: { type: 'string' },
  endpoint: { type: 'string' },
  timeout: { type: 'string' },
  'allow-insecure-http': { type: 'boolean' },
};
const ALLOWED = {
  'parser:local': ['out', 'format', 'job', 'method', 'encoding', 'cleanup', 'quiet'],
  'engine:local': ['out', 'flag', 'quiet'],
  'engine:http': ['out', 'url', 'timeout', 'allow-insecure-http'],
  'parser:http': ['out', 'url', 'endpoint', 'timeout', 'allow-insecure-http'],
};
const FORMATS = new Set(['txt', 'docx', 'pdf']);
const MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function argumentsFor(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  if (values.help) return { help: true };
  if (positionals.length !== 3) throw new Error('Expected a component, mode and input file. Use --help for usage.');
  const [component, mode, source] = positionals;
  const allowed = ALLOWED[`${component}:${mode}`];
  if (!allowed) throw new Error('Choose parser or engine, then local or http. Use --help for usage.');
  for (const name of Object.keys(values)) {
    if (!allowed.includes(name)) throw new Error(`--${name} is not supported for ${component} ${mode}.`);
  }
  if (mode === 'http' && !values.url) throw new Error('HTTP mode requires --url for an already-running server.');
  if (values.timeout !== undefined && (!/^\d+$/.test(values.timeout) ||
      Number(values.timeout) < 1 || Number(values.timeout) > 3600)) {
    throw new Error('--timeout must be a whole number of seconds from 1 to 3600.');
  }
  return { component, mode, source: path.resolve(source), options: values };
}

async function inputFile(file, type) {
  const ext = path.extname(file).toLowerCase();
  if (type === 'parser' && !Object.hasOwn(MIME, ext)) throw new Error('Parser input must be PDF or DOCX.');
  const info = await fs.stat(file).catch(error => {
    if (error.code === 'ENOENT') throw new Error('Input file was not found.');
    throw error;
  });
  if (!info.isFile()) throw new Error('Input must be a regular file.');
  return ext;
}

async function ensureNewFile(file, parserSidecar = false) {
  for (const target of parserSidecar ? [file, `${file}.unknown.txt`] : [file]) {
    try {
      await fs.lstat(target);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('Output or its Parser sidecar already exists; choose a new --out path.');
  }
}

function outputFormat(options) {
  let format = options.format?.toLowerCase();
  if (format && !FORMATS.has(format)) throw new Error('--format must be txt, docx, or pdf.');
  let output = options.out ? path.resolve(options.out) : null;
  const ext = output ? path.extname(output).toLowerCase().slice(1) : '';
  if (ext && !FORMATS.has(ext)) throw new Error('Parser output extension must be .txt, .docx, or .pdf.');
  if (format && ext && format !== ext) throw new Error('--format does not match the output extension.');
  format ||= ext || 'txt';
  if (output && !ext) output += `.${format}`;
  return { format, output };
}

async function writeChunks(chunks, output) {
  if (!output) {
    for await (const chunk of chunks) {
      if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
    }
    return;
  }
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const handle = await fs.open(output, 'wx', 0o600);
  let done = false;
  try {
    await pipeline(Readable.from(chunks), createWriteStream(output, { fd: handle.fd, autoClose: false }));
    done = true;
  } finally {
    await handle.close();
    if (!done) await fs.unlink(output).catch(() => {});
  }
  process.stderr.write(`[pipeline] Saved: ${output}\n`);
}

async function readText(file) {
  const bytes = await fs.readFile(file);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('Engine input must be valid UTF-8 text.'); }
}

function checkedUrl(raw, allowInsecure) {
  let url;
  try { url = new URL(raw); }
  catch { throw new Error('--url must be a valid HTTP or HTTPS URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('--url must not contain credentials, a query, or a fragment.');
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(host);
  if (url.protocol === 'http:' && !loopback && !allowInsecure) {
    throw new Error('Remote HTTP can expose credentials; use HTTPS or pass --allow-insecure-http.');
  }
  return url;
}

function siteUrl(options) {
  const url = checkedUrl(options.url, options['allow-insecure-http']);
  const prefix = url.pathname.replace(/\/+$/u, '');
  if (options.endpoint !== undefined || !prefix) {
    const endpoint = String(options.endpoint ?? process.env.CURL_ENDPOINT ?? '').trim();
    if (!endpoint || endpoint === '/' || /[?#\\]/u.test(endpoint) || endpoint.startsWith('//')) {
      throw new Error('Specify the Site route with --endpoint, a full --url, or CURL_ENDPOINT.');
    }
    url.pathname = `${prefix}/${endpoint.replace(/^\/+|\/+$/gu, '')}`;
  }
  return url;
}

function publicUrl(raw, allowInsecure) {
  const url = checkedUrl(raw, allowInsecure);
  const prefix = url.pathname.replace(/\/+$/u, '');
  url.pathname = prefix.endsWith('/api/public') ? prefix : `${prefix}/api/public`;
  return url;
}

function requestTimeout(options) {
  return Number(options.timeout ?? 300) * 1000;
}

async function request(url, init, what, timeout) {
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new Error(`${what} could not be reached; check --url, TLS and that the server is running.`);
  }
}

function requireSuccess(response, what) {
  if (response.ok) return;
  const hint = response.status === 404
    ? (what === 'Site conversion API' ? ' Check the configured route and key.' : ' Check the Engine URL.')
    : response.status === 413
      ? (what === 'Engine positional API' ? ' Engine public JSON is limited to 16 KiB.' : ' Check the Site upload limit.')
      : response.status >= 300 && response.status < 400
        ? ' Use the final server URL; redirects are not followed.'
        : '';
  throw new Error(`${what} failed (HTTP ${response.status}).${hint}`);
}

async function responseJson(response, what) {
  try { return await response.json(); }
  catch { throw new Error(`${what} returned invalid JSON.`); }
}

function cookieHeader(response) {
  return response.headers.getSetCookie().map(value => value.split(';', 1)[0]).filter(Boolean).join('; ');
}

async function localParser(source, options) {
  await inputFile(source, 'parser');
  const { format, output: chosenOutput } = outputFormat(options);
  const { InitInput, parseDecoding, writeOutputFile } = await import('../../B.Parser/index.js');
  const { DEFAULT_OUTPUT_DIR } = await import('../../B.Parser/_path.js');
  const output = chosenOutput || path.join(DEFAULT_OUTPUT_DIR, `${crypto.randomUUID()}.${format}`);
  await ensureNewFile(output, true);

  // The same three stages convert() wires together, kept apart here so the
  // summary can report the page count and scan the parsed pages.
  const prepared = await InitInput({ path: source }, 'owner');
  const kind = prepared.kind === 'ocr' ? 'ocr' : prepared.kind;
  if (!['pdf', 'docx', 'ocr'].includes(kind)) {
    throw new Error(`Parser cannot convert "${prepared.kind}" input.`);
  }
  const parsed = await parseDecoding({ kind, source: prepared.path, filename: path.basename(source) });
  const written = await writeOutputFile(parsed.pages, output, {
    source: parsed.filename ?? path.basename(source),
    sourceKind: parsed.kind,
    counts: parsed.counts,
  });

  // The unknown-context scan the Parser has always left beside its output:
  // every parsed page goes through the hash-free POS bridge, and only the
  // broken token contexts are written out.
  const posScan = await writeUnknownSidecar(written.file, parsed.pages);
  const summary = {
    caller: 'local',
    file: written.file,
    format: written.to,
    pages: written.pages,
    textChars: written.textChars,
    from: written.from,
    counts: written.counts ?? parsed.counts ?? {},
    posScan,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

// Run the POS scan over the parsed pages and write <output>.unknown.txt.
// The report is advisory: a scan failure never fails the conversion.
async function writeUnknownSidecar(file, pages) {
  try {
    const { PosScanner } = await import('../../B.Parser/prised/@postprocess/init.js');
    const reportFile = `${file}.unknown.txt`;
    const scanner = new PosScanner({ directory: path.dirname(file) });
    let scan;
    try {
      (pages ?? []).forEach((page, index) => {
        scanner.writePage(index + 1, [typeof page === 'string' ? page : page?.text ?? '']);
      });
      scan = await scanner.finish();
    } finally {
      await scanner.close();
    }
    const body = scan.memory.map(entry => [
      `Page ${entry.page ?? '?'}, line ${entry.line}`,
      `Context: ${entry.context}`,
      '',
    ].join('\n')).join('\n');
    await fs.writeFile(reportFile, body, { mode: 0o600 });
    return { file: reportFile, unknownCount: scan.unknownCount, contextCount: scan.contextCount };
  } catch (error) {
    process.stderr.write(`[pipeline] POS scan skipped: ${error?.message ?? 'scan failed'}\n`);
    return null;
  }
}

async function localEngine(source, options) {
  await inputFile(source, 'engine');
  const flag = options.flag ?? 'syllable';
  if (flag !== 'syllable' && flag !== 'pos') throw new Error('--flag must be syllable or pos.');
  const output = options.out ? path.resolve(options.out) : null;
  if (output) await ensureNewFile(output);
  const sourceText = await readText(source);
  const { BindEngine } = await import('../../Architecture/_index.js');
  async function* lines() {
    for await (const result of BindEngine({ sourceText, flag, log: false, quiet: options.quiet === true })) {
      yield `${flag === 'pos' ? JSON.stringify(result) : result}\n`;
    }
  }
  await writeChunks(lines(), output);
}

async function httpEngine(source, options) {
  await inputFile(source, 'engine');
  const base = publicUrl(options.url, options['allow-insecure-http']);
  const output = options.out ? path.resolve(options.out) : null;
  if (output) await ensureNewFile(output);
  // Even before JSON escaping, a larger file cannot fit the fixed public limit.
  if ((await fs.stat(source)).size > 16 * 1024) {
    throw new Error('Engine public JSON is limited to 16 KiB; use a smaller text file.');
  }
  const sourceText = await readText(source);
  const timeout = requestTimeout(options);
  const handshakeUrl = new URL(`${base.pathname}/handshake`, base);
  const handshake = await request(handshakeUrl, { method: 'POST' }, 'Engine handshake', timeout);
  requireSuccess(handshake, 'Engine handshake');
  const cookie = cookieHeader(handshake);
  if (!cookie) throw new Error('Engine handshake returned no session cookie; use HTTPS for a production server and check its proxy settings.');
  const info = await responseJson(handshake, 'Engine handshake');
  if (typeof info.handle !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(info.handle)) {
    throw new Error('Engine handshake returned an invalid handle.');
  }
  const handleUrl = new URL(`${base.pathname}/tokenizer/${info.handle}`, base);
  try {
    const response = await request(new URL(`${handleUrl.pathname}/syllable`, base), {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ sourceText }),
    }, 'Engine positional API', timeout);
    requireSuccess(response, 'Engine positional API');
    const result = await responseJson(response, 'Engine positional API');
    if (!Array.isArray(result.positions)) throw new Error('Engine positional API returned no positions array.');
    await writeChunks([`${JSON.stringify(result, null, 2)}\n`], output);
  } finally {
    await request(handleUrl, { method: 'DELETE', headers: { cookie } }, 'Engine session cleanup', Math.min(timeout, 5000)).catch(() => {});
  }
}

async function httpParser(source, options) {
  const ext = await inputFile(source, 'parser');
  const target = siteUrl(options);
  const output = options.out ? path.resolve(options.out) : null;
  if (output) await ensureNewFile(output);
  const key = String(process.env.CURL_KEY ?? '').trim();
  if (!key) throw new Error('Set CURL_KEY in the environment for the Site conversion route.');
  const form = new FormData();
  form.append('file', await openAsBlob(source, { type: MIME[ext] }), path.basename(source));
  const response = await request(target, {
    method: 'POST', headers: { 'x-curl-key': key }, body: form,
  }, 'Site conversion API', requestTimeout(options));
  requireSuccess(response, 'Site conversion API');
  if (!/^text\/plain\b/iu.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Site conversion API returned a non-text response.');
  }
  const chunks = response.body ? Readable.fromWeb(response.body) : [];
  await writeChunks(chunks, output);
}

async function main(argv) {
  const args = argumentsFor(argv);
  if (args.help) { process.stdout.write(HELP); return; }
  const functions = {
    'parser:local': localParser,
    'engine:local': localEngine,
    'engine:http': httpEngine,
    'parser:http': httpParser,
  };
  await functions[`${args.component}:${args.mode}`](args.source, args.options);
}

try { await main(process.argv.slice(2)); }
catch (error) {
  process.stderr.write(`[pipeline] ${error?.message ?? 'Request failed.'}\n`);
  process.exitCode = 1;
}
