/*
(PDF 24) PDF branch, position 24 in the chain - small shared helper of the lane decision and finishing (PDF 10, PDF 19).
This module answers simple questions about text and font names: does this text contain Myanmar, is this font a Zawgyi-One face or a known Unicode face.
*/
import { normaliseFontName } from "../../@parse/pdf/font/legacy/codepage-names.js";

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

