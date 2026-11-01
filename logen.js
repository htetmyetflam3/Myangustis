import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
let engineLogDirectory = () => path.join(root, 'Junk', 'log', 'logfromengine');
export function setEngineLogDirectory(resolveDirectory) {
  if (typeof resolveDirectory !== 'function') throw new TypeError('Expected a log directory resolver');
  engineLogDirectory = resolveDirectory;
}
const LogFile = () => engineLogDirectory();

// Shared logging core
const coreLog = (() => {
/**
 * Shared palette, report accumulation, event bus, check registry and sinks.
 * Site and engine logging sections use this same state.
 */

/* ── palette ─────────────────────────────────────────────────────────── */

const palette = {
  rst: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  ok: '\x1b[38;5;78m',
  err: '\x1b[38;5;203m',
  warn: '\x1b[38;5;215m',
  info: '\x1b[38;5;110m',
  proc: '\x1b[38;5;147m',
  skip: '\x1b[38;5;244m',
  num: '\x1b[38;5;180m',
  string: '\x1b[38;5;151m',
  comment: '\x1b[38;5;102m',
  op: '\x1b[38;5;244m',
  var: '\x1b[38;5;189m',
  method: '\x1b[38;5;80m',
  http: '\x1b[48;5;24m\x1b[38;5;231m',
  site: '\x1b[48;5;60m\x1b[38;5;231m',
  engine: '\x1b[48;5;95m\x1b[38;5;231m',
  parser: '\x1b[48;5;23m\x1b[38;5;231m',
  queue: '\x1b[48;5;54m\x1b[38;5;231m',
  system: '\x1b[48;5;238m\x1b[38;5;231m',
};

const C = palette;

/** A badge per module that exists in this repository. */
/** Badges every tree has. Each half adds its own with registerBadges(). */
const moduleBadges = {
  CHECK: { code: '\x1b[48;5;54m\x1b[38;5;231m', label: 'CHECK' },
  SYSTEM: { code: '\x1b[48;5;238m\x1b[38;5;231m', label: 'SYS' },
};

/** A half declares the modules it owns. */
function registerBadges(badges) {
  Object.assign(moduleBadges, badges);
  return moduleBadges;
}

const statusColors = {
  success: C.ok,
  fail: C.err,
  error: C.err,
  processing: C.proc,
  info: C.info,
  warn: C.warn,
  skip: C.skip,
};

const useColor = () => !process.env.NO_COLOR;
const paint = (code, text) => (useColor() ? `${code}${text}${C.rst}` : String(text));

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Stable run id, also used for artifact names. */
function getDateTimeHash(at = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`
    + `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
}

/* ── state ───────────────────────────────────────────────────────────── */

let _debug = false;
let _batch = false;
let _logFile = '';
const _reports = new Map();

/* ── report accumulation ─────────────────────────────────────────────── */

class ReportTracker {
  constructor(module) {
    this.module = module;
    this.startTime = null;
    this.endTime = null;
    this.counters = new Map();
    this.samples = new Map();
    this.lists = new Map();
    this.flags = new Map();
  }

  inc(key, n = 1) { this.counters.set(key, (this.counters.get(key) || 0) + n); }
  flag(key, value) { this.flags.set(key, value); }
  list(key, item) {
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(item);
  }

  /* Samples are capped: a broken document should cost a handful of examples,
     not one entry per occurrence. */
  sample(key, item, cap = 20) {
    if (!this.samples.has(key)) this.samples.set(key, new Set());
    const set = this.samples.get(key);
    set.add(item);
    if (set.size > cap) {
      const kept = [...set].slice(-cap);
      set.clear();
      kept.forEach((x) => set.add(x));
    }
  }
}

function tracker(module) {
  if (!_reports.has(module)) _reports.set(module, new ReportTracker(module));
  return _reports.get(module);
}

const reportInc = (module, key, n = 1) => tracker(module).inc(key, n);
const reportFlag = (module, key, value) => tracker(module).flag(key, value);
const reportList = (module, key, item) => tracker(module).list(key, item);
const reportSample = (module, key, item, cap = 20) => tracker(module).sample(key, item, cap);
const reportStart = (module) => { tracker(module).startTime = Date.now(); };
const reportEnd = (module) => { tracker(module).endTime = Date.now(); };

function reportElapsed(module) {
  const t = tracker(module);
  if (!t.startTime) return 0;
  return (t.endTime ?? Date.now()) - t.startTime;
}

/* ── emit ────────────────────────────────────────────────────────────── */

function formatConsoleLine(module, level, event, extra = '') {
  const badge = moduleBadges[module] || moduleBadges.SYSTEM;
  const colour = statusColors[level] || C.info;
  const badgeStr = useColor()
    ? `${badge.code} ${badge.label.padEnd(6)} ${C.rst}`
    : `[${badge.label}]`;
  return [
    paint(C.comment, stamp()),
    badgeStr,
    paint(`${colour}${C.bold}`, String(level).toUpperCase().padEnd(7)),
    paint(C.var, event),
    extra,
  ].filter(Boolean).join(' ');
}

/** Append to the log file. Never throws: logging must not fail the work. */
function appendFile(line) {
  if (!_logFile) return;
  try {
    fs.mkdirSync(path.dirname(_logFile), { recursive: true });
    fs.appendFileSync(_logFile, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch { /* a log that cannot be written must not break the run */ }
}

function emitLog(module, level, event, data = {}) {
  const extra = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => paint(C.comment, `${k}=`) + paint(C.num, String(v)))
    .join(' ');
  const line = formatConsoleLine(module, level, event, extra);
  // In batch mode the console keeps only failures; the file keeps everything.
  if (!_batch || level === 'fail' || level === 'error') console.log(line);
  appendFile(`[${stamp()}] [${module}] ${level} ${event} ${JSON.stringify(data)}`);
}

/* ── report ──────────────────────────────────────────────────────────── */

/**
 * The aggregated report. Console gets the summary line per module; the file
 * gets the counters, flags and samples. Call once at the end of a run.
 */
function flushReport({ toConsole = true } = {}) {
  const lines = [];
  for (const [module, t] of _reports) {
    const ms = reportElapsed(module);
    const counters = [...t.counters].map(([k, v]) => `${k}=${v}`).join(' ');
    const flags = [...t.flags].map(([k, v]) => `${k}=${v}`).join(' ');
    lines.push(`[${module}] ${ms}ms ${counters} ${flags}`.replace(/\s+/g, ' ').trim());
    for (const [key, set] of t.samples) {
      lines.push(`  ${module}.${key}: ${[...set].slice(0, 20).join(', ')}`);
    }
    for (const [key, items] of t.lists) {
      lines.push(`  ${module}.${key}: ${items.slice(0, 50).join(', ')}`);
    }
  }
  if (lines.length === 0) return '';
  const report = lines.join('\n');
  if (toConsole) console.log(report);
  appendFile(report);
  return report;
}

function resetReport() { _reports.clear(); }

/* ── events ──────────────────────────────────────────────────────────
   TWO HALVES, ON PURPOSE.

   ACTIVE  a stage emits ONE event carrying the few numbers that matter.
           Not every mini event: a parser that logged each syllable would
           drown the console and tell you nothing, which is why the
           architecture branch's per-event logging was switched off and
           never switched back on.

   PASSIVE a single listener, installed once at boot, decides what reaches
           the console and what reaches disk. Stages never format, never
           choose a sink, and never know whether anyone is listening.

   The counts a stage already computes are the ones it emits. Nothing is
   measured twice, and nothing that the queue record already holds is
   re-emitted.

   EVENT CONTRACTS
*/

const bus = new EventEmitter();

/** A stage emits; it does not format and does not choose a sink. */
function emitEvent(name, payload = {}) {
  bus.emit(name, payload);
  bus.emit('*', { event: name, ...payload });
}

const onEvent = (name, fn) => bus.on(name, fn);

let _passiveInstalled = false;
let _checksOn = false;

/* ── chain checks ─────────────────────────────────────────────────────
   THE TEST SUITE, RUN ON REAL TRAFFIC, WITHOUT LIVING IN THE MODULES.

   The suite takes two seconds and runs once. That tells you the code was
   right when you last ran it -- not that this document, right now, came
   out whole. The invariants worth checking are the same ones either way,
   so they are written once, here, as subscribers:

     a module emits what it already emits
     -> if checks are ON, logen runs the invariants against that payload
     -> pass/fail goes to the console, named
     -> if checks are OFF, nothing is attached and nothing runs

   No assertion ever enters a module. No nodemon, no second server, no
   test process. A check is a function of an event payload and the chain
   so far, which is exactly what a test is -- it just gets real input.

   ON:   installPassiveLog({ checks: true })   or LOG_CHECKS=1
   OFF:  the default. Modules still emit; no check subscriber exists.
*/

const _checks = [];
let _chain = [];
/* Every check result in the current chain, so the end-of-document line can
   report the whole document rather than only the chain-level checks. */
let _chainResults = [];

/**
 * Register an invariant.
 *   after  the event it runs after, or 'chain' for end-of-document
 *   run    (payload, chain) -> true | false | string | {ok, detail}
 *          a thrown error is a failure, reported with its message
 */
function defineCheck(name, { after, run }) {
  _checks.push({ name, after, run });
  return _checks.length;
}

function verdict(result) {
  if (result === true || result === undefined) return { ok: true, detail: '' };
  if (result === false) return { ok: false, detail: '' };
  if (typeof result === 'string') return { ok: false, detail: result };
  return { ok: Boolean(result?.ok), detail: result?.detail ?? '' };
}

function runChecks(after, payload) {
  if (!_checksOn) return [];
  const results = [];
  for (const check of _checks) {
    if (check.after !== after) continue;
    let v;
    try {
      v = verdict(check.run(payload, _chain));
    } catch (error) {
      v = { ok: false, detail: error.message };
    }
    results.push({ name: check.name, ...v });
    _chainResults.push({ name: check.name, ...v });
    const tag = v.ok ? paint(C.ok, 'PASS') : paint(C.err, 'FAIL');
    const line = `  ${tag} ${check.name}${v.detail ? ` — ${v.detail}` : ''}`;
    console.log(line);
    appendFile(`  CHECK ${v.ok ? 'pass' : 'FAIL'} ${check.name} ${v.detail}`.trimEnd());
    reportInc('CHECK', v.ok ? 'passed' : 'failed');
  }
  return results;
}

/** Every event is recorded so a chain check can look back across modules. */
function record(event, payload) {
  if (!_checksOn) return;
  _chain.push({ event, payload, at: Date.now() });
  if (_chain.length > 64) _chain.shift();
}

const chainSoFar = () => _chain.slice();
const resetChain = () => { _chain = []; _chainResults = []; };

/* The invariants. Written once; they are the chain's contract, and they
   are the same statements the ledgers already compute. */
/**
 * Shared install. Each half calls this once, then adds its own listeners.
 * The 'chain' listener lives here because the end-of-document summary is
 * the same statement on both sides.
 */
function installBase({ file = '', checks = false } = {}) {
  if (file) setLogFile(file);
  _checksOn = Boolean(checks) || /^(1|true|on|yes)$/i.test(String(process.env.LOG_CHECKS ?? ''));
  if (_passiveInstalled) return false;
  _passiveInstalled = true;

  bus.on('chain', (payload = {}) => {
    runChecks('chain', payload);
    const all = _chainResults;
    const failed = all.filter((r) => !r.ok);
    if (_checksOn) {
      emitLog('CHECK', failed.length ? 'fail' : 'success', 'chain finished', {
        ...payload,
        checks: all.length,
        passed: all.length - failed.length,
        failed: failed.length,
        ...(failed.length ? { first: failed[0].name } : {}),
      });
    }
    resetChain();
  });
  return true;
}

function resetPassiveLog() {
  bus.removeAllListeners();
  _passiveInstalled = false;
  _checksOn = false;
  _checks.length = 0;
  resetChain();
}

const checksEnabled = () => _checksOn;

/* ── setup ───────────────────────────────────────────────────────────── */

function init({ debug = false, batch = false, file = '' } = {}) {
  _debug = Boolean(debug);
  _batch = Boolean(batch);
  if (file) _logFile = path.resolve(file);
  return { debug: _debug, batch: _batch, file: _logFile };
}

const setLogFile = (filePath) => { _logFile = filePath ? path.resolve(filePath) : ''; };
const setLogBatch = (isBatch) => { _batch = Boolean(isBatch); };
const isDebug = () => _debug;

/** Plain timestamped line, for callers that just want console.log with a clock. */
function log(...args) {
  console.log(paint(C.comment, `[${stamp()}]`), ...args);
}


/* ── shared shapes ───────────────────────────────────────────────────
   Both halves report the same kinds of thing, so the readers and the
   formatters live here rather than being written twice and drifting. */

/** A from->to tally: Map, plain object, or a bare number. */
function readTally(value) {
  if (value === null || value === undefined) return { total: 0, pairs: [], chars: 0 };
  // A bare number can only be read as occurrences; its character effect is
  // unknowable, so it is reported and left out of any arithmetic.
  if (typeof value === 'number') return { total: value, pairs: [], chars: null };
  if (typeof value.total === 'function') {
    return { total: value.total(), pairs: value.pairs(), chars: value.charDelta?.() ?? null };
  }
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  const pairs = entries.map(([key, count]) => {
    const [from, to] = String(key).replaceAll('\u0000', '=>').split('=>');
    return { from, to: to ?? '?', count: Number(count) || 0 };
  }).sort((a, b) => b.count - a.count);
  const chars = pairs.reduce(
    (n, pr) => n + ([...pr.from].length - [...(pr.to ?? '')].length) * pr.count, 0,
  );
  return { total: pairs.reduce((n, pr) => n + pr.count, 0), pairs, chars };
}

/** A keyed counter: Map, plain object, or a bare number. */
function readCounts(value) {
  if (value === null || value === undefined) return { total: 0, items: [] };
  if (typeof value === 'number') return { total: value, items: [] };
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  const items = entries
    .map(([key, count]) => ({ key: String(key), count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count);
  return { total: items.reduce((n, i) => n + i.count, 0), items };
}

const showPairs = (pairs, cap) => pairs.slice(0, cap)
  .map((pr) => `${pr.from}=>${pr.to} {${pr.count}}`).join('  ');

const showCounts = (items, cap) => items.slice(0, cap)
  .map((i) => `${i.key} {${i.count}}`).join('  ');

/** start/end/fail/skip for any module name. */
const stage = (module) => ({
  start: (data = {}) => { reportStart(module); emitLog(module, 'processing', 'start', data); },
  end: (data = {}) => {
    reportEnd(module);
    emitLog(module, 'success', 'done', { ...data, ms: reportElapsed(module) });
  },
  fail: (data = {}) => emitLog(module, 'fail', 'fail', data),
  skip: (data = {}) => emitLog(module, 'skip', 'skip', data),
});

const defaultExport = {
  palette, moduleBadges, statusColors, registerBadges, paint, stamp, log,
  getDateTimeHash, init, setLogFile, setLogBatch, isDebug,
  emitLog, formatConsoleLine, appendFile, flushReport, resetReport,
  reportInc, reportFlag, reportList, reportSample, reportStart, reportEnd, reportElapsed,
  bus, emitEvent, onEvent, installBase, resetPassiveLog, checksEnabled,
  defineCheck, runChecks, record, chainSoFar, resetChain,
  readTally, readCounts, showPairs, showCounts, stage,
};

return { palette, moduleBadges, registerBadges, statusColors, paint, stamp, getDateTimeHash, reportInc, reportFlag, reportList, reportSample, reportStart, reportEnd, reportElapsed, formatConsoleLine, appendFile, emitLog, flushReport, resetReport, bus, emitEvent, onEvent, defineCheck, runChecks, record, chainSoFar, resetChain, installBase, resetPassiveLog, checksEnabled, init, setLogFile, setLogBatch, isDebug, log, readTally, readCounts, showPairs, showCounts, stage, default: defaultExport };
})();

// Site and parser logging
const siteLog = (() => {
const core = coreLog.default;
const { bus, registerBadges, installBase, emitLog, reportInc, record, runChecks, stage, appendFile, paint, palette: C } = coreLog;
/**
 * Site and parser logging: HTTP badges, stages and document-level events.
 * The engine reconciliation section shares the same event bus.
 */


/* ── the modules this tree has ───────────────────────────────────────── */

registerBadges({
  HTTP: { code: '\x1b[48;5;24m\x1b[38;5;231m', label: 'HTTP' },
  SITE: { code: '\x1b[48;5;60m\x1b[38;5;231m', label: 'SITE' },
  GATEWAY: { code: '\x1b[48;5;60m\x1b[38;5;231m', label: 'GATE' },
  QUEUE: { code: '\x1b[48;5;54m\x1b[38;5;231m', label: 'QUEUE' },
  MANAGER: { code: '\x1b[48;5;54m\x1b[38;5;231m', label: 'MGR' },
  WORKER: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'WORKER' },
  READ: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'READ' },
  TEXT: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'TEXT' },
  CODEPAGE: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'CODEPG' },
  SHAPE: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'SHAPE' },
  WRITE: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'WRITE' },
  OCR: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'OCR' },
  SCAN: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'SCAN' },
  PIPELINE: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'PIPE' },
  DB: { code: '\x1b[48;5;238m\x1b[38;5;231m', label: 'DB' },
  ENGINE: { code: '\x1b[48;5;95m\x1b[38;5;231m', label: 'ENGINE' },
});

