/*
(Rule support) The low-level token walker (mm-score). It walks Burmese
text token by token, mark by mark, and judges structure strictly: a
dependent mark must attach to a base, must not repeat on one base, and
must follow the permitted order. Broken text is rejected here - low
score, disorder counted, order unaligned - even though that same text
is still Burmese to the decision maker in judgement.js; telling
Burmese from English is judgement's only job, not this module's.
The marks and their permitted order load from mm-score.json in
@jason-map. This module never rewrites text.
*/
import { loadMapJson } from "../@core/runtime/json-map.js";

const SPACE_SEPARATOR = /^\p{Zs}$/u;

// Burmese index (base consonant) characters — used to identify syllable bases.
export const INDEX_BASES = new Set();
for (let cp = 0x1000; cp <= 0x1021; cp += 1) INDEX_BASES.add(String.fromCodePoint(cp));
for (let cp = 0x1023; cp <= 0x1027; cp += 1) INDEX_BASES.add(String.fromCodePoint(cp));
INDEX_BASES.add("\u1029"); INDEX_BASES.add("\u102a"); INDEX_BASES.add("\u103f"); INDEX_BASES.add("\u104e");

export function isIndex(ch) {
  return INDEX_BASES.has(ch);
}

// The Engine's own slot order; the reorder code (clean.js) reads it as
// its priority table. Deliberately NOT the mm-score order and NOT
// Unicode 16 table 16-4 (UNICODE_MARK_ORDER below): the three orders
// exist on purpose and must never be merged.
export const MARK_ORDER = new Map([
  ["\u1030", 1], ["\u1031", 2], ["\u102f", 3], ["\u102e", 4],
  ["\u1032", 5], ["\u1033", 6], ["\u1034", 7], ["\u1035", 8],
  ["\u1036", 9], ["\u102d", 10], ["\u102c", 11], ["\u102b", 12],
  ["\u1014", 13], ["\u103a", 14], ["\u102f", 15], ["\u1037", 16],
  ["\u1038", 17], ["\u1019", 18], ["\u103b", 19], ["\u103c", 20],
  ["\u103d", 21], ["\u103e", 22],
]);

export const MARKS = new Set(MARK_ORDER.keys());

const MM_SCORE = loadMapJson("mm-score.json");
const SCORE_MARKS = new Set(MM_SCORE.marks);
const SCORE_MARK_ORDER = new Map(Object.entries(MM_SCORE.priority));

const ASAT = "\u103a";

function isUnicodeBase(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || (cp >= 0x1023 && cp <= 0x1027)
    || cp === 0x1029 || cp === 0x102a || cp === 0x103f || cp === 0x104e;
}

// Unicode 16, table 16-4: the modern Burmese syllable order used to judge
// whether a page's mark order is already aligned. Characters on the same
// row share a priority. This is deliberately separate from MARK_ORDER
// above, which is the Engine's own slot order used by the reorder code.
const UNICODE_MARK_ORDER = new Map([
  ["ျ", 1], ["ြ", 2], ["ွ", 3], ["ှ", 4],
  ["ေ", 5], ["ိ", 6], ["ီ", 6], ["ဲ", 6],
  ["ု", 7], ["ူ", 7], ["ါ", 8], ["ာ", 8],
  ["ံ", 9], ["့", 10], ["း", 11],
]);
// --- mm-score -------------------------------------------------------------
// Port of the Python mm_score.score_text: how much a decoded string reads
// like real Burmese, measured structurally — dependent marks must attach
// to a base, must not repeat on one base, and must follow in a permitted
// order. Only the *relative* score between candidate decodings of the same
// source bytes is meaningful. This never rewrites text.
function scoreIsIndex(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027;
}

function* scoreWalk(text) {
  let attached = false;
  let run = [];
  for (const ch of text) {
    const mark = SCORE_MARKS.has(ch);
    yield [ch, attached, run];
    if (scoreIsIndex(ch)) { attached = true; run = []; }
    else if (mark) { if (attached) run.push(ch); }
    else { attached = false; run = []; }
  }
}

export function scoreText(text) {
  const sample = String(text ?? "");
  let marks = 0;
  let myanmar = 0;
  for (const ch of sample) {
    if (SCORE_MARKS.has(ch)) marks += 1;
    const cp = ch.codePointAt(0);
    if (cp >= 0x1000 && cp <= 0x109f) myanmar += 1;
  }
  const myanmarRatio = sample.length ? myanmar / sample.length : 0;
  if (!marks) {
    return { score: 0, orphan: 0, disorder: 0, duplicate: 0, marks: 0, myanmarRatio };
  }
  let markTotal = 0;
  let orphans = 0;
  let attachedTotal = 0;
  let duplicates = 0;
  for (const [ch, attached, run] of scoreWalk(sample)) {
    if (!SCORE_MARKS.has(ch)) continue;
    markTotal += 1;
    if (!attached) orphans += 1;
    else {
      attachedTotal += 1;
      if (run.includes(ch)) duplicates += 1;
    }
  }
  let pairs = 0;
  let disordered = 0;
  let run = null;
  for (const ch of sample) {
    if (scoreIsIndex(ch)) { run = []; continue; }
    if (SCORE_MARKS.has(ch)) {
      if (run !== null) {
        run.push(ch);
        if (run.length > 1) {
          pairs += 1;
          if (SCORE_MARK_ORDER.get(run[run.length - 2]) > SCORE_MARK_ORDER.get(run[run.length - 1])) disordered += 1;
        }
      }
      continue;
    }
    run = null;
  }
  const orphan = markTotal ? orphans / markTotal : 0;
  const disorder = pairs ? disordered / pairs : 0;
  const duplicate = attachedTotal ? duplicates / attachedTotal : 0;
  return {
    score: 1 - Math.max(orphan, disorder),
    orphan, disorder, duplicate, marks, myanmarRatio,
  };
}

export function markOrderAligned(text) {
  let attached = false;
  let precedingMarks = false;
  let previous = -1;
  for (const ch of String(text ?? "")) {
    if (ch === " " || SPACE_SEPARATOR.test(ch)) continue;
    if (isUnicodeBase(ch)) {
      if (!attached && precedingMarks) return false;
      attached = true;
      precedingMarks = false;
      previous = -1;
      continue;
    }
    if (ch === ASAT || UNICODE_MARK_ORDER.has(ch)) {
      if (!attached) {
        precedingMarks = true;
        continue;
      }
      // Asat can follow the consonant, medial ya, or aa; NFC can also place
      // it after dot below. It therefore retains the preceding position.
      if (ch === ASAT) {
        if (previous < 0) previous = 0;
        continue;
      }
      const priority = UNICODE_MARK_ORDER.get(ch);
      if (priority < previous) return false;
      previous = priority;
      continue;
    }
    attached = false;
    precedingMarks = false;
    previous = -1;
  }
  return true;
}
