import { normaliseFontName } from "../codepage/names.js";

const MYANMAR = /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/u;

export function containsMyanmar(text) {
  return MYANMAR.test(String(text ?? ""));
}

export function isZawgyiOneFont(name) {
  const normalized = normaliseFontName(name);
  return normalized === "zawgyione" || normalized === "zawgyi";
}

// Exact family/full names cross-checked against the local font witnesses.
// This does not identify a keyboard or validate PDF character-code mappings.
const UNICODE_FACES = new Set([
  "tharlon", "myanmar3", "myanmar3paoh", "padauk", "padaukregular",
  "pyidaungsu", "yunghkio", "myanmartext",
]);

export function isUnicodeFont(name) {
  return UNICODE_FACES.has(normaliseFontName(name));
}

export function hasOnlyUnicodeFonts(fontNames) {
  const names = fontNames ? [...fontNames] : [];
  return names.length > 0 && names.every(isUnicodeFont);
}

// Only fonts actually used for Myanmar characters count. A missing or mixed
// face is inconclusive: shared code points cannot identify the encoding.
export function hasOnlyZawgyiFonts(fontNames) {
  const names = fontNames ? [...fontNames] : [];
  return names.length > 0 && names.every(isZawgyiOneFont);
}

// The numeric field is an evidence flag, not a statistical probability.
export class ZawgyiDetector {
  detect(text, { sourceEncoding = "auto", fontNames = null, unicodeFontEvidence = true } = {}) {
    if (!containsMyanmar(text)) return ["UNKNOWN", 0];
    if (sourceEncoding === "zawgyi-one") return ["ZAWGYI", 1];
    if (sourceEncoding === "unicode") return ["UNICODE", 0];
    if (hasOnlyZawgyiFonts(fontNames)) return ["ZAWGYI", 1];
    if (unicodeFontEvidence && hasOnlyUnicodeFonts(fontNames)) return ["UNICODE", 0];
    return ["UNKNOWN", 0];
  }
}