const pipeline = stage('PIPELINE');
const read = stage('READ');
const text = stage('TEXT');
const codepage = stage('CODEPAGE');
const shape = stage('SHAPE');
const write = stage('WRITE');
const ocr = stage('OCR');
const scan = stage('SCAN');
const queue = stage('QUEUE');
const manager = stage('MANAGER');
const worker = stage('WORKER');

const readPages = (n) => reportInc('READ', 'pages', n);
const readFail = (reason) => reportInc('READ', `fail_${reason}`);
const writeWrote = (n = 1) => reportInc('WRITE', 'filesWritten', n);
const codepageChosen = (name, score) => {
  reportInc('CODEPAGE', 'chosen');
  emitLog('CODEPAGE', 'success', 'chosen', { name, score });
};
const ocrPage = (n = 1) => reportInc('OCR', 'pages', n);
const scanHit = (rule, n = 1) => reportInc('SCAN', `rule_${rule}`, n);

/* ── the site's events ───────────────────────────────────────────────── */

/**
 * Install the site's listeners. One per event the site emits -- today that
 * is 'parsed', because the queue record already holds everything else and
 * a reader can look it up.
 */
function installPassiveLog({ file = '', checks = false } = {}) {
  const first = installBase({ file, checks });
  if (!first) return false;

  bus.on('parsed', (payload) => {
    record('parsed', payload);
    runChecks('parsed', payload);
    const { file: out, originalName, chars, lines } = payload;
    emitLog('PIPELINE', 'success', 'parsed', {
      file: out ? path.basename(out) : '(unnamed)',
      original: originalName ?? '-',
      chars: chars ?? '-',
      ...(lines === null || lines === undefined ? {} : { lines }),
    });
    reportInc('PIPELINE', 'documents');
    if (Number.isFinite(chars)) reportInc('PIPELINE', 'chars', chars);
  });

  /* ── codepage scoring ────────────────────────────────────────────
     Two silent behaviours made a bad choice impossible to explain:
     a candidate with fewer than 50 Myanmar marks is scored 0 whatever it
     produced, and a page that throws during extraction is skipped without
     a word. Both are now on the line, so "everything scored zero" can be
     told apart from "the sample was too short". */
  bus.on('codepage', (ev) => {
    const {
      candidates = 0, zeroedForFewMarks = 0, pagesAsked = 0, pagesUsed = 0,
      pagesFailed = 0, marks = 0, chosen, score = 0, floor = 0, accepted, ranking = [],
    } = ev;
    const allZeroed = candidates > 0 && zeroedForFewMarks === candidates;
    emitLog('CODEPAGE', accepted ? 'success' : 'warn', 'codepage chosen', {
      chosen,
      score: Number(score).toFixed(3),
      floor,
      accepted,
      candidates,
      pages: `${pagesUsed}/${pagesAsked}${pagesFailed ? ` (${pagesFailed} failed)` : ''}`,
      marks,
      ...(allZeroed ? { why: `every candidate scored 0: best sample had ${marks} marks, 50 required` } : {}),
      ...(zeroedForFewMarks && !allZeroed ? { zeroed: zeroedForFewMarks } : {}),
    });
    appendFile(`  ranking ${ranking.join('  ')}`);
    if (!accepted) console.log(`  ${paint(C.comment, 'ranking')} ${ranking.slice(0, 8).join('  ')}`);
    record('codepage', ev);
    runChecks('codepage', ev);
    reportInc('CODEPAGE', accepted ? 'accepted' : 'belowFloor');
    if (pagesFailed) reportInc('CODEPAGE', 'probePagesFailed', pagesFailed);
  });

  /* ── the self-built layout vote ──────────────────────────────────
     buildVectorLegacyLayout has five ways to give up and all of them
     returned a bare null, so the caller -- and you -- could not tell
     which. `outcome` names it. */
  bus.on('vote', (ev) => {
    const {
      outcome, layouts = 0, codes = 0, disputed = 0,
      cropsMatched = 0, cropsAccepted = 0, decisions = 0, winnerVotes = 0,
      baseLayout, tableSize,
    } = ev;
    const built = outcome === 'built';
    const why = {
      'too-few-layouts': `only ${layouts} registered layout(s); a vote needs 2`,
      'no-dispute': `all ${codes} codes agree, so there was nothing to vote on`,
      'abstained-all-english': 'every candidate face reads as English, no Myanmar keyboard face',
      'abstained-too-few-matches': `only ${cropsAccepted}/${cropsMatched} crops matched unambiguously`,
      'zero-votes': 'no registered layout agreed with any pixel decision',
    }[outcome];

    emitLog('CODEPAGE', built ? 'success' : 'skip', `vote ${outcome}`, {
      codes,
      disputed,
      crops: `${cropsAccepted}/${cropsMatched} accepted`,
      decisions,
      ...(built ? { baseLayout, winnerVotes, tableSize } : {}),
      ...(why ? { why } : {}),
    });
    record('vote', ev);
    runChecks('vote', ev);
    reportInc('CODEPAGE', built ? 'voteBuilt' : `voteGaveUp_${outcome}`);
  });

  return true;
}

