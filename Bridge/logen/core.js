/**
 * FILE: logen/core.js
 *
 * THE OVERLAP. Everything both halves must agree on, and nothing either
 * half owns alone.
 *
 * The site and the engine are laid out separately -- different trees, no
 * shared package -- so this file is meant to be IDENTICAL in both. Copy it
 * across; do not fork it. If a change here is only needed by one side, it
 * belongs in that side's half instead.
 *
 *   logen/core.js     this file: palette, badges, report accumulation,
 *                     the event bus, the check registry, the sinks
 *   logen/site.js     site half: HTTP, queue, manager, worker, praser
 *   logen/engine.js   engine half: normalize and segment ledgers, the
 *                     cross-module reconciliation, their checks
 *
 * Neither half imports the other. Each imports this.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

/* ── palette ─────────────────────────────────────────────────────────── */

export const palette = {
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
export const moduleBadges = {
  CHECK: { code: '\x1b[48;5;54m\x1b[38;5;231m', label: 'CHECK' },
  SYSTEM: { code: '\x1b[48;5;238m\x1b[38;5;231m', label: 'SYS' },
};

/** A half declares the modules it owns. */
export function registerBadges(badges) {
  Object.assign(moduleBadges, badges);
  return moduleBadges;
}

export const statusColors = {
  success: C.ok,
  fail: C.err,
  error: C.err,
  processing: C.proc,
  info: C.info,
  warn: C.warn,
  skip: C.skip,
};

const useColor = () => !process.env.NO_COLOR;
export const paint = (code, text) => (useColor() ? `${code}${text}${C.rst}` : String(text));

export function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Stable run id, also used for artifact names. */
export function getDateTimeHash(at = new Date()) {
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

export const reportInc = (module, key, n = 1) => tracker(module).inc(key, n);
export const reportFlag = (module, key, value) => tracker(module).flag(key, value);
export const reportList = (module, key, item) => tracker(module).list(key, item);
export const reportSample = (module, key, item, cap = 20) => tracker(module).sample(key, item, cap);
export const reportStart = (module) => { tracker(module).startTime = Date.now(); };
export const reportEnd = (module) => { tracker(module).endTime = Date.now(); };

export function reportElapsed(module) {
  const t = tracker(module);
  if (!t.startTime) return 0;
  return (t.endTime ?? Date.now()) - t.startTime;
}

/* ── emit ────────────────────────────────────────────────────────────── */

export function formatConsoleLine(module, level, event, extra = '') {
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
export function appendFile(line) {
  if (!_logFile) return;
  try {
    fs.mkdirSync(path.dirname(_logFile), { recursive: true });
    fs.appendFileSync(_logFile, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch { /* a log that cannot be written must not break the run */ }
}

export function emitLog(module, level, event, data = {}) {
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
export function flushReport({ toConsole = true } = {}) {
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

export function resetReport() { _reports.clear(); }

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

export const bus = new EventEmitter();

/** A stage emits; it does not format and does not choose a sink. */
export function emitEvent(name, payload = {}) {
  bus.emit(name, payload);
  bus.emit('*', { event: name, ...payload });
}

export const onEvent = (name, fn) => bus.on(name, fn);

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
export function defineCheck(name, { after, run }) {
  _checks.push({ name, after, run });
  return _checks.length;
}

function verdict(result) {
  if (result === true || result === undefined) return { ok: true, detail: '' };
  if (result === false) return { ok: false, detail: '' };
  if (typeof result === 'string') return { ok: false, detail: result };
  return { ok: Boolean(result?.ok), detail: result?.detail ?? '' };
}

export function runChecks(after, payload) {
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
export function record(event, payload) {
  if (!_checksOn) return;
  _chain.push({ event, payload, at: Date.now() });
  if (_chain.length > 64) _chain.shift();
}

export const chainSoFar = () => _chain.slice();
export const resetChain = () => { _chain = []; _chainResults = []; };

/* The invariants. Written once; they are the chain's contract, and they
   are the same statements the ledgers already compute. */
/**
 * Shared install. Each half calls this once, then adds its own listeners.
 * The 'chain' listener lives here because the end-of-document summary is
 * the same statement on both sides.
 */
export function installBase({ file = '', checks = false } = {}) {
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

export function resetPassiveLog() {
  bus.removeAllListeners();
  _passiveInstalled = false;
  _checksOn = false;
  _checks.length = 0;
  resetChain();
}

export const checksEnabled = () => _checksOn;

/* ── setup ───────────────────────────────────────────────────────────── */

export function init({ debug = false, batch = false, file = '' } = {}) {
  _debug = Boolean(debug);
  _batch = Boolean(batch);
  if (file) _logFile = path.resolve(file);
  return { debug: _debug, batch: _batch, file: _logFile };
}

export const setLogFile = (filePath) => { _logFile = filePath ? path.resolve(filePath) : ''; };
export const setLogBatch = (isBatch) => { _batch = Boolean(isBatch); };
export const isDebug = () => _debug;

/** Plain timestamped line, for callers that just want console.log with a clock. */
export function log(...args) {
  console.log(paint(C.comment, `[${stamp()}]`), ...args);
}


/* ── shared shapes ───────────────────────────────────────────────────
   Both halves report the same kinds of thing, so the readers and the
   formatters live here rather than being written twice and drifting. */

/** A from->to tally: Map, plain object, or a bare number. */
export function readTally(value) {
  if (value == null) return { total: 0, pairs: [], chars: 0 };
  // A bare number can only be read as occurrences; its character effect is
  // unknowable, so it is reported and left out of any arithmetic.
  if (typeof value === 'number') return { total: value, pairs: [], chars: null };
  if (typeof value.total === 'function') {
    return { total: value.total(), pairs: value.pairs(), chars: value.charDelta?.() ?? null };
  }
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  const pairs = entries.map(([key, count]) => {
    const [from, to] = String(key).split(/\u0000|=>/);
    return { from, to: to ?? '?', count: Number(count) || 0 };
  }).sort((a, b) => b.count - a.count);
  const chars = pairs.reduce(
    (n, pr) => n + ([...pr.from].length - [...(pr.to ?? '')].length) * pr.count, 0,
  );
  return { total: pairs.reduce((n, pr) => n + pr.count, 0), pairs, chars };
}

/** A keyed counter: Map, plain object, or a bare number. */
export function readCounts(value) {
  if (value == null) return { total: 0, items: [] };
  if (typeof value === 'number') return { total: value, items: [] };
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  const items = entries
    .map(([key, count]) => ({ key: String(key), count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count);
  return { total: items.reduce((n, i) => n + i.count, 0), items };
}

export const showPairs = (pairs, cap) => pairs.slice(0, cap)
  .map((pr) => `${pr.from}=>${pr.to} {${pr.count}}`).join('  ');

export const showCounts = (items, cap) => items.slice(0, cap)
  .map((i) => `${i.key} {${i.count}}`).join('  ');

/** start/end/fail/skip for any module name. */
export const stage = (module) => ({
  start: (data = {}) => { reportStart(module); emitLog(module, 'processing', 'start', data); },
  end: (data = {}) => {
    reportEnd(module);
    emitLog(module, 'success', 'done', { ...data, ms: reportElapsed(module) });
  },
  fail: (data = {}) => emitLog(module, 'fail', 'fail', data),
  skip: (data = {}) => emitLog(module, 'skip', 'skip', data),
});

export default {
  palette, moduleBadges, statusColors, registerBadges, paint, stamp, log,
  getDateTimeHash, init, setLogFile, setLogBatch, isDebug,
  emitLog, formatConsoleLine, appendFile, flushReport, resetReport,
  reportInc, reportFlag, reportList, reportSample, reportStart, reportEnd, reportElapsed,
  bus, emitEvent, onEvent, installBase, resetPassiveLog, checksEnabled,
  defineCheck, runChecks, record, chainSoFar, resetChain,
  readTally, readCounts, showPairs, showCounts, stage,
};
