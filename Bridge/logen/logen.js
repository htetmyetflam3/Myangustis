// FILE: bridge/log.js
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

import fs from 'fs';
import path from 'path';
import { LogFile } from './path.js';

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
export function getDateTimeHash() {
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

function clearLogs() {
  const dir = ensureLogDir();
  for (const file of Object.values(FILE_MAP)) {
    const p = path.join(dir, file);
    try { fs.writeFileSync(p, '', 'utf8'); } catch {} // eslint-disable-line no-empty -- best-effort cleanup
  }
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
export const palette = C;
export const moduleBadges = MOD_BADGE;
export const statusColors = STATUS_CLR;
/** The engine's timestamp format (Asia/Yangon, ms precision). */
export function stamp() {
  return ts();
}
/** One console line in the engine's exact shape: ts | badge | LEVEL | event */
export function formatConsoleLine(module, level, event, extra = '') {
  const badge = MOD_BADGE[module] || MOD_BADGE.SYSTEM;
  const clr = STATUS_CLR[level] || C.info;
  const modStr = `${badge.code} ${badge.label.padEnd(6)} ${C.rst}`;
  const tsStr = `${C.comment}${ts()}${C.rst}`;
  return `${tsStr} ${modStr} ${clr}${C.bold}${level.toUpperCase().padEnd(7)}${C.rst} ${event}${extra}`;
}

export function emitLog(module, level, event, data = {}, top = false) {
  if (_debug && !top) {
    writeFileLog(module, level, event, data);
  }
  if (top) {
    writeConsole(module, level, event, data);
  }
}

// ── Report API ──
export function reportInc(module, key, n = 1) {
  if (!_debug) return;
  getReport(module).inc(key, n);
}
export function reportSample(module, key, item, cap = 20) {
  if (!_debug) return;
  getReport(module).addSample(key, item, cap);
}
export function reportList(module, key, item) {
  if (!_debug) return;
  getReport(module).addList(key, item);
}
export function reportFlag(module, key, val) {
  if (!_debug) return;
  getReport(module).setFlag(key, val);
}
export function reportStart(module) {
  if (!_debug) return;
  const r = getReport(module);
  r.startTime = Date.now();
  _timers.set(module, Date.now());
}
export function reportEnd(module) {
  if (!_debug) return;
  const r = getReport(module);
  r.endTime = Date.now();
  writeReport(module);
}
export function reportElapsed(module) {
  const t0 = _timers.get(module);
  return t0 ? Date.now() - t0 : 0;
}

export function reportTreePath(module, root, step, type) {
  if (!_debug) return;
  getReport(module).treePath(root, step, type);
}
export function reportPosTreeGlobal(module, step, type) {
  if (!_debug) return;
  getReport(module).posTreeGlobalStep(step, type);
}
export function reportPosTreeEmptyRoot(module, root, step) {
  if (!_debug) return;
  getReport(module).posTreeEmptyRoot(root, step);
}
export function reportPosTreeHitRoot(module, root, step) {
  if (!_debug) return;
  getReport(module).posTreeHitRoot(root, step);
}

// ── Init ──
export function init(flags = {}) {
  if (_initialized) return;
  _debug = flags.DEBUG === true;
  _batchMode = flags.BATCH === true || flags.SEGMENTED_MODE === 'readdir';
  clearLogs();
  _initialized = true;

  if (_debug) {
    emitLog('SYSTEM', 'info', 'logger-init', { debug: true, batch: _batchMode }, true);
  }
}

export function setLogFile(filePath) {
  _currentFile = filePath;
}

export function setLogBatch(isBatch) {
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

export function pipelineStart(data)  { _chain('PIPELINE', 'processing', 'start', data); }
export function pipelineEnd(data)    {
  const elapsed = reportElapsed('PIPELINE');
  _chain('PIPELINE', 'success', 'end', { ...data, elapsed });
  reportEnd('PIPELINE');
}
export function pipelineError(data)  { _chain('PIPELINE', 'fail', 'error', data); }

export function buildStart(data)     { reportStart('BUILD'); _chain('BUILD', 'processing', 'start', data); }
export function buildEnd(data)       {
  const elapsed = reportElapsed('BUILD');
  _chain('BUILD', 'success', 'end', { ...data, elapsed });
  reportEnd('BUILD');
}
export function buildSkip(data)      { _chain('BUILD', 'skip', 'skip', data); }
export function buildFail(data)      { _chain('BUILD', 'fail', 'fail', data); }
export function treeBuilt(data)      { reportInc('BUILD', 'treesBuilt'); _chain('BUILD', 'success', 'tree-built', data); }

export function readerStart(data)    { reportStart('READER'); _chain('READER', 'processing', 'start', data); }
export function readerEnd(data)      {
  const elapsed = reportElapsed('READER');
  _chain('READER', 'success', 'end', { ...data, elapsed });
  reportEnd('READER');
}
export function readerFail(data)     { _chain('READER', 'fail', 'fail', data); }

export function normalizeStart(data) { reportStart('NORMALIZE'); _chain('NORMALIZE', 'processing', 'start', data); }
export function normalizeEnd(data)   {
  const elapsed = reportElapsed('NORMALIZE');
  _chain('NORMALIZE', 'success', 'end', { ...data, elapsed });
  reportEnd('NORMALIZE');
}

export function segmentStart(data)   { reportStart('SEGMENT'); _chain('SEGMENT', 'processing', 'segmenting...', data); }
export function segmentEnd(data)     {
  const elapsed = reportElapsed('SEGMENT');
  _chain('SEGMENT', 'success', 'done', { ...data, elapsed });
  reportEnd('SEGMENT');
}

export function bridgeStart(data)    { reportStart('BRIDGE'); _chain('BRIDGE', 'processing', 'bridging...', data); }
export function bridgeEnd(data)      {
  const elapsed = reportElapsed('BRIDGE');
  _chain('BRIDGE', 'success', 'done', { ...data, elapsed });
  reportEnd('BRIDGE');
}

export function taggerStart(data)    { reportStart('TAGGER'); _chain('TAGGER', 'processing', 'tagging...', data); }
export function taggerEnd(data)      {
  const elapsed = reportElapsed('TAGGER');
  _chain('TAGGER', 'success', 'done', { ...data, elapsed });
  reportEnd('TAGGER');
}

export function writerStart(data)    { reportStart('WRITER'); _chain('WRITER', 'processing', 'start', data); }
export function writerEnd(data)      {
  const elapsed = reportElapsed('WRITER');
  _chain('WRITER', 'success', 'end', { ...data, elapsed });
  reportEnd('WRITER');
}
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
export function writerWrote(data)    { reportInc('WRITER', 'filesWritten'); }

// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
export function walkerStart(data)    { reportStart('WALKER'); }
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
export function walkerEnd(data)      { reportEnd('WALKER'); }

// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
export function walkerPosStart(data) { reportStart('WALKER_POS'); }
// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
export function walkerPosEnd(data)   { reportEnd('WALKER_POS'); }

export function readableStart(data)  { reportStart('READABLE'); _chain('READABLE', 'processing', 'converting...', data); }
export function readableEnd(data)    {
  const elapsed = reportElapsed('READABLE');
  _chain('READABLE', 'success', 'done', { ...data, elapsed });
  reportEnd('READABLE');
}

export function composerStart(data)  { reportStart('COMPOSER'); _chain('COMPOSER', 'processing', 'composing...', data); }
export function composerEnd(data)    {
  const elapsed = reportElapsed('COMPOSER');
  _chain('COMPOSER', 'success', 'done', { ...data, elapsed });
  reportEnd('COMPOSER');
}

export function decomposerStart(data) { reportStart('DECOMPOSER'); _chain('DECOMPOSER', 'processing', 'decomposing...', data); }
export function decomposerEnd(data)   {
  const elapsed = reportElapsed('DECOMPOSER');
  _chain('DECOMPOSER', 'success', 'done', { ...data, elapsed });
  reportEnd('DECOMPOSER');
}

// ═══════════════════════════════════════════════════════════════
// DETAIL WRAPPERS — report to file only
// ═══════════════════════════════════════════════════════════════

// ── Normalize ──
export function normFixImposter(count)        { reportInc('NORMALIZE', 'fixImposter', count); }
export function normComposeNormal(count)      { reportInc('NORMALIZE', 'composeNormal', count); }
export function normComposeNgaasat(count)     { reportInc('NORMALIZE', 'composeNgaasat', count); }

// ── Segment ──
export function segLineCount(n)               { reportFlag('SEGMENT', 'lineCount', n); }
export function segEmittedSyllables(n)        { reportInc('SEGMENT', 'emittedSyllables', n); }
export function segValidSyllable(n, bareBase = 0) {
  reportInc('SEGMENT', 'validSyllables', n);
  if (bareBase) reportInc('SEGMENT', 'bareBaseSyllables', bareBase);
}
export function segPossibleSyllable(n, punctuation = 0, standalone = 0) {
  reportInc('SEGMENT', 'possibleSyllables', n);
  if (punctuation) reportInc('SEGMENT', 'possiblePunctuation', punctuation);
  if (standalone) reportInc('SEGMENT', 'possibleStandalone', standalone);
}
export function segUnknownSyllable(n, bypass = 0, invalid = 0) {
  reportInc('SEGMENT', 'unknownSyllables', n);
  if (bypass) reportInc('SEGMENT', 'unknownBypass', bypass);
  if (invalid) reportInc('SEGMENT', 'unknownInvalid', invalid);
}
export function segInvalidChar(ch, context = '') {
  reportSample('SEGMENT', 'invalidChars', ch);
  if (context) reportList('SEGMENT', 'invalidCharContexts', `${ch} @ ${context}`);
}
export function segDelimiter(delim)           { reportFlag('SEGMENT', 'delimiter', delim); }

// ── Bridge ──
export function bridgeSyllableCount(n)        { reportInc('BRIDGE', 'syllableCount', n); }
export function bridgeTildeCount(n)           { reportInc('BRIDGE', 'tildeCount', n); }
export function bridgeLineCount(n)            { reportInc('BRIDGE', 'lineCount', n); }
export function bridgeMode(mode)              { reportFlag('BRIDGE', 'mode', mode); }

// ── Tagger ──
export function tagTokenReceived(n)           { reportInc('TAGGER', 'tokenReceived', n); }
export function tagWordCount(n)               { reportInc('TAGGER', 'wordCount', n); }
export function tagMatched(n)                 { reportInc('TAGGER', 'matched', n); }
export function tagUnmatched(n)               { reportInc('TAGGER', 'unmatched', n); }
export function tagPatternHit(pattern, n = 1) { reportInc('TAGGER', `pattern_${pattern}`, n); }
export function tagPosAssigned(pos, n = 1)    { reportInc('TAGGER', `pos_${pos}`, n); }

// ── Walker (syllable tree) ──
export function walkStepHit(root, step)       { reportTreePath('WALKER', root, step, 'hit'); }
export function walkStepEmpty(root, step)     { reportTreePath('WALKER', root, step, 'empty'); }
export function walkQuit(reason)              { reportInc('WALKER', `quit_${reason}`); }
export function walkFail(reason)              { reportInc('WALKER', `fail_${reason}`); }
export function walkOutputSyllables(n)        { reportInc('WALKER', 'outputSyllables', n); }

// ── Walker POS ──
export function walkPosStepHit(root, step)    { reportPosTreeHitRoot('WALKER_POS', root, step); reportPosTreeGlobal('WALKER_POS', step, 'hit'); }
export function walkPosStepEmpty(root, step)  { reportPosTreeEmptyRoot('WALKER_POS', root, step); reportPosTreeGlobal('WALKER_POS', step, 'empty'); }
export function walkPosQuit(reason)           { reportInc('WALKER_POS', `quit_${reason}`); }
export function walkPosFail(reason)           { reportInc('WALKER_POS', `fail_${reason}`); }
export function walkPosOutputSyllables(n)     { reportInc('WALKER_POS', 'outputSyllables', n); }
export function walkPosWordCount(n)           { reportInc('WALKER_POS', 'wordCount', n); }
export function walkPosTag(tag)               { reportInc('WALKER_POS', `tag_${tag}`); }

// ── Readable ──
export function rdblBroken(n)                 { reportInc('READABLE', 'broken', n); }
export function rdblFixed(n)                  { reportInc('READABLE', 'fixed', n); }
export function rdblScanResult(type, count)   { reportInc('READABLE', `scan_${type}`, count); }

// ── Composer ──
export function compClusterNormal(n)          { reportInc('COMPOSER', 'clusterNormal', n); }
export function compClusterNgaasat(n)         { reportInc('COMPOSER', 'clusterNgaasat', n); }

// ── Decomposer (mirror) ──
export function decompClusterNormal(n)        { reportInc('DECOMPOSER', 'clusterNormal', n); }
export function decompClusterNgaasat(n)       { reportInc('DECOMPOSER', 'clusterNgaasat', n); }

// ═══════════════════════════════════════════════════════════════
// DEBUG LOG (kept for compat)
// ═══════════════════════════════════════════════════════════════
const DEBUG_LOG = path.join(LogFile(), 'normalize-debug.log');

export function debugLogInit() {
  if (!_debug) return;
  try {
    fs.writeFileSync(DEBUG_LOG, `--- ${isoTs()} ---\n`, 'utf8');
  } catch {} // eslint-disable-line no-empty -- best-effort cleanup
}

export function debugLogPass(label, text) {
  if (!_debug) return;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('CONJUNCTIONS') || line.includes('VERBS') || line.includes('w')) {
      try {
        fs.appendFileSync(DEBUG_LOG, `${label} L${i}: ${line.slice(0, 120)}\n`, 'utf8');
      } catch {} // eslint-disable-line no-empty -- best-effort cleanup
    }
  }
}

export function flushWalkerBuffer() {}
export function flushTaggerBuffer() {}
export function flushAll() {}

export function log(...args) {
  const msg = args.map(a => typeof a === 'object' ? ss(a) : String(a)).join(' ');
  emitLog('SYSTEM', 'info', 'log', { msg }, true);
}

export default {
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
