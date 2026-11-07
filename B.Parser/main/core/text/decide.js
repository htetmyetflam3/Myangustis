import { containsMyanmar } from "./detect.js";
import { withoutZeroWidthSpace } from "./zero-width.js";

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

export function englishLikeness(text) {
  if (!text || !text.trim()) return { verdict: "not-english", score: 0 };
  const latin = [...text].filter(ch => /^[\x20-\xff\p{Script=Latin}\p{Number}\p{Punctuation}\s]$/u.test(ch));
  const ratio = latin.length / text.length;
  return {
    verdict: ratio >= 0.7 ? "english" : "not-english",
    score: ratio,
  };
}

export function scoreText(text) {
  if (!text || !text.trim()) return { score: 0, marks: 0 };
  let marks = 0;
  for (const ch of text) {
    if (MARKS.has(ch)) marks += 1;
  }
  const markRatio = marks / text.length;
  return { score: markRatio, marks };
}

function onlyPageNumbers(text) {
  const lines = text.split(/[\r\n]+/u).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => PAGE_NUMBER.test(line));
}

function onlyNonBodyHeader(text) {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}[\p{P}\s]*$/iu.test(compact)) return true;
  if (/^(?:typing|typed\s+by|scanned\s+by|transcribed\s+by|prepared\s+by|uploaded\s+by)\s*[-:|]\s*[a-z0-9_.-]{1,40}(?:\s+\d{1,4})*[\p{P}\s]*$/iu.test(compact)) return true;
  const address = /\b(?:(?:https?:\/\/)www\.)[^\s]+|(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,24}(?:\/[^()]*)?/giu;
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

export function choosePageParser(probe, { sourceEncoding = "auto" } = {}) {
  if (sourceEncoding === "unicode" || sourceEncoding === "zawgyi-one") {
    return { parser: "zawgyi-one", reason: "source-encoding" };
  }
  const text = withoutZeroWidthSpace(probe?.shared);
  if (!text.trim()) return { parser: "zawgyi-one", reason: "no-checkpoint-text" };
  if (containsMyanmar(text)) return { parser: "zawgyi-one", reason: "myanmar" };
  if (onlyPageNumbers(text)) return { parser: "zawgyi-one", reason: "page-number-only" };
  if (probe?.alphaFooterOnly) return { parser: "zawgyi-one", reason: "page-letter-only" };
  if (onlyNonBodyHeader(text)) return { parser: "zawgyi-one", reason: "non-body-header" };
  if (LATIN_LIKE.test(text)) {
    const result = englishLikeness(text);
    return result.verdict === "english"
      ? { parser: "zawgyi-one", reason: "english", english: result.verdict }
      : { parser: "legacy", reason: "not-english", english: result.verdict };
  }
  return { parser: "zawgyi-one", reason: "other-script" };
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
    if (ch === ASAT || MARK_ORDER.has(ch)) {
      if (!attached) {
        precedingMarks = true;
        continue;
      }
      if (ch === ASAT) {
        if (previous < 0) previous = 0;
        continue;
      }
      const priority = MARK_ORDER.get(ch);
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

