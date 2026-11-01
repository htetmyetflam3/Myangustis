import { englishLikeness } from "./mm-score.js";
import { containsMyanmar } from "./detector.js";
import { arrangeZawCodeOrder } from "./zawcode-order.js";
import { normalizePageLines, sameProtectedCharacters } from "./preserved-transform.js";
import { Rabbit } from "./rabbit.js";

export { normalizePageLines } from "./preserved-transform.js";

const LATIN_LIKE = /^[\x20-\xff\p{Script=Latin}\p{Number}\p{Punctuation}\p{Symbol}\s]+$/u;
const SPACE_SEPARATOR = /^\p{Zs}$/u;

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
  const text = String(probe?.shared ?? "");
  if (!text.trim()) return { parser: "zawgyi-one", reason: "no-checkpoint-text" };
  if (containsMyanmar(text)) return { parser: "zawgyi-one", reason: "myanmar" };
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

// Make one whole-page choice. Rabbit always receives the original string,
// never a partial ZawCode repair, and requires positive Zawgyi evidence.
export function finishSharedPage(text, {
  normalize, sourceEncoding = "auto", unicodeEvidence = false, zawgyiEvidence = false,
  rabbit = Rabbit.zg2uni,
} = {}) {
  const original = String(text ?? "");
  if (!containsMyanmar(original) || markOrderAligned(original)) {
    return { text: [...normalizePageLines(original, normalize)].join("\n"), decision: "aligned" };
  }
  const candidate = arrangeZawCodeOrder(original);
  if (candidate !== original && markOrderAligned(candidate)) {
    return { text: [...normalizePageLines(candidate, normalize)].join("\n"), decision: "zawcode" };
  }
  if (unicodeEvidence || sourceEncoding === "unicode") {
    return { text: original, decision: "unaligned-unicode" };
  }
  // A mark-order mismatch alone cannot distinguish unknown Unicode from
  // Zawgyi. Keep the original when there is no positive Zawgyi evidence.
  if (!zawgyiEvidence && sourceEncoding !== "zawgyi-one") {
    return { text: original, decision: "unaligned-unknown" };
  }
  if (typeof rabbit !== "function") throw new TypeError("Expected Rabbit converter");
  const converted = rabbit(original, { preserveZeroWidth: true });
  if (!sameProtectedCharacters(original, converted)) {
    return { text: original, decision: "unaligned-zawgyi" };
  }
  return { text: converted, decision: "rabbit" };
}
