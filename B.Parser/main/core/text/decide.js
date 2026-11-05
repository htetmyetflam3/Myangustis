import { englishLikeness } from "./decide.js";
import { containsMyanmar } from "./detect.js";
import { withoutZeroWidthSpace } from "./zero-width.js";
export { normalizePageLines } from "./preserved-transform.js";

const LATIN_LIKE = /^[\x20-\xff\p{Script=Latin}\p{Number}\p{Punctuation}\p{Symbol}\s]+$/u;
const PAGE_NUMBER = /^(?:[0-9]{1,4}|(?:page\s*[|:#-]?\s*[0-9]{1,4}\s*)+)$/iu;
const SPACE_SEPARATOR = /^\p{Zs}$/u;

function onlyPageNumbers(text) {
  const lines = text.split(/[\r\n]+/u).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => PAGE_NUMBER.test(line));
}

// Headers and attribution marks are not evidence of the page body's layout.
// This recognizes generic forms rather than naming a particular website.
function onlyNonBodyHeader(text) {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}[\p{P}\s]*$/iu.test(compact)) return true;
  if (/^(?:typing|typed\s+by|scanned\s+by|transcribed\s+by|prepared\s+by|uploaded\s+by)\s*[-:|]\s*[a-z0-9_.-]{1,40}(?:\s+\d{1,4})*[\p{P}\s]*$/iu.test(compact)) return true;
  const address = /\b(?:(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,24}(?:\/[^\s]*)?)/giu;
  let found = false;
  const rest = compact.replace(address, () => { found = true; return " "; });
  if (!found || [...rest].some((char) => char.codePointAt(0) > 0x7f) || /[\\/]|\d{5}/u.test(rest)) return false;
  const words = (rest.match(/[a-z]+/giu) || [])
    .filter((word) => word.length > 1 && word.toLowerCase() !== "page");
  // At most two ordinary title-cased Latin words can accompany the address;
  // a longer or mixed-case run may be actual legacy keyboard text.
  return words.length === 0 || (words.length <= 2
    && words.every((word) => /^[A-Z][a-z]{1,15}$/u.test(word) && /[aeiou]/iu.test(word)));
}

// Repair the observed spelling of this word only when the page has Zawgyi
// evidence. A PDF's bracketed glyph codes are not word identities.
export function correctWorldWord(text, zawgyiEvidence = false) {
  return zawgyiEvidence ? text.replace(/က(?:မၻာ|မ်ဘာ)/gu, "ကမ္ဘာ") : text;
}

// Unicode 16, table 16-4: the modern Burmese syllable order. Characters on
// the same row have the same priority; this is not the Engine's own order.
const UNICODE_MARK_ORDER = new Map([
  ["ျ", 1], ["ြ", 2], ["ွ", 3], ["ှ", 4],
  ["ေ", 5], ["ိ", 6], ["ီ", 6], ["ဲ", 6],
  ["ု", 7], ["ူ", 7], ["ါ", 8], ["ာ", 8],
  ["ံ", 9], ["့", 10], ["း", 11],
]);
const ASAT = "\u103a";

function isUnicodeBase(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || (cp >= 0x1023 && cp <= 0x1027)
    || cp === 0x1029 || cp === 0x102a || cp === 0x103f || cp === 0x104e;
}

// The English-likeness checker owns its own thresholds. Extended Latin text
// is evaluated by the same checker rather than being called Burmese Unicode.
export function choosePageParser(probe, { sourceEncoding = "auto" } = {}) {
  if (sourceEncoding === "unicode" || sourceEncoding === "zawgyi-one") {
    return { parser: "zawgyi-one", reason: "source-encoding" };
  }
  const text = withoutZeroWidthSpace(probe?.shared);
  if (!text.trim()) return { parser: "zawgyi-one", reason: "no-checkpoint-text" };
  if (containsMyanmar(text)) return { parser: "zawgyi-one", reason: "myanmar" };
  // A page-number-only checkpoint has no evidence of a legacy font. In
  // particular, an inconclusive English score must not turn it into WinInnwa.
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

// Spaces do not count or break a mark run. Other boundaries, including line
// breaks and the virama before a subscript, start a new run. An isolated sign
// is inconclusive unless the same run continues into a following base.
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