const defaultExport = {
  ...core,
  installPassiveLog,
  pipeline, read, text, codepage, shape, write, ocr, scan, queue, manager, worker,
  readPages, readFail, writeWrote, codepageChosen, ocrPage, scanHit,
};

return { ...coreLog, pipeline, read, text, codepage, shape, write, ocr, scan, queue, manager, worker, readPages, readFail, writeWrote, codepageChosen, ocrPage, scanHit, installPassiveLog, default: defaultExport };
})();

// Engine event logging
const engineLog = (() => {
const core = coreLog.default;
const { bus, registerBadges, installBase, emitLog, appendFile, paint, palette: C, reportInc, reportSample, record, runChecks, defineCheck, stage, readTally, readCounts, showPairs, showCounts } = coreLog;
/**
 * Engine ledgers, cross-module reconciliation and checks.
 * These use the same shared event bus as the site section.
 *
 * WHAT IT EXPECTS TO BE EMITTED
 *
 *   'normalize' { total, final, finalNoSpace, spaces,
 *                 braceChars, braceBlocks, collapsed, composed, swap }
 *
 *   'segment'   { characters, bypassBlocks, bypassSpaces, quit, failed }
 *
 * The caller builds `composed`, `swap` and `failed` in a buffer it already
 * owns -- a plain Map, incremented in its own loop -- and emits ONCE when
 * the function returns. logen offers no in-loop helper on purpose: a
 * logger reachable from the hot path is how the engine ended up logging
 * per syllable and then having all of it switched off.
 */


registerBadges({
  NORMALIZE: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'NORM' },
  SEGMENT: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'SEGMNT' },
  WALKER: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'WALKER' },
  TAGGER: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'TAGGER' },
  BRIDGE: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'BRIDGE' },
  BUILD: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'BUILD' },
  READER: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'READER' },
  WRITER: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'WRITER' },
});

const normalize = stage('NORMALIZE');
const segment = stage('SEGMENT');
const walker = stage('WALKER');
const tagger = stage('TAGGER');
const bridge = stage('BRIDGE');
const build = stage('BUILD');
const reader = stage('READER');
const writer = stage('WRITER');

/* The last normalize ledger, so the segment listener can reconcile the two.
   This is the cross-module check the architecture branch's own header
   promised -- "math must work across modules to catch disappearing
   tokens" -- and never performed. */
let _lastNormalize = null;

