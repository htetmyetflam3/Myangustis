import { containsMyanmar } from "../detect.js";

const LATIN_LIKE = /^[\x20-\xff\p{Script=Latin}\p{Number}\p{Punctuation}\p{Symbol}\s]+$/u;
const PAGE_NUMBER = /^(?:[0-9]{1,4}|(?:page\s*[|:#-]?\s*[0-9]{1,4}\s*)+)$/iu;
const SPACE_SEPARATOR = /^\p{Zs}$/u;

// Burmese index (base consonant) characters — used to identify syllable bases.
export const INDEX_BASES = new Set();
for (let cp = 0x1000; cp <= 0x1021; cp += 1) INDEX_BASES.add(String.fromCodePoint(cp));
for (let cp = 0x1023; cp <= 0x1027; cp += 1) INDEX_BASES.add(String.fromCodePoint(cp));
INDEX_BASES.add("\u1029"); INDEX_BASES.add("\u102a"); INDEX_BASES.add("\u103f"); INDEX_BASES.add("\u104e");

export function isIndex(ch) {
  return INDEX_BASES.has(ch);
}

// Unicode 16, table 16-4: the modern Burmese syllable order. Characters on
// the same row have the same priority; this is not the Engine's own order.
export const MARK_ORDER = new Map([
  ["\u1030", 1], ["\u1031", 2], ["\u102f", 3], ["\u102e", 4],
  ["\u1032", 5], ["\u1033", 6], ["\u1034", 7], ["\u1035", 8],
  ["\u1036", 9], ["\u102d", 10], ["\u102c", 11], ["\u102b", 12],
  ["\u1014", 13], ["\u103a", 14], ["\u102f", 15], ["\u1037", 16],
  ["\u1038", 17], ["\u1019", 18], ["\u103b", 19], ["\u103c", 20],
  ["\u103d", 21], ["\u103e", 22],
]);

export const MARKS = new Set(MARK_ORDER.keys());

// One-sided English check over Latin text: it can confirm that text reads
// as English, and it can flag Latin layout junk (legacy keyboard bytes read
// as Latin), but with too little evidence it abstains (verdict: null).
// A "violation" is a word English does not produce: no vowel in a word of
// 3+ letters, a lower->Upper case seam inside a word, or a 3+ repeated
// letter. Real English prose violates rarely; WinInnwa byte junk violates
// constantly.
export function englishLikeness(text) {
  const sample = String(text ?? "");
  const words = sample.match(/[A-Za-z]+(?:'[A-Za-z]+)?/gu) || [];
  const letters = words.reduce((sum, word) => sum + word.replace(/'/gu, "").length, 0);
  const hasSpaces = /\s/u.test(sample.trim());
  const base = { score: 0, letters, runs: words.length, hasSpaces, violationRate: 0 };
  if (letters < 8 || !words.length) return { verdict: null, ...base };
  let violations = 0;
  for (const word of words) {
    const plain = word.replace(/'/gu, "");
    if (plain.length >= 3 && !/[aeiou]/iu.test(plain)) violations += 1;
    else if (/[a-z][A-Z]/u.test(plain)) violations += 1;
    else if (/([A-Za-z])\1\1/u.test(plain)) violations += 1;
    else if (/[^aeiou\s]{4,}/iu.test(plain)) violations += 1;
  }
  const violationRate = violations / words.length;
  const score = 1 - violationRate;
  // English body text is spaced words. One unbroken Latin run — however
  // dictionary-like — is not body text and must not confirm English.
  if (!hasSpaces) return { verdict: "not-english", score, letters, runs: words.length, hasSpaces, violationRate };
  // Two short words are not enough evidence either way.
  if (words.length < 3) return { verdict: null, score, letters, runs: words.length, hasSpaces, violationRate };
  const verdict = violationRate <= 0.34 ? "english" : "not-english";
  return { verdict, score, letters, runs: words.length, hasSpaces, violationRate };
}

// --- mm-score -------------------------------------------------------------
// Port of the Python mm_score.score_text: how much a decoded string reads
// like real Burmese, measured structurally — dependent marks must attach
// to a base, must not repeat on one base, and must follow in a permitted
// order. Only the *relative* score between candidate decodings of the same
// source bytes is meaningful. This never rewrites text.
const SCORE_MARKS = new Set([
  "\u103b", "\u103c", "\u103d", "\u103e", "\u1031", "\u102d", "\u102e", "\u102f",
  "\u1030", "\u1032", "\u102c", "\u102b", "\u1036", "\u103a", "\u1037", "\u1038",
]);
const SCORE_MARK_ORDER = new Map([
  ["\u103b", 1], ["\u103c", 2], ["\u103d", 3], ["\u103e", 4], ["\u1031", 5],
  ["\u102d", 6], ["\u102e", 7], ["\u102f", 8], ["\u1030", 9], ["\u1032", 10],
  ["\u102c", 11], ["\u102b", 12], ["\u1036", 13], ["\u103a", 14], ["\u1037", 15],
  ["\u1038", 16], [" ", 17], ["\n", 18],
]);

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

function onlyPageNumbers(text) {
  const lines = text.split(/[\r\n]+/u).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => PAGE_NUMBER.test(line));
}

function onlyNonBodyHeader(text) {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}[\p{P}\s]*$/iu.test(compact)) return true;
  if (/^(?:typing|typed\s+by|scanned\s+by|transcribed\s+by|prepared\s+by|uploaded\s+by)\s*[-:|]\s*[a-z0-9_.-]{1,40}(?:\s+\d{1,4})*[\p{P}\s]*$/iu.test(compact)) return true;
  const address = /\b(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,24}(?:\/[^()]*)?/giu;
  let found = false;
  const rest = compact.replace(address, () => { found = true; return " "; });
  if (!found || [...rest].some((char) => char.codePointAt(0) > 0x7f) || /[\/\\]|\d{5}/u.test(rest)) return false;
  const words = (rest.match(/[a-z]+/giu) || [])
    .filter((word) => word.length > 1 && word.toLowerCase() !== "page");
  return words.length === 0 || (words.length <= 2
    && words.every((word) => /^[A-Z][a-z]{1,15}$/u.test(word) && /[aeiou]/iu.test(word)));
}

export function correctWorldWord(text, zawgyiEvidence = false) {
  return zawgyiEvidence ? text.replace(/\u1000(?:\u101a\u103c\u103c|\u101a\u103c)/gu, "\u1000\u101a\u103c") : text;
}

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

// --- normalize.js functions (moved here; normalize.js deleted) ---

const FORMAT_CHARACTER = /^\p{Cf}$/u;
const WHITESPACE = /^\s$/u;
const ZERO_WIDTH_SPACE = "\u200b";

function needsProtection(ch) {
  if (ch === ZERO_WIDTH_SPACE) return false;
  return WHITESPACE.test(ch) || FORMAT_CHARACTER.test(ch);
}

function isFormatCharacter(ch) {
  return ch !== ZERO_WIDTH_SPACE && (ch === "\u034f" || FORMAT_CHARACTER.test(ch));
}

export function protectedCharacters(value) {
  let out = "";
  for (const ch of String(value ?? "")) {
    if (needsProtection(ch)) out += ch;
  }
  return out;
}

export function preserveCharacters(text, transform) {
  const input = String(text ?? "");
  if (typeof transform !== "function") throw new TypeError("Expected a text transformation");
  let hasProtected = false;
  for (const ch of input) {
    if (isFormatCharacter(ch)) { hasProtected = true; break; }
  }
  if (!hasProtected) return transform(input);

  let prefix = "\ue000";
  while (input.includes(prefix)) prefix += "\ue000";
  const suffix = "\ue001";
  const preserved = [];
  let masked = "";
  for (const ch of input) {
    if (isFormatCharacter(ch)) {
      masked += `${prefix}${preserved.length}${suffix}`;
      preserved.push(ch);
    } else masked += ch;
  }

  const transformed = transform(masked);
  const pattern = new RegExp(`${prefix}([0-9]+)${suffix}`, "gu");
  let restored = 0;
  const result = transformed.replace(pattern, (token, index) => {
    const value = preserved[Number(index)];
    if (value === undefined) return token;
    restored += 1;
    return value;
  });
  if (restored !== preserved.length) throw new Error("Text transformation could not preserve zero-width characters");
  return result;
}

export function* normalizePageLines(text, normalize) {
  if (typeof normalize !== "function") throw new TypeError("Expected Engine normalize function");
  const input = String(text ?? "");
  let start = 0;
  while (true) {
    const end = input.indexOf("\n", start);
    if (end < 0) {
      yield normalize(input.slice(start));
      return;
    }
    yield normalize(input.slice(start, end));
    start = end + 1;
  }
}

export function normalizeOutputText(text, normalize) {
  return [...normalizePageLines(text, normalize)].join("\n");
}

