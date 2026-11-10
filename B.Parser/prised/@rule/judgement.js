/*
(PDF 28) PDF branch - the lane judgement module: the top-level decision
maker. Its whole job is distinguishing Burmese from English and
turning evidence into lane decisions - judgePageLines gathers the
evidence for a page, and the LANE piece below selects from it. It
loads no JSON and keeps no mark tables: the strict low-level token
walking lives in mm-score.js beside it (scoreText, markOrderAligned),
which this module asks for evidence. Nothing here rewrites text.
The TEXT KEEPING section at the bottom is inherited plumbing from the
deleted normalize.js; it judges nothing and selects nothing.
*/
import { containsMyanmar, isUnicodeFont } from "./detect.js";
import { isLegacyFontName, normaliseFontName } from "../@core/pdf/method/legacy/codepage-names.js";
import { PDF_PARSING_PATHS } from "../@core/pdf/method/decoder.js";
import { markOrderAligned, scoreText } from "./mm-score.js";

const LATIN_LIKE = /^[\x20-\xff\p{Script=Latin}\p{Number}\p{Punctuation}\p{Symbol}\s]+$/u;
const PAGE_NUMBER = /^(?:[0-9]{1,4}|(?:page\s*[|:#-]?\s*[0-9]{1,4}\s*)+)$/iu;

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

// ===========================================================================
// PIECE 3 - DECISION
// The one who calls the judgement functions to answer for a whole page.
// It walks the page's lines once, asks the mm-score walker about the raw reading and
// about the ZawCode-swapped candidate, and returns the evidence pack.
// It selects nothing itself - that is PIECE 4's job.
// ===========================================================================

// mm-score evidence over the decoded output itself: how the page reads
// as emitted by the cmap parse, versus how it reads after the ZawCode
// slot swap. The swap candidate is handed in by the caller (the finisher
// owns the ZawCode order function); this module never imports it.
export function judgePageLines(lines, swapCandidate) {
  let originalHasText = false;
  let hasMyanmar = false;
  let aligned = true;
  let candidateChanged = false;
  let candidateAligned = true;
  let candidateSlots = 0;
  let count = 0;
  let rawScoreTotal = 0;
  let rawMarks = 0;
  let candidateScoreTotal = 0;
  let candidateMarks = 0;
  for (const text of lines) {
    count += 1;
    const inspected = String(text ?? "").replace(/\u200b/gu, "");
    originalHasText ||= Boolean(inspected.trim());
    hasMyanmar ||= containsMyanmar(inspected);
    aligned &&= markOrderAligned(inspected);
    const candidate = swapCandidate(inspected);
    candidateChanged ||= candidate !== inspected;
    if (candidate !== inspected) {
      // Slots the swapping rule touched on this line, counted as the
      // character positions it rearranged (one slot touches at most
      // five). The ZawCode call needs more than one slot - see
      // ZAWCODE_MIN_SLOTS in PIECE 4.
      const before = [...inspected];
      const after = [...candidate];
      const n = Math.max(before.length, after.length);
      for (let i = 0; i < n; i += 1) if (before[i] !== after[i]) candidateSlots += 1;
    }
    candidateAligned &&= markOrderAligned(candidate);
    if (inspected) {
      // Mm-score judges the readings exactly as emitted - no reordering
      // first, or a crossed page would score as if already fixed.
      const rawReading = scoreText(inspected);
      rawScoreTotal += rawReading.score * rawReading.marks;
      rawMarks += rawReading.marks;
      const candidateReading = scoreText(candidate);
      candidateScoreTotal += candidateReading.score * candidateReading.marks;
      candidateMarks += candidateReading.marks;
    }
  }
  return {
    originalHasText,
    hasMyanmar,
    aligned,
    candidateChanged,
    candidateAligned,
    candidateSlots,
    count,
    rawScore: rawMarks ? rawScoreTotal / rawMarks : 0,
    candidateScore: candidateMarks ? candidateScoreTotal / candidateMarks : 0,
  };
}


// ===========================================================================
// PIECE 4 - LANE
// The ones who actually select the lane, from the judgement. Given the
// evidence pack from PIECE 3 (or the font evidence off the instructions),
// these pick; they do not judge text themselves.
// ===========================================================================

// The cmap lane parsed the page as Zawgyi-One by default and emitted it;
// the finish checks that output against the beautify rules. These are
// parser behaviour, the same for every book - never tuned per book:
// One swapped slot is not enough for the ZawCode call: Zawgyi shares
// some of the same characters, so a single slot can collide with a
// Zawgyi (or stray) reading. The call needs more than one slot's
// worth of matches on the page (one slot touches at most five
// character positions).
const ZAWCODE_MIN_SLOTS = 6;

// The cmap lane parsed the page as Zawgyi-One by default and emitted it;
// the finish checks that output against the beautify rules. These are
// parser behaviour, the same for every book - never tuned per book:
//   1. ZawCode codepage: the ZawCode swapping rule (from beautify) is
//      offered as a candidate, and matching more than one slot (see
//      ZAWCODE_MIN_SLOTS) is the ZawCode call - the page then takes
//      the ZawCode beautify rules. This test is never offered on a
//      Zawgyi codepage page (the caller says so): Zawgyi visual order
//      shares the same slots, and a Zawgyi page must not be rerouted
//      here.
//   2. Mark order violated -> Rabbit. The mark-order rule alone makes
//      this call; no score margin second-guesses it.
//   3. It neither violates mark order nor falls into the ZawCode
//      rules -> it passes through: nothing but the Normalize that
//      runs behind every finish in the stream.
export function selectPageDecision(judgment, parsingPath, { zawgyiCodepage = false } = {}) {
  if (parsingPath === "legacy") return "legacy";
  if (!judgment.hasMyanmar) return "aligned";
  if (!zawgyiCodepage && judgment.candidateSlots >= ZAWCODE_MIN_SLOTS) return "zawcode";
  if (!judgment.aligned) return "rabbit";
  return "aligned";
}

// Lane decision from the outside-stream instructions alone: a page takes
// the legacy lane iff one of its fonts is a registered legacy face
// (isLegacyFontName - the curated registry, not the layout prefix guess,
// which would also bless the modern Unicode font named "Ayar") and that
// face plausibly carries the page's text (details below). Inside the
// legacy lane a font whose own map marks it Unicode or Zawgyi is still
// read through that map, not the codepage, so a legacy entry rarely
// destroys well-mapped fonts. Guards: a CID Unicode face (Type0 +
// isUnicodeFont) means the page's Burmese is Unicode-typeset even when a
// legacy-named resource is also declared; and a two/three-letter base
// name is not evidence - the registry's prefix rule would otherwise call
// any "MS"-style face legacy. Everything else stays on the font-cmap
// lane. The registry is the same one the legacy lane uses internally as
// its layout guard.
export function instructionLane(pageInstruction, sourceEncoding) {
  if (sourceEncoding === "unicode" || sourceEncoding === "zawgyi-one") {
    return { parser: PDF_PARSING_PATHS.FONT_CMAP, reason: "source-encoding" };
  }
  const fonts = pageInstruction?.fonts ?? [];
  const cidUnicodeFace = fonts.some((font) => font.subtype === "Type0"
    && (isUnicodeFont(font.baseFont) || /^myanmar[0-9]/u.test(normaliseFontName(font.baseFont))));
  if (cidUnicodeFace) {
    return { parser: PDF_PARSING_PATHS.FONT_CMAP, reason: "unicode-font" };
  }
  // A CID-keyed Zawgyi face is the modern Zawgyi toolchain: the page is
  // read through its own maps even when a legacy-named resource is present.
  if (fonts.some((font) => font.subtype === "Type0" && normaliseFontName(font.baseFont).startsWith("zawgyi"))) {
    return { parser: PDF_PARSING_PATHS.FONT_CMAP, reason: "cid-zawgyi-font" };
  }
  const legacyFonts = fonts.filter((font) => normaliseFontName(font.baseFont).length >= 4
    && isLegacyFontName(font.baseFont));
  // A legacy-named font that ships no ToUnicode while a mapped font on
  // the page does is not the page's text carrier (it typesets
  // headers/Latin); the legacy reading only applies when the legacy font
  // carries its own map, or no mapped non-Zawgyi font is present. A
  // mapped Zawgyi companion does not count: legacy books mix both.
  const legacyApplies = legacyFonts.some((font) => font.toUnicode)
    || !fonts.some((font) => font.toUnicode && !normaliseFontName(font.baseFont).startsWith("zawgyi"));
  if (legacyFonts.length > 0 && legacyApplies) {
    return {
      parser: PDF_PARSING_PATHS.LEGACY,
      reason: "legacy-font",
      fonts: legacyFonts.map((font) => font.baseFont),
    };
  }
  return {
    parser: PDF_PARSING_PATHS.FONT_CMAP,
    reason: fonts.length > 0 ? "no-legacy-evidence" : "no-fonts",
  };
}


// The Unicode-lane decisions, for consumers eligibility checks (the PDF
// stream's beautify gate asks this instead of keeping its own copy).
export const UNICODE_LANE_DECISIONS = new Set(["aligned", "zawcode", "unaligned-unicode"]);

export function isUnicodeLaneDecision(decision, category) {
  return UNICODE_LANE_DECISIONS.has(decision) || category === "UNICODE";
}


// ===========================================================================
// TEXT KEEPING (not lane machinery)
// Inherited from the deleted normalize.js: zero-width/format-character
// preservation and the line-by-line Engine-normalize plumbing. These stay
// in this file only because this module already held them; they judge
// nothing and select nothing.
// ===========================================================================

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