function installEngineLog({ file = '', checks = false } = {}) {
  const first = installBase({ file, checks });
  if (!first) return false;
  registerEngineChecks();

  /* ── normalize ─────────────────────────────────────────────────────
     Two ledgers, both of which must close.

       total = final + collapsed + braceChars
       final = finalNoSpace + spaces

     Braced content is BYPASSED, not dropped: it leaves the sequence
     whole, so it has to be named or the total stops balancing. */
  bus.on('normalize', (ev) => {
    const {
      total, final, finalNoSpace, spaces = 0,
      braceChars = 0, braceBlocks = 0, collapsed = 0,
      composed, swap, module = 'NORMALIZE',
    } = ev;
    const comp = readTally(composed);
    const swp = readTally(swap);

    const ledger = Number(final) + Number(collapsed) + Number(braceChars);
    const lost = Number(total) - ledger;
    const split = Number(finalNoSpace) + Number(spaces);
    const splitOff = Number(final) - split;
    const ok = lost === 0 && splitOff === 0;

    emitLog(module, ok ? 'success' : 'warn', 'normalize finished', {
      total,
      final,
      finalNoSpace,
      spaces,
      brace: `${braceBlocks} blocks / ${braceChars} chars`,
      collapsed: `${collapsed} spaces`,
      composed: `${comp.total} (${comp.chars ?? '?'} chars)`,
      swap: `${swp.total} (${swp.chars ?? '?'} chars)`,
      ...(lost ? { unaccounted: lost } : {}),
      ...(splitOff ? { splitMismatch: splitOff } : {}),
    });

    /* Disk gets every pair, always: that is the trace. The console gets
       them only when the arithmetic fails, because then they are the
       evidence rather than noise. */
    for (const [label, tally] of [['composed', comp], ['swap', swp]]) {
      if (tally.pairs.length) appendFile(`  ${label} ${showPairs(tally.pairs, Infinity)}`);
    }
    if (!ok) {
      for (const [label, tally] of [['composed', comp], ['swap    ', swp]]) {
        if (tally.pairs.length) {
          console.log(`  ${paint(C.comment, label)} ${showPairs(tally.pairs, 12)}`);
        }
      }
    }

    _lastNormalize = {
      final: Number(final),
      finalNoSpace: Number(finalNoSpace),
      spaces: Number(spaces),
      braceBlocks: Number(braceBlocks),
    };

    record('normalize', ev);
    runChecks('normalize', ev);
    reportInc(module, 'normalizePasses');
    for (const pr of comp.pairs) reportSample(module, 'composedPairs', `${pr.from}=>${pr.to}`, 40);
    for (const pr of swp.pairs) reportSample(module, 'swapPairs', `${pr.from}=>${pr.to}`, 40);
    if (lost) reportInc(module, 'normalizeUnaccounted', Math.abs(lost));
  });

  /* ── segment ───────────────────────────────────────────────────────
     THE THREE EXITS of a walk, and which is which:

       leaf step NOT final, unmatched char is a MARK -> failed
           the tree should have had this and did not, so the path is kept
       leaf step NOT final, unmatched char is a BASE -> quit
           a new syllable simply starts here
       leaf step IS final (St-F)                     -> quit
           the walk ended where it was meant to

     Both exits produce a syllable, so syllables = quit + failed. */
  bus.on('segment', (ev) => {
    const {
      characters = 0, bypassBlocks = 0, bypassSpaces = 0,
      quit = 0, failed, module = 'SEGMENT',
    } = ev;
    const bad = readCounts(failed);
    const quits = readCounts(quit).total;
    const syllables = quits + bad.total;
    const avg = syllables > 0 ? Number(characters) / syllables : 0;

    /* The walker never sees a space or a braced block, so both are named
       rather than quietly missing from what it was handed. */
    const received = Number(characters) + Number(bypassSpaces);

    const n = _lastNormalize;
    const mismatch = [];
    if (n) {
      if (received !== n.final) mismatch.push(`received ${received} != normalize.final ${n.final}`);
      if (Number(characters) !== n.finalNoSpace) mismatch.push(`walked ${characters} != finalNoSpace ${n.finalNoSpace}`);
      if (Number(bypassSpaces) !== n.spaces) mismatch.push(`bypassSpaces ${bypassSpaces} != spaces ${n.spaces}`);
      if (Number(bypassBlocks) !== n.braceBlocks) mismatch.push(`bypassBlocks ${bypassBlocks} != braceBlocks ${n.braceBlocks}`);
    }

    emitLog(module, mismatch.length || bad.total ? 'warn' : 'success', 'segment finished', {
      received,
      characters,
      bypass: `${bypassBlocks} blocks / ${bypassSpaces} spaces`,
      syllables,
      avgCharsPerSyllable: syllables > 0 ? avg.toFixed(2) : '-',
      quit: quits,
      failed: bad.total,
    });

    /* failed is per path: the same dead end hit twice is one line with a
       count, not two lines. */
    if (bad.items.length) {
      appendFile(`  failed ${showCounts(bad.items, Infinity)}`);
      for (const i of bad.items) {
        console.log(`  ${paint(C.comment, 'failed path')} ${i.key} = ${i.count}`);
      }
    }
    for (const line of mismatch) {
      console.log(`  ${paint(C.err, 'cross-module')} ${line}`);
      appendFile(`  cross-module ${line}`);
    }

    record('segment', ev);
    runChecks('segment', ev);
    reportInc(module, 'characters', Number(characters) || 0);
    reportInc(module, 'syllables', syllables);
    reportInc(module, 'quit', quits);
    reportInc(module, 'failed', bad.total);
    if (mismatch.length) reportInc(module, 'crossModuleMismatch', mismatch.length);
    for (const i of bad.items) reportSample(module, 'failedPaths', i.key, 40);
  });

  return true;
}

/** Reset the reconciliation state (tests, or between runs). */
const resetEngineChain = () => { _lastNormalize = null; };

/* ── the engine's invariants ─────────────────────────────────────────
   The same statements the ledgers compute, named so a failure says which
   contract broke instead of only that a number looked wrong. */
function registerEngineChecks() {
  defineCheck('normalize.ledger', {
    after: 'normalize',
    run: ({ total, final, collapsed = 0, braceChars = 0 }) => {
      const sum = Number(final) + Number(collapsed) + Number(braceChars);
      return sum === Number(total)
        || `total ${total} != final ${final} + collapsed ${collapsed} + brace ${braceChars} (${sum})`;
    },
  });
  defineCheck('normalize.split', {
    after: 'normalize',
    run: ({ final, finalNoSpace, spaces = 0 }) => {
      const sum = Number(finalNoSpace) + Number(spaces);
      return sum === Number(final) || `final ${final} != noSpace ${finalNoSpace} + spaces ${spaces}`;
    },
  });
  defineCheck('segment.received', {
    after: 'segment',
    run: ({ characters = 0, bypassSpaces = 0 }, chain) => {
      const norm = [...chain].reverse().find((e) => e.event === 'normalize');
      if (!norm) return { ok: true, detail: 'no normalize in this chain' };
      const received = Number(characters) + Number(bypassSpaces);
      return received === Number(norm.payload.final)
        || `segmentor received ${received}, normalize produced ${norm.payload.final}`;
    },
  });
  defineCheck('segment.bypassMatchesBrace', {
    after: 'segment',
    run: ({ bypassBlocks = 0 }, chain) => {
      const norm = [...chain].reverse().find((e) => e.event === 'normalize');
      if (!norm) return { ok: true, detail: 'no normalize in this chain' };
      return Number(bypassBlocks) === Number(norm.payload.braceBlocks ?? 0)
        || `bypass ${bypassBlocks} blocks != ${norm.payload.braceBlocks} braces`;
    },
  });
  defineCheck('segment.syllableSum', {
    after: 'segment',
    run: ({ quit = 0, failed }) => {
      const bad = readCounts(failed);
      return readCounts(quit).total + bad.total > 0 || 'no syllables produced';
    },
  });
}

const defaultExport = {
  ...core,
  installEngineLog, resetEngineChain,
  normalize, segment, walker, tagger, bridge, build, reader, writer,
};

return { ...coreLog, normalize, segment, walker, tagger, bridge, build, reader, writer, installEngineLog, resetEngineChain, default: defaultExport };
})();

