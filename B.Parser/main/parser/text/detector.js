import { normaliseFontName } from "../codepage/names.js";

const MYANMAR = /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/u;

export function containsMyanmar(text) {
  return MYANMAR.test(String(text ?? ""));
}

export function isZawgyiOneFont(name) {
  const normalized = normaliseFontName(name);
  return normalized === "zawgyione" || normalized === "zawgyi";
}

// Only fonts actually used for Myanmar characters count. A missing or mixed
// face is inconclusive: shared code points cannot identify the encoding.
export function hasOnlyZawgyiFonts(fontNames) {
  const names = fontNames ? [...fontNames] : [];
  return names.length > 0 && names.every(isZawgyiOneFont);
}

// The numeric field is an evidence flag, not a statistical probability.
export class ZawgyiDetector {
  detect(text, { sourceEncoding = "auto", fontNames = null } = {}) {
    if (!containsMyanmar(text)) return ["UNKNOWN", 0];
    if (sourceEncoding === "zawgyi-one") return ["ZAWGYI", 1];
    if (sourceEncoding === "unicode") return ["UNICODE", 0];
    if (hasOnlyZawgyiFonts(fontNames)) return ["ZAWGYI", 1];
    return ["UNKNOWN", 0];
  }
}
