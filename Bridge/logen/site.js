/**
 * FILE: logen/site.js
 *
 * THE SITE HALF. Everything the server logs, and nothing the engine does.
 *
 * It imports logen/core.js and adds only what this tree owns: the HTTP
 * badge set, the praser stages, and the one document-level event the site
 * emits. It does NOT know about normalize ledgers, syllable walks or
 * cross-module character reconciliation -- those are the engine's, and
 * they live in logen/engine.js on the branch that has those modules.
 *
 * Nothing here imports the engine half, and nothing in the engine half
 * imports this. Both import the core, which is identical in both trees.
 */
import path from 'node:path';
import core, {
  bus, registerBadges, installBase, emitLog, reportInc, record, runChecks, stage,
  appendFile, paint, palette as C,
} from './core.js';

export * from './core.js';

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

export const pipeline = stage('PIPELINE');
export const read = stage('READ');
export const text = stage('TEXT');
export const codepage = stage('CODEPAGE');
export const shape = stage('SHAPE');
export const write = stage('WRITE');
export const ocr = stage('OCR');
export const scan = stage('SCAN');
export const queue = stage('QUEUE');
export const manager = stage('MANAGER');
export const worker = stage('WORKER');

export const readPages = (n) => reportInc('READ', 'pages', n);
export const readFail = (reason) => reportInc('READ', `fail_${reason}`);
export const writeWrote = (n = 1) => reportInc('WRITE', 'filesWritten', n);
export const codepageChosen = (name, score) => {
  reportInc('CODEPAGE', 'chosen');
  emitLog('CODEPAGE', 'success', 'chosen', { name, score });
};
export const ocrPage = (n = 1) => reportInc('OCR', 'pages', n);
export const scanHit = (rule, n = 1) => reportInc('SCAN', `rule_${rule}`, n);

/* ── the site's events ───────────────────────────────────────────────── */

/**
 * Install the site's listeners. One per event the site emits -- today that
 * is 'parsed', because the queue record already holds everything else and
 * a reader can look it up.
 */
export function installPassiveLog({ file = '', checks = false } = {}) {
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
      ...(lines == null ? {} : { lines }),
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

export default {
  ...core,
  installPassiveLog,
  pipeline, read, text, codepage, shape, write, ocr, scan, queue, manager, worker,
  readPages, readFail, writeWrote, codepageChosen, ocrPage, scanHit,
};