// Engine run logging
const legacyLog = (() => {
/**
 * Report-First Logger — aggregated detail → file, minimal → console
 *
 * Console:  module badge + status + elapsed time only
 * File:     per-module aggregated report with actionable counters + tree paths
 *
 * No per-event noise. No system-state spam. Only counts that matter.
 * Math must work across modules to catch disappearing tokens.
 *
 * Cross-module validation chain:
 *   segmentor.emittedSyllables  ==  bridge.syllableCount
 *   bridge.syllableCount        ==  bridge.tildeCount / 2     (id mode only)
 *   tagger.tokenReceived        ==  bridge.syllableCount
 *   tagger.wordCount            ==  posWalker.wordCount
 */


// ── State ──
let _debug = false;
let _batchMode = false;
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
let _currentFile = '';
let _initialized = false;

// ── Timing ──
const _timers = new Map();

// ── Report Accumulators ──
const _reports = new Map();

class ReportTracker {
  constructor(module) {
    this.module = module;
    this.startTime = null;
    this.endTime = null;
    this.counters = new Map();
    this.lists = new Map();
    this.samples = new Map();
    this.flags = new Map();

    // Tree path tracking (syllable tree)
    this.treePaths = new Map();

    // POS tree tracking
    this.posTreeGlobal = new Map();
    this.posTreeByRoot = new Map();
    this.posRootsHit = new Set();
    this.posMaxSteps = new Map();
  }

  inc(key, n = 1) {
    this.counters.set(key, (this.counters.get(key) || 0) + n);
  }
  addList(key, item) {
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(item);
  }
  addSample(key, item, cap = 20) {
    if (!this.samples.has(key)) this.samples.set(key, new Set());
    const s = this.samples.get(key);
    s.add(item);
    if (s.size > cap) {
      const arr = [...s];
      s.clear();
      arr.slice(-cap).forEach(x => s.add(x));
    }
  }
  setFlag(key, val) {
    this.flags.set(key, val);
  }

  treePath(root, step, type) {
    if (!this.treePaths.has(root)) this.treePaths.set(root, new Map());
    const rootMap = this.treePaths.get(root);
    if (!rootMap.has(step)) rootMap.set(step, { total: 0, empty: 0 });
    const st = rootMap.get(step);
    if (type === 'hit') st.total++;
    else if (type === 'empty') st.empty++;
  }

  posTreeGlobalStep(step, type) {
    if (!this.posTreeGlobal.has(step)) this.posTreeGlobal.set(step, { total: 0, empty: 0 });
    const d = this.posTreeGlobal.get(step);
    if (type === 'hit') d.total++;
    else if (type === 'empty') d.empty++;
  }
  posTreeEmptyRoot(root, step) {
    this.posRootsHit.add(root);
    this.posTreeByRoot.set(root, (this.posTreeByRoot.get(root) || 0) + 1);
    const curMax = this.posMaxSteps.get(root) || 0;
    if (step > curMax) this.posMaxSteps.set(root, step);
  }
  posTreeHitRoot(root, step) {
    this.posRootsHit.add(root);
    const curMax = this.posMaxSteps.get(root) || 0;
    if (step > curMax) this.posMaxSteps.set(root, step);
  }

  render() {
    const lines = [];
    const pad = (k) => k.toString().padStart(6, ' ');

    lines.push(`══ ${this.module} REPORT ══`);
    if (this.startTime && this.endTime) {
      const ms = this.endTime - this.startTime;
      lines.push(`elapsed: ${ms}ms`);
    }

    if (this.counters.size) {
      lines.push('');
      lines.push('── counts ──');
      for (const [k, v] of this.counters) {
        lines.push(`  ${k}: ${pad(v)}`);
      }
    }

    if (this.flags.size) {
      lines.push('');
      lines.push('── flags ──');
      for (const [k, v] of this.flags) {
        lines.push(`  ${k}: ${v}`);
      }
    }

    if (this.treePaths.size) {
      lines.push('');
      lines.push('══ TREE PATHS ══');
      const roots = [...this.treePaths.keys()].sort();
      for (const root of roots) {
        const stepMap = this.treePaths.get(root);
        const steps = [...stepMap.keys()].sort((a, b) => a - b);
        lines.push(`── root ${root} ──`);
        for (const step of steps) {
          const { total, empty } = stepMap.get(step);
          const emptyStr = empty > 0 ? `  empty=${empty}` : '';
          lines.push(`  step${step}: total=${total}${emptyStr}`);
        }
      }
    }

    if (this.posRootsHit.size) {
      lines.push('');
      lines.push('══ POS TREE PATHS ══');
      lines.push('── summary ──');
      lines.push(`  totalRootsHit: ${this.posRootsHit.size}`);

      const maxStepDist = new Map();
      // eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
      for (const [root, maxStep] of this.posMaxSteps) {
        maxStepDist.set(maxStep, (maxStepDist.get(maxStep) || 0) + 1);
      }
      const maxSteps = [...maxStepDist.keys()].sort((a, b) => b - a);
      const highestStep = maxSteps[0] || 0;
      lines.push(`  highestStep: ${highestStep}`);
      for (const step of maxSteps) {
        lines.push(`  pathsReachingStep${step}: ${maxStepDist.get(step)}`);
      }

      if (this.posTreeGlobal.size) {
        lines.push('');
        lines.push('── empty-id steps (global) ──');
        const steps = [...this.posTreeGlobal.keys()].sort((a, b) => a - b);
        for (const step of steps) {
          const { total, empty } = this.posTreeGlobal.get(step);
          lines.push(`  step${step}: total=${total}  empty=${empty}`);
        }
      }

      if (this.posTreeByRoot.size) {
        lines.push('');
        lines.push('── empty-id by root (top 20) ──');
        const sorted = [...this.posTreeByRoot.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20);
        for (const [root, count] of sorted) {
          const maxStep = this.posMaxSteps.get(root) || 0;
          lines.push(`  ${root} (maxStep=${maxStep}): ${count}`);
        }
      }
    }

    if (this.samples.size) {
      for (const [k, s] of this.samples) {
        const arr = [...s];
        lines.push('');
        lines.push(`── ${k} (unique=${arr.length}) ──`);
        for (const item of arr) {
          lines.push(`  ${item}`);
        }
      }
    }

    if (this.lists.size) {
      for (const [k, arr] of this.lists) {
        lines.push('');
        lines.push(`── ${k} (total=${arr.length}) ──`);
        for (const item of arr) {
          lines.push(`  ${item}`);
        }
      }
    }

    lines.push('');
    return lines.join('\n');
  }
}

function getReport(module) {
  if (!_reports.has(module)) {
    _reports.set(module, new ReportTracker(module));
  }
  return _reports.get(module);
}

// ── File Routing ──
const FILE_MAP = {
  PIPELINE:   'pipeline.log',
  BUILD:      'build.log',
  READER:     'reader.log',
  NORMALIZE:  'normalize.log',
  SEGMENT:    'segment.log',
  BRIDGE:     'bridge.log',
  TAGGER:     'tagger.log',
  WALKER:     'walker.log',
  WALKER_POS: 'walker_pos.log',
  WRITER:     'writer.log',
  READABLE:   'readable.log',
  COMPOSER:   'composer.log',
  DECOMPOSER: 'decomposer.log',
  SYSTEM:     'system.log',
};

// ── Console Color Codes ──
const C = {
  rst:  '\x1b[0m',
  bold: '\x1b[1m',
  dim:  '\x1b[2m',
  keyword:  '\x1b[38;5;203m',
  string:   '\x1b[38;5;114m',
  func:     '\x1b[38;5;215m',
  var:      '\x1b[38;5;251m',
  num:      '\x1b[38;5;75m',
  method:   '\x1b[38;5;80m',
  op:       '\x1b[38;5;183m',
  comment:  '\x1b[38;5;245m',
  brace:    '\x1b[38;5;215m',
  pipe:  '\x1b[30;105m',
  build: '\x1b[30;106m',
  read:  '\x1b[30;103m',
  norm:  '\x1b[30;102m',
  seg:   '\x1b[30;101m',
  bridge:'\x1b[30;107m',  // black on white
  tag:   '\x1b[30;45m',
  walk:  '\x1b[30;104m',
  walkp: '\x1b[30;44m',
  write: '\x1b[30;43m',   // black on yellow

  rdbl:  '\x1b[30;96m',
  comp:  '\x1b[30;95m',
  decomp:'\x1b[30;94m',
  sys:   '\x1b[30;90m',
  http:  '\x1b[30;46m',   // black on cyan — Site HTTP access log
  ok:    '\x1b[38;5;114m',
  err:   '\x1b[38;5;203m',
  warn:  '\x1b[38;5;215m',
  info:  '\x1b[38;5;80m',
  proc:  '\x1b[38;5;183m',
};

const MOD_BADGE = {
  PIPELINE:   { code: C.pipe,   label: 'PIPE' },
  BUILD:      { code: C.build,  label: 'BUILD' },
  READER:     { code: C.read,   label: 'READ' },
  NORMALIZE:  { code: C.norm,   label: 'NORM' },
  SEGMENT:    { code: C.seg,    label: 'SEG' },
  BRIDGE:     { code: C.bridge, label: 'BRIDGE' },
  TAGGER:     { code: C.tag,    label: 'TAG' },
  WALKER:     { code: C.walk,   label: 'WALK' },
  WALKER_POS: { code: C.walkp,  label: 'WALKP' },
  WRITER:     { code: C.write,  label: 'WRITE' },
  READABLE:   { code: C.rdbl,   label: 'RDBL' },
  COMPOSER:   { code: C.comp,   label: 'COMP' },
  DECOMPOSER: { code: C.decomp, label: 'DECOMP' },
  SYSTEM:     { code: C.sys,    label: 'SYS' },
  HTTP:       { code: C.http,   label: 'HTTP' },
};

const STATUS_CLR = {
  success:    C.ok,
  fail:       C.err,
  error:      C.err,
  processing: C.proc,
  info:       C.info,
  warn:       C.warn,
  skip:       C.warn,
};

function ts() {
  const now = new Date();
  const d = now.toLocaleString('en-GB', {
    timeZone: 'Asia/Yangon',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${d}.${ms}`;
}

function isoTs() {
  return new Date().toISOString();
}

/* Moved from monoSyllabism/helper/utilities.js (helper/ deleted): session/output
   hash stamp, YYYYMMDD_HHMMSS_mmm. Named export like stamp() below. */
function getDateTimeHash() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${y}${m}${d}_${h}${min}${s}_${ms}`;
}

function ss(data) {
  try { return JSON.stringify(data); }
  catch { return '[Circular]'; }
}

function ensureLogDir() {
  const dir = LogFile();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function logPath(fileName) {
  return path.join(ensureLogDir(), fileName);
}

function writeFileLog(module, level, event, data) {
  const file = FILE_MAP[module];
  if (!file) return;
  const line = `[${isoTs()}] [${module}] [${level}] ${event} ${ss(data)}\n`;
  try {
    fs.appendFileSync(logPath(file), line, 'utf8');
  } catch {} // eslint-disable-line no-empty -- best-effort cleanup
}

function writeReport(module) {
  const file = FILE_MAP[module];
  if (!file) return;
  const r = getReport(module);
  r.endTime = Date.now();
  const block = `\n${r.render()}\n`;
  try {
    fs.appendFileSync(logPath(file), block, 'utf8');
  } catch {} // eslint-disable-line no-empty -- best-effort cleanup
}

function writeConsole(module, level, event, data) {
  const badge = MOD_BADGE[module] || MOD_BADGE.SYSTEM;
  const clr = STATUS_CLR[level] || C.info;
  const modStr = `${badge.code} ${badge.label.padEnd(6)} ${C.rst}`;

  let extra = '';
  if (data && typeof data === 'object') {
    if (data.elapsed !== undefined) {
      extra = ` ${C.op}|${C.rst} ${C.num}${data.elapsed}ms${C.rst}`;
    } else if (data.file !== undefined) {
      extra = ` ${C.op}|${C.rst} ${C.string}${data.file}${C.rst}`;
    }
  }

  const tsStr  = `${C.comment}${ts()}${C.rst}`;
  const evtStr = `${C.string}${event}${C.rst}`;

  console.log(
    `${tsStr} ${modStr} ${clr}${C.bold}${level.toUpperCase().padEnd(7)}${C.rst} ${evtStr}${extra}`
  );
}

// ── Shared console styling ──────────────────────────────────────────────
// Exported so other processes (the Site's HTTP access log) can print in the
// exact same palette instead of duplicating these codes and drifting from
// them. Read-only by convention: nothing here mutates engine state.
const palette = C;
const moduleBadges = MOD_BADGE;
const statusColors = STATUS_CLR;
/** The engine's timestamp format (Asia/Yangon, ms precision). */
function stamp() {
  return ts();
}
/** One console line in the engine's exact shape: ts | badge | LEVEL | event */
function formatConsoleLine(module, level, event, extra = '') {
  const badge = MOD_BADGE[module] || MOD_BADGE.SYSTEM;
  const clr = STATUS_CLR[level] || C.info;
  const modStr = `${badge.code} ${badge.label.padEnd(6)} ${C.rst}`;
  const tsStr = `${C.comment}${ts()}${C.rst}`;
  return `${tsStr} ${modStr} ${clr}${C.bold}${level.toUpperCase().padEnd(7)}${C.rst} ${event}${extra}`;
}

function emitLog(module, level, event, data = {}, top = false) {
  if (_debug && !top) {
    writeFileLog(module, level, event, data);
  }
  if (top) {
    writeConsole(module, level, event, data);
  }
}

// ── Report API ──
function reportInc(module, key, n = 1) {
  if (!_debug) return;
  getReport(module).inc(key, n);
}
function reportSample(module, key, item, cap = 20) {
  if (!_debug) return;
  getReport(module).addSample(key, item, cap);
}
function reportList(module, key, item) {
  if (!_debug) return;
  getReport(module).addList(key, item);
}
function reportFlag(module, key, val) {
  if (!_debug) return;
  getReport(module).setFlag(key, val);
}
function reportStart(module) {
  if (!_debug) return;
  const r = getReport(module);
  r.startTime = Date.now();
  _timers.set(module, Date.now());
}
function reportEnd(module) {
  if (!_debug) return;
  const r = getReport(module);
  r.endTime = Date.now();
  writeReport(module);
}
function reportElapsed(module) {
  const t0 = _timers.get(module);
  return t0 ? Date.now() - t0 : 0;
}

function reportTreePath(module, root, step, type) {
  if (!_debug) return;
  getReport(module).treePath(root, step, type);
}
function reportPosTreeGlobal(module, step, type) {
  if (!_debug) return;
  getReport(module).posTreeGlobalStep(step, type);
}
function reportPosTreeEmptyRoot(module, root, step) {
  if (!_debug) return;
  getReport(module).posTreeEmptyRoot(root, step);
}
function reportPosTreeHitRoot(module, root, step) {
  if (!_debug) return;
  getReport(module).posTreeHitRoot(root, step);
}

// ── Init ──
function init(flags = {}) {
  if (_initialized) return;
  _debug = flags.DEBUG === true;
  _batchMode = flags.BATCH === true || flags.SEGMENTED_MODE === 'readdir';
  ensureLogDir();
  _initialized = true;

  if (_debug) {
    emitLog('SYSTEM', 'info', 'logger-init', { debug: true, batch: _batchMode }, true);
  }
}

function setLogFile(filePath) {
  _currentFile = filePath;
}

function setLogBatch(isBatch) {
  _batchMode = isBatch;
}

process.on('exit', () => {
  if (_debug) {
    for (const mod of _reports.keys()) {
      writeReport(mod);
    }
  }
});

process.on('SIGINT', () => {
  emitLog('SYSTEM', 'warn', 'SIGINT', {}, true);
  process.exit(0);
});

// ═══════════════════════════════════════════════════════════════
// CHAIN-LEVEL WRAPPERS
// ═══════════════════════════════════════════════════════════════

function _chain(module, level, event, data = {}) {
  emitLog(module, level, event, data, true);
}

function pipelineStart(data)  { _chain('PIPELINE', 'processing', 'start', data); }
function pipelineEnd(data)    {
  const elapsed = reportElapsed('PIPELINE');
  _chain('PIPELINE', 'success', 'end', { ...data, elapsed });
  reportEnd('PIPELINE');
}
function pipelineError(data)  { _chain('PIPELINE', 'fail', 'error', data); }

function buildStart(data)     { reportStart('BUILD'); _chain('BUILD', 'processing', 'start', data); }
function buildEnd(data)       {
  const elapsed = reportElapsed('BUILD');
  _chain('BUILD', 'success', 'end', { ...data, elapsed });
  reportEnd('BUILD');
}
function buildSkip(data)      { _chain('BUILD', 'skip', 'skip', data); }
function buildFail(data)      { _chain('BUILD', 'fail', 'fail', data); }
function treeBuilt(data)      { reportInc('BUILD', 'treesBuilt'); _chain('BUILD', 'success', 'tree-built', data); }

function readerStart(data)    { reportStart('READER'); _chain('READER', 'processing', 'start', data); }
function readerEnd(data)      {
  const elapsed = reportElapsed('READER');
  _chain('READER', 'success', 'end', { ...data, elapsed });
  reportEnd('READER');
}
function readerFail(data)     { _chain('READER', 'fail', 'fail', data); }

function normalizeStart(data) { reportStart('NORMALIZE'); _chain('NORMALIZE', 'processing', 'start', data); }
function normalizeEnd(data)   {
  const elapsed = reportElapsed('NORMALIZE');
  _chain('NORMALIZE', 'success', 'end', { ...data, elapsed });
  reportEnd('NORMALIZE');
}

function segmentStart(data)   { reportStart('SEGMENT'); _chain('SEGMENT', 'processing', 'segmenting...', data); }
function segmentEnd(data)     {
  const elapsed = reportElapsed('SEGMENT');
  _chain('SEGMENT', 'success', 'done', { ...data, elapsed });
  reportEnd('SEGMENT');
}

function bridgeStart(data)    { reportStart('BRIDGE'); _chain('BRIDGE', 'processing', 'bridging...', data); }
function bridgeEnd(data)      {
  const elapsed = reportElapsed('BRIDGE');
  _chain('BRIDGE', 'success', 'done', { ...data, elapsed });
  reportEnd('BRIDGE');
}

function taggerStart(data)    { reportStart('TAGGER'); _chain('TAGGER', 'processing', 'tagging...', data); }
function taggerEnd(data)      {
  const elapsed = reportElapsed('TAGGER');
  _chain('TAGGER', 'success', 'done', { ...data, elapsed });
  reportEnd('TAGGER');
}

function writerStart(data)    { reportStart('WRITER'); _chain('WRITER', 'processing', 'start', data); }
function writerEnd(data)      {
  const elapsed = reportElapsed('WRITER');
  _chain('WRITER', 'success', 'end', { ...data, elapsed });
  reportEnd('WRITER');
}
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
function writerWrote(data)    { reportInc('WRITER', 'filesWritten'); }

// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
function walkerStart(data)    { reportStart('WALKER'); }
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
function walkerEnd(data)      { reportEnd('WALKER'); }

// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
function walkerPosStart(data) { reportStart('WALKER_POS'); }
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
function walkerPosEnd(data)   { reportEnd('WALKER_POS'); }

function readableStart(data)  { reportStart('READABLE'); _chain('READABLE', 'processing', 'converting...', data); }
function readableEnd(data)    {
  const elapsed = reportElapsed('READABLE');
  _chain('READABLE', 'success', 'done', { ...data, elapsed });
  reportEnd('READABLE');
}

function composerStart(data)  { reportStart('COMPOSER'); _chain('COMPOSER', 'processing', 'composing...', data); }
function composerEnd(data)    {
  const elapsed = reportElapsed('COMPOSER');
  _chain('COMPOSER', 'success', 'done', { ...data, elapsed });
  reportEnd('COMPOSER');
}

function decomposerStart(data) { reportStart('DECOMPOSER'); _chain('DECOMPOSER', 'processing', 'decomposing...', data); }
function decomposerEnd(data)   {
  const elapsed = reportElapsed('DECOMPOSER');
  _chain('DECOMPOSER', 'success', 'done', { ...data, elapsed });
  reportEnd('DECOMPOSER');
}

// ═══════════════════════════════════════════════════════════════
// DETAIL WRAPPERS — report to file only
// ═══════════════════════════════════════════════════════════════

// ── Normalize ──
function normFixImposter(count)        { reportInc('NORMALIZE', 'fixImposter', count); }
function normComposeNormal(count)      { reportInc('NORMALIZE', 'composeNormal', count); }
function normComposeNgaasat(count)     { reportInc('NORMALIZE', 'composeNgaasat', count); }

// ── Segment ──
function segLineCount(n)               { reportFlag('SEGMENT', 'lineCount', n); }
function segEmittedSyllables(n)        { reportInc('SEGMENT', 'emittedSyllables', n); }
function segValidSyllable(n, bareBase = 0) {
  reportInc('SEGMENT', 'validSyllables', n);
  if (bareBase) reportInc('SEGMENT', 'bareBaseSyllables', bareBase);
}
function segPossibleSyllable(n, punctuation = 0, standalone = 0) {
  reportInc('SEGMENT', 'possibleSyllables', n);
  if (punctuation) reportInc('SEGMENT', 'possiblePunctuation', punctuation);
  if (standalone) reportInc('SEGMENT', 'possibleStandalone', standalone);
}
function segUnknownSyllable(n, bypass = 0, invalid = 0) {
  reportInc('SEGMENT', 'unknownSyllables', n);
  if (bypass) reportInc('SEGMENT', 'unknownBypass', bypass);
  if (invalid) reportInc('SEGMENT', 'unknownInvalid', invalid);
}
function segInvalidChar(ch, context = '') {
  reportSample('SEGMENT', 'invalidChars', ch);
  if (context) reportList('SEGMENT', 'invalidCharContexts', `${ch} @ ${context}`);
}
function segDelimiter(delim)           { reportFlag('SEGMENT', 'delimiter', delim); }

// ── Bridge ──
function bridgeSyllableCount(n)        { reportInc('BRIDGE', 'syllableCount', n); }
function bridgeTildeCount(n)           { reportInc('BRIDGE', 'tildeCount', n); }
function bridgeLineCount(n)            { reportInc('BRIDGE', 'lineCount', n); }
function bridgeMode(mode)              { reportFlag('BRIDGE', 'mode', mode); }

// ── Tagger ──
function tagTokenReceived(n)           { reportInc('TAGGER', 'tokenReceived', n); }
function tagWordCount(n)               { reportInc('TAGGER', 'wordCount', n); }
function tagMatched(n)                 { reportInc('TAGGER', 'matched', n); }
function tagUnmatched(n)               { reportInc('TAGGER', 'unmatched', n); }
function tagPatternHit(pattern, n = 1) { reportInc('TAGGER', `pattern_${pattern}`, n); }
function tagPosAssigned(pos, n = 1)    { reportInc('TAGGER', `pos_${pos}`, n); }

// ── Walker (syllable tree) ──
function walkStepHit(root, step)       { reportTreePath('WALKER', root, step, 'hit'); }
function walkStepEmpty(root, step)     { reportTreePath('WALKER', root, step, 'empty'); }
function walkQuit(reason)              { reportInc('WALKER', `quit_${reason}`); }
function walkFail(reason)              { reportInc('WALKER', `fail_${reason}`); }
function walkOutputSyllables(n)        { reportInc('WALKER', 'outputSyllables', n); }

// ── Walker POS ──
function walkPosStepHit(root, step)    { reportPosTreeHitRoot('WALKER_POS', root, step); reportPosTreeGlobal('WALKER_POS', step, 'hit'); }
function walkPosStepEmpty(root, step)  { reportPosTreeEmptyRoot('WALKER_POS', root, step); reportPosTreeGlobal('WALKER_POS', step, 'empty'); }
function walkPosQuit(reason)           { reportInc('WALKER_POS', `quit_${reason}`); }
function walkPosFail(reason)           { reportInc('WALKER_POS', `fail_${reason}`); }
function walkPosOutputSyllables(n)     { reportInc('WALKER_POS', 'outputSyllables', n); }
function walkPosWordCount(n)           { reportInc('WALKER_POS', 'wordCount', n); }
function walkPosTag(tag)               { reportInc('WALKER_POS', `tag_${tag}`); }

// ── Readable ──
function rdblBroken(n)                 { reportInc('READABLE', 'broken', n); }
function rdblFixed(n)                  { reportInc('READABLE', 'fixed', n); }
function rdblScanResult(type, count)   { reportInc('READABLE', `scan_${type}`, count); }

// ── Composer ──
function compClusterNormal(n)          { reportInc('COMPOSER', 'clusterNormal', n); }
function compClusterNgaasat(n)         { reportInc('COMPOSER', 'clusterNgaasat', n); }

// ── Decomposer (mirror) ──
function decompClusterNormal(n)        { reportInc('DECOMPOSER', 'clusterNormal', n); }
function decompClusterNgaasat(n)       { reportInc('DECOMPOSER', 'clusterNgaasat', n); }

// ═══════════════════════════════════════════════════════════════
// DEBUG LOG (kept for compat)
// ═══════════════════════════════════════════════════════════════
const DEBUG_LOG = () => path.join(LogFile(), 'normalize-debug.log');

function debugLogInit() {
  if (!_debug) return;
  try {
    fs.appendFileSync(DEBUG_LOG(), `--- ${isoTs()} ---\n`, 'utf8');
  } catch {} // eslint-disable-line no-empty -- best-effort cleanup
}

function debugLogPass(label, text) {
  if (!_debug) return;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('CONJUNCTIONS') || line.includes('VERBS') || line.includes('w')) {
      try {
        fs.appendFileSync(DEBUG_LOG(), `${label} L${i}: ${line.slice(0, 120)}\n`, 'utf8');
      } catch {} // eslint-disable-line no-empty -- best-effort cleanup
    }
  }
}

function flushWalkerBuffer() {}
function flushTaggerBuffer() {}
function flushAll() {}

function log(...args) {
  const msg = args.map(a => typeof a === 'object' ? ss(a) : String(a)).join(' ');
  emitLog('SYSTEM', 'info', 'log', { msg }, true);
}

const defaultExport = {
  init,
  emitLog,
  setLogFile,
  setLogBatch,
  log,
  flushAll,
  flushWalkerBuffer,
  flushTaggerBuffer,

  reportInc, reportSample, reportList, reportFlag,
  reportStart, reportEnd, reportElapsed,
  reportTreePath,
  reportPosTreeGlobal, reportPosTreeEmptyRoot, reportPosTreeHitRoot,

  pipelineStart, pipelineEnd, pipelineError,
  buildStart, buildEnd, buildSkip, buildFail, treeBuilt,
  readerStart, readerEnd, readerFail,
  normalizeStart, normalizeEnd,
  segmentStart, segmentEnd,
  bridgeStart, bridgeEnd,
  taggerStart, taggerEnd,
  writerStart, writerEnd, writerWrote,
  walkerStart, walkerEnd,
  walkerPosStart, walkerPosEnd,
  readableStart, readableEnd,
  composerStart, composerEnd,
  decomposerStart, decomposerEnd,

  normFixImposter, normComposeNormal, normComposeNgaasat,
  segLineCount, segEmittedSyllables, segValidSyllable, segPossibleSyllable,
  segUnknownSyllable, segInvalidChar, segDelimiter,
  bridgeSyllableCount, bridgeTildeCount, bridgeLineCount, bridgeMode,
  tagTokenReceived, tagWordCount, tagMatched, tagUnmatched, tagPatternHit, tagPosAssigned,
  walkStepHit, walkStepEmpty, walkQuit, walkFail, walkOutputSyllables,
  walkPosStepHit, walkPosStepEmpty, walkPosQuit, walkPosFail, walkPosOutputSyllables, walkPosWordCount, walkPosTag,
  rdblBroken, rdblFixed, rdblScanResult,
  compClusterNormal, compClusterNgaasat,
  decompClusterNormal, decompClusterNgaasat,

  debugLogInit, debugLogPass,
};

return { getDateTimeHash, palette, moduleBadges, statusColors, stamp, formatConsoleLine, emitLog, reportInc, reportSample, reportList, reportFlag, reportStart, reportEnd, reportElapsed, reportTreePath, reportPosTreeGlobal, reportPosTreeEmptyRoot, reportPosTreeHitRoot, init, setLogFile, setLogBatch, pipelineStart, pipelineEnd, pipelineError, buildStart, buildEnd, buildSkip, buildFail, treeBuilt, readerStart, readerEnd, readerFail, normalizeStart, normalizeEnd, segmentStart, segmentEnd, bridgeStart, bridgeEnd, taggerStart, taggerEnd, writerStart, writerEnd, writerWrote, walkerStart, walkerEnd, walkerPosStart, walkerPosEnd, readableStart, readableEnd, composerStart, composerEnd, decomposerStart, decomposerEnd, normFixImposter, normComposeNormal, normComposeNgaasat, segLineCount, segEmittedSyllables, segValidSyllable, segPossibleSyllable, segUnknownSyllable, segInvalidChar, segDelimiter, bridgeSyllableCount, bridgeTildeCount, bridgeLineCount, bridgeMode, tagTokenReceived, tagWordCount, tagMatched, tagUnmatched, tagPatternHit, tagPosAssigned, walkStepHit, walkStepEmpty, walkQuit, walkFail, walkOutputSyllables, walkPosStepHit, walkPosStepEmpty, walkPosQuit, walkPosFail, walkPosOutputSyllables, walkPosWordCount, walkPosTag, rdblBroken, rdblFixed, rdblScanResult, compClusterNormal, compClusterNgaasat, decompClusterNormal, decompClusterNgaasat, debugLogInit, debugLogPass, flushWalkerBuffer, flushTaggerBuffer, flushAll, log, default: defaultExport };
})();

const parserLog = (() => {































const PREFIX = Object.freeze({ ok: "[+]", warn: "[-]", info: "[i]", step: "   " });


const SILENT = () => {};


const stdoutLog = () => (message) => process.stdout.write(`${message}\n`);






function collect() {
  const lines = [];
  const sink = (message) => { lines.push(String(message)); };
  sink.lines = lines;
  return sink;
}


const tee = (...sinks) => (message) => { for (const s of sinks) s(message); };








function resolveLog({ logging = true, log } = {}) {
  if (typeof log === "function") return log;
  return (logging !== false && log !== false) ? stdoutLog() : SILENT;
}

const ok = (log, message) => log(`${PREFIX.ok} ${message}`);
const warn = (log, message) => log(`${PREFIX.warn} ${message}`);
const info = (log, message) => log(`${PREFIX.info} ${message}`);
const step = (log, message) => log(`${PREFIX.step} ${message}`);

return { PREFIX, SILENT, stdoutLog, collect, tee, resolveLog, ok, warn, info, step };
})();

const httpLog = (() => {
const { palette: C, moduleBadges, statusColors, stamp, paint } = siteLog;
const useColor = !process.env.NO_COLOR;
function levelFor(status) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  if (status >= 300) return 'info';
  if (status >= 200) return 'success';
  return 'processing';
}
const METHOD_COLOR = {
  GET: C.method,
  POST: C.string,
  PUT: C.warn,
  PATCH: C.warn,
  DELETE: C.err,
  OPTIONS: C.comment,
  HEAD: C.comment,
};
function humanSize(bytes) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
function createHttpConsoleLogger(morgan) {
  return morgan((tokens, req, res) => {
    const status = Number(tokens.status(req, res)) || 0;
    const level = levelFor(status);
    const clr = statusColors[level] || C.info;
    const badge = moduleBadges.HTTP || moduleBadges.SYSTEM;
    const badgeStr = useColor
      ? `${badge.code} ${badge.label.padEnd(6)} ${C.rst}`
      : `[${badge.label}]`;
    const method = tokens.method(req, res) || '-';
    const url = tokens.url(req, res) || '-';
    const ms = Number(tokens['response-time'](req, res));
    const len = Number(tokens.res(req, res, 'content-length'));
    const timeColor = ms >= 1000 ? C.err : ms >= 250 ? C.warn : C.num;
    const bar = paint(C.op, '|');
    return [
      paint(C.comment, stamp()),
      badgeStr,
      paint(`${clr}${C.bold}`, level.toUpperCase().padEnd(7)),
      paint(METHOD_COLOR[method] || C.var, method),
      paint(C.string, url),
      bar,
      paint(clr, status || '---'),
      bar,
      paint(timeColor, Number.isFinite(ms) ? `${ms.toFixed(1)}ms` : '-'),
      bar,
      paint(C.comment, humanSize(len)),
    ].join(' ');
  });
}

function createHttpFileLogger(morgan, stream) {
  return morgan('combined', { stream });
}
return { createHttpConsoleLogger, createHttpFileLogger };
})();

const sqlLog = (() => {
const EXECUTING = new Set(['run', 'get', 'all', 'iterate']);
function attachSqlLogging(db, write) {
  const log = (sql, values) => {
    const ts = new Date().toISOString();
    write(`[${ts}] SQL: ${String(sql).trim()}\n`);
    if (values !== undefined && values.length > 0) {
      write(`[${ts}] Values: ${JSON.stringify(values)}\n`);
    }
  };
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql, ...rest) => {
    const stmt = originalPrepare(sql, ...rest);
    return new Proxy(stmt, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== 'function' || !EXECUTING.has(prop)) return value;
        return (...args) => {
          log(sql, args);
          return value.apply(target, args);
        };
      },
    });
  };
  return db;
}
return { attachSqlLogging };
})();

export { coreLog, siteLog, engineLog, legacyLog, parserLog, httpLog, sqlLog };
