/*
(Repair 1) Repair branch, position 1 in the chain - the first repair step after Parser output is written.
This module scans finished text for broken spans (impossible Myanmar pairs and similar damage) using the Engine's POS verdicts, and reports the broken lines with their page references.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { bindEngine as engineBind, MAX_LINE_BYTES } from "./bind-engine.js";
import { textLines } from "../@core/runtime/finalized-cmap.js";
import { INDEX_BASES, MARKS as MM_MARKS } from "../@rule/mm-score.js";

// Do not read the Engine master or build a dictionary matcher to validate
// words. Hand the text object to the extend bind-engine and keep the
// Engine's actual tagged output; segmentation happens inside the Engine.












// Structural-scan data stays in code: POS tagging is not done here at all.
// BindEngine (via extend/bind-engine) returns the Engine's tagged output;
// this file only keeps the small structural rules used to spot damage.

const SPLIT = /[\s\u104a\u104b()\x5b\x5d"‘’“”,\x2e:;?!/=+_—-]+/u;
const DIGIT = /^[\u1040-\u1049]$/u;

const BASES = new Set(INDEX_BASES);
for (const ch of ["\u1022", "\u1025"]) BASES.add(ch);
const EXTRA_BASES = new Set(["\u1022", "\u1023", "\u1024", "\u1026", "\u1028", "\u1029", "\u102a", "\u103f"]);
const PLACEHOLDER_BASES = new Set(["-", "_", "\u2013", "\u2014"]);
const STRAY_MARKS = new Set([..."\u102b\u102c\u102d\u102e\u102f\u1030\u1031\u1032\u1036\u1037\u1038\u1039\u103a\u103b\u103c\u103d\u103e"]);
const LETTER_OR_MARK_SET = new Set([...BASES, ...STRAY_MARKS]);
const LETTER_OR_MARK = (ch) => LETTER_OR_MARK_SET.has(ch);







const MARKS = new Set([...MM_MARKS, ...STRAY_MARKS]);

const IMPOSSIBLE = [
  [/\u1036\u103a/gu, "\u1036 + \u103a"],
  [/\u1032[\u102c\u102b]/gu, "\u1032 + \u102c/\u102b"],
  [/\u1032[\u102f\u1030]/gu, "\u1032 + \u102f/\u1030"],
  [/[\u102d\u102e][\u102c\u102b]/gu, "\u102d/\u102e + \u102c/\u102b"],
  [/[\u102c\u102b][\u102c\u102b]/gu, "doubled \u102c/\u102b"],
  [/\u103a[\u103b\u103c\u103d\u103e]/gu, "\u103a + medial"],
  [/\u1004\u103a\u1039(?![\u1000-\u1021])/gu, "kinzi with nothing to sit on"],
];

// Stray or lone marks can be technically misspelled yet used intentionally to
// capture specific pronunciations across languages and names. Dictionary-based
// matching alone cannot distinguish loanwords or names from parsing errors;
// consider the density and sequence of error tags instead.
export function countImpossiblePairs(text) {
  const input = String(text ?? "");
  let total = 0;
  for (const [pattern] of IMPOSSIBLE) {
    pattern.lastIndex = 0;
    for (const _match of input.matchAll(pattern)) total += 1;
  }
  return total;
}

function isBase(ch) {
  return BASES.has(ch) || EXTRA_BASES.has(ch) || PLACEHOLDER_BASES.has(ch);
}

function words(text) {
  const result = [];
  let offset = 0;
  for (const token of text.split(SPLIT)) {
    if (!token) continue;
    const start = text.indexOf(token, offset);
    result.push([token, start < 0 ? offset : start]);
    offset = (start < 0 ? offset : start) + token.length;
  }
  return result;
}

function clusterAt(text, index, span = 9) {
  let start = index;
  while (start > 0 && !SPLIT.test(text[start - 1])) start -= 1;
  let end = index;
  while (end < text.length && !SPLIT.test(text[end])) end += 1;
  return text.slice(start, end).slice(0, span * 3) || text[index];
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function findOrphans(text) {
  const hits = [];
  let attached = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (isBase(ch)) attached = true;
    else if (MARKS.has(ch)) { if (!attached) hits.push(i); }
    else attached = false;
  }
  return hits;
}

function findStray(text) {
  return words(text).filter(([token]) => [...token].every((ch) => STRAY_MARKS.has(ch))).map(([, i]) => i);
}

function findRepeat(text) {
  const hits = [];
  const re = /([\u1000-\u109f]{2,4})\1{2,}/gu;
  for (const match of text.matchAll(re)) hits.push(match.index);
  return hits;
}

function findDigits(text) {
  const hits = [];
  for (let i = 1; i < text.length - 1; i += 1) {
    if (DIGIT.test(text[i]) && LETTER_OR_MARK(text[i - 1]) && LETTER_OR_MARK(text[i + 1])) hits.push(i);
  }
  return hits;
}

function findVirama(text) {
  const hits = [];
  for (const match of text.matchAll(/္(?![က-ဧ])/gu)) hits.push(match.index);
  return hits;
}

const RULES = [
  ["orphan", "a dependent mark with no base in front of it", findOrphans],
  ["impossible", "a pair Burmese cannot write in one syllable", (text) => IMPOSSIBLE.flatMap(([re]) => [...text.matchAll(re)].map((m) => m.index))],
  ["stray", "a token made only of marks", findStray],
  ["repeat", "the same syllable printed 3+ times", findRepeat],
  ["digit", "a digit with Myanmar letters on both sides", findDigits],
  ["virama", "U+1039 with nothing stacked after it", findVirama],
];

function reportClusters(text, hits, limit) {
  const grouped = new Map();
  for (const index of hits) {
    const cluster = clusterAt(text, index);
    const item = grouped.get(cluster) || { count: 0, index };
    item.count += 1;
    grouped.set(cluster, item);
  }
  return [...grouped.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, limit)
    .map(([cluster, item]) => {
      const lineStart = text.lastIndexOf("\n", item.index - 1) + 1;
      const nextBreak = text.indexOf("\n", item.index);
      const lineEnd = nextBreak < 0 ? text.length : nextBreak;
      const fullLine = text.slice(lineStart, lineEnd).trim();
      return {
        cluster,
        count: item.count,
        line: lineNumber(text, item.index),
        context: fullLine.length > 160 ? `${fullLine.slice(0, 157)}...` : fullLine,
      };
    });
}

// scanText / scanBrokenSpans are the beautify step's string scan: a
// sliding-window walk over raw characters. The POS scan further below
// (scanLineWithPos / scanTextWithPos) is the next chain's scan: it
// reads Engine (BindEngine POS) output and only hunts the word{F}
// unknown tokens there. Do not merge these two phases - they scan
// different things on purpose.
export function scanText(text, { perRule = 25 } = {}) {
  const report = {};
  for (const [key, title, finder] of RULES) {
    const hits = finder(text);
    report[key] = { total: hits.length, distinct: new Set(hits.map((i) => clusterAt(text, i))).size, title, clusters: reportClusters(text, hits, perRule) };
  }
  return report;
}



function tokenSpanAt(text, index) {
  let start = index;
  while (start > 0 && !SPLIT.test(text[start - 1])) start -= 1;
  let end = index;
  while (end < text.length && !SPLIT.test(text[end])) end += 1;
  return [start, end];
}













export function scanBrokenSpans(text, {
  rules = ["orphan", "impossible", "stray", "virama"],
} = {}) {
  const wanted = new Set(rules);
  const hits = [];
  for (const [key, , finder] of RULES) {
    if (!wanted.has(key)) continue;
    for (const index of finder(text)) hits.push([key, index]);
  }
  const bySpan = new Map();
  for (const [rule, index] of hits) {
    const [start, end] = tokenSpanAt(text, index);
    const key = `${start}:${end}`;
    const item = bySpan.get(key) || { start, end, token: text.slice(start, end), rules: new Set() };
    item.rules.add(rule);
    bySpan.set(key, item);
  }
  return [...bySpan.values()]
    .map(({ rules: rs, ...rest }) => ({ ...rest, rules: [...rs] }))
    .sort((a, b) => a.start - b.start);
}

export function formatScanReport(report, { source = "", totalChars = 0 } = {}) {
  const out = ["=".repeat(78), `parser scan${source ? `  ${source}` : ""}`, ...(totalChars ? [`${totalChars.toLocaleString()} characters`] : []), "=".repeat(78), "", "rule              hits  distinct   what it means"];
  for (const [key, value] of Object.entries(report)) out.push(`${key.padEnd(16)}${String(value.total).padStart(6)}${String(value.distinct).padStart(10)}   ${value.title}`);
  for (const [key, value] of Object.entries(report)) {
    if (!value.clusters.length) continue;
    out.push("", `[${key}]`);
    for (const item of value.clusters) {
      out.push(`  cluster: ${item.cluster}  (${item.count} hit(s), line ${item.line})`);
      if (item.context) out.push(`    context: ${item.context}`);
    }
  }
  return `${out.join("\n")}\n`;
}









export { RULES };

// Change this one value if a book needs a shorter page-number heuristic.
export const MAX_PAGE_NUMBER_DIGITS = 4;
const NON_WORD_TAGS = new Set(['pan', 'eos', 'en', 'count', 'phone', 'addr', 'year', 'exactdate', 'page number', 'page marker']);
const TAGGED_TOKEN = /^(.*?)\{([^{}]+)\}$/u;
const PAGE_MARKER = /^\s*(?:-{2,}\s*)?page\s*[-:]?\s*([0-9၀-၉]+)\s*(?:-{2,})?\s*$/iu;

function pageNumber(value) {
  const digits = String(value).replace(/[၀-၉]/gu, (ch) => String('၀၁၂၃၄၅၆၇၈၉'.indexOf(ch)));
  const result = Number(digits);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export function isPageNumberLine(value) {
  const line = String(value ?? '').trim();
  return /^[0-9၀-၉]+$/u.test(line) && line.length <= MAX_PAGE_NUMBER_DIGITS;
}

function posSourceLine(source) {
  // The Engine mapper also treats Latin letters as internal syllable codes.
  // Do not misreport English as Burmese unknowns; retain the untouched source
  // line in the report and let the Engine classify the remaining text.
  if (!/\p{Script=Myanmar}/u.test(source) && !/^[\s0-9.,/+\-]+$/u.test(source)) return '';
  return source.replace(/\p{Script=Latin}+/gu, ' ');
}

export function parseTaggedLine(raw) {
  return raw.split('  ').map((part) => part.trim()).filter(Boolean).map((formatted) => {
    const match = TAGGED_TOKEN.exec(formatted);
    if (!match) return { formatted, word: formatted, tags: [], kind: 'other' };
    const tags = match[2].split(',').map((tag) => tag.trim()).filter(Boolean);
    const unknown = tags.length === 1 && tags[0] === 'F';
    const word = tags.some((tag) => tag !== 'F' && !NON_WORD_TAGS.has(tag));
    return { formatted, word: match[1], tags, kind: unknown ? 'unknown' : word ? 'known' : 'other' };
  });
}

export async function tagPosLine(sourceText, bindEngine = null) {
  const bind = bindEngine ?? engineBind;
  const tagged = bind({ flag: 'pos', sourceText, log: false });
  let rawPos = '';
  for await (const unit of tagged) {
    if (typeof unit?.rawPos !== 'string') throw new TypeError('Engine POS output must include rawPos');
    if (rawPos) rawPos += '  ';
    rawPos += unit.rawPos;
  }
  return rawPos;
}

// Scan owns the BindEngine call: callers hand it one source line and consume
// the parsed POS tokens back. Page furniture and lines with no POS input are
// classified here so repair can scan per line without re-deciding them.
export async function scanLineWithPos(source, { bindEngine = null } = {}) {
  const line = String(source ?? '');
  if (isPageNumberLine(line)) {
    const rawPos = `${line.trim()}{page number}`;
    return { rawPos, tokens: parseTaggedLine(rawPos), skipped: 'page-number' };
  }
  if (PAGE_MARKER.test(line)) {
    const rawPos = `${line.trim()}{page marker}`;
    return { rawPos, tokens: parseTaggedLine(rawPos), skipped: 'page-marker' };
  }
  const input = posSourceLine(line);
  if (!input.trim()) return { rawPos: '', tokens: [], skipped: 'no-pos-input' };
  const rawPos = await tagPosLine(input, bindEngine);
  return { rawPos, tokens: parseTaggedLine(rawPos), skipped: null };
}

function unknownContexts(tokens) {
  const results = [];
  for (let i = 0; i < tokens.length;) {
    if (tokens[i].kind !== 'unknown') { i += 1; continue; }
    let end = i + 1;
    while (end < tokens.length && tokens[end].kind === 'unknown') end += 1;
    const before = [];
    for (let p = i - 1; p >= 0 && before.length < 2; p -= 1) {
      if (tokens[p].kind === 'known') before.unshift(tokens[p]);
    }
    const after = [];
    const wantedAfter = end - i > 1 ? 2 : 1;
    for (let p = end; p < tokens.length && after.length < wantedAfter; p += 1) {
      if (tokens[p].kind === 'known') after.push(tokens[p]);
    }
    results.push({
      count: end - i,
      context: [...before, ...tokens.slice(i, end), ...after].map((token) => token.formatted).join('  '),
    });
    i = end;
  }
  return results;
}

function writeAll(fd, value) {
  const bytes = Buffer.from(value, 'utf8');
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) throw new Error('Could not write the POS scan file');
    offset += count;
  }
}

async function* readRecords(file) {
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line) yield JSON.parse(line);
  } finally {
    lines.close();
    input.destroy();
  }
}

// The normalized output is written to this private spool while the real
// output writer runs. Only after that writer finishes does scan read the
// spool back and send each line through the hash-free POS bridge.
export class PosScanner {
  constructor({ directory = os.tmpdir(), bindEngine = null } = {}) {
    this.directory = fs.mkdtempSync(path.join(directory, 'linga-pos-scan-'));
    fs.chmodSync(this.directory, 0o700);
    this.file = path.join(this.directory, 'pages.txt');
    try {
      this.fd = fs.openSync(this.file, 'wx', 0o600);
    } catch (error) {
      fs.rmSync(this.directory, { recursive: true, force: true });
      throw error;
    }
    this.binding = bindEngine;
    this.closed = false;
    this.complete = false;
    this.unpagedStarted = false;
    // Only broken scan results are retained: one entry per unknown-token
    // context, with its page and line. Tagged lines are consumed and dropped.
    this.memory = [];
  }

  async writePage(page, chunks) {
    if (this.closed || this.complete) throw new Error('POS scanner is closed');
    if (page !== null && (!Number.isInteger(page) || page < 1)) throw new TypeError('Expected a positive page number or null');
    if (page !== null || !this.unpagedStarted) {
      writeAll(this.fd, `${JSON.stringify({ type: 'page', page, marker: page === null ? null : `--- Page ${page} ---` })}\n`);
      this.unpagedStarted = page === null;
    }
    for (const line of textLines(chunks)) {
      writeAll(this.fd, `${JSON.stringify({ type: 'line', text: line })}\n`);
    }
  }

  // Read the normalized-output spool back, hand each line to BindEngine,
  // consume its tagged output, and scan that output immediately. Only the
  // broken unknown-token contexts survive, in this.memory as
  // { page, line, context, count }; all other tagged lines are dropped.
  async finish() {
    if (this.complete || this.closed) throw new Error('POS scanner is closed');
    this.complete = true;
    try {
      fs.closeSync(this.fd);
      this.fd = null;
      this.memory = [];
      const longLines = [];
      const ranges = [];
      let physicalPage = false;
      let page = null;
      let lineNumber = 0;
      let sequence = 0;
      let unpagedFirst = null;
      let unknownCount = 0;

      for await (const record of readRecords(this.file)) {
        if (record.type === 'page') {
          page = record.page;
          physicalPage = page !== null;
          lineNumber = 0;
          unpagedFirst = null;
          continue;
        }
        const source = record.text;
        const marker = PAGE_MARKER.exec(source);
        if (marker && !physicalPage) {
          page = pageNumber(marker[1]);
          lineNumber = 0;
          continue;
        }
        lineNumber += 1;
        sequence += 1;
        const numericPage = isPageNumberLine(source);
        const numericValue = numericPage ? pageNumber(source.trim()) : null;
        // In unpaged text, a short numeric footer names the lines before
        // it. Remember that range while streaming; only the retained
        // broken entries are resolved against it afterwards.
        if (!physicalPage && page === null) {
          unpagedFirst ??= sequence;
          if (numericValue !== null) {
            ranges.push({ first: unpagedFirst, last: sequence, page: numericValue });
            unpagedFirst = null;
          }
        }
        const needsFallback = !physicalPage && page === null;
        if (Buffer.byteLength(source, 'utf8') > MAX_LINE_BYTES) {
          longLines.push({ page, line: lineNumber, sequence, needsFallback });
        }
        let rawPos = '';
        if (numericPage) {
          rawPos = `${source.trim()}{page number}`;
        } else if (marker) {
          rawPos = `${source.trim()}{page marker}`;
        } else {
          const input = posSourceLine(source);
          if (input.trim()) {
            this.binding ??= engineBind;
            rawPos = await tagPosLine(input, this.binding);
          }
        }
        for (const hit of unknownContexts(parseTaggedLine(rawPos))) {
          unknownCount += hit.count;
          this.memory.push({
            page, line: lineNumber, sequence, needsFallback,
            context: hit.context, count: hit.count,
          });
        }
      }

      const resolveFallback = (entry) => {
        if (!entry.needsFallback) return;
        const range = ranges.find((r) => entry.sequence >= r.first && entry.sequence <= r.last);
        if (range) {
          entry.page = range.page;
          entry.line = entry.sequence - range.first + 1;
        }
      };
      for (const entry of this.memory) resolveFallback(entry);
      for (const entry of longLines) resolveFallback(entry);
      for (const entry of [...this.memory, ...longLines]) {
        delete entry.sequence;
        delete entry.needsFallback;
      }
      return {
        memory: this.memory,
        unknownCount,
        contextCount: this.memory.length,
        longLines,
      };
    } finally {
      await this.close();
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.fd !== null) fs.closeSync(this.fd);
    this.fd = null;
    fs.rmSync(this.directory, { recursive: true, force: true });
  }
}

export async function scanTextWithPos(text, { page = null, directory, bindEngine } = {}) {
  const scanner = new PosScanner({ directory, bindEngine });
  try {
    await scanner.writePage(page, [String(text ?? '')]);
    return await scanner.finish();
  } finally {
    await scanner.close();
  }
}
