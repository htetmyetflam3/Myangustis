import { getMasterMapData } from "./clean.js";

let preservedGlue = null;
const FORMAT_CHARACTER = /^\p{Cf}$/u;
const WHITESPACE = /^\s$/u;
const ZERO_WIDTH_SPACE = "\u200b";

function needsProtection(ch) {
  if (ch === ZERO_WIDTH_SPACE) return false;
  if (preservedGlue === null) preservedGlue = new Set(getMasterMapData().Glue);
  return preservedGlue.has(ch) || FORMAT_CHARACTER.test(ch);
}

function isFormatCharacter(ch) {
  return ch !== ZERO_WIDTH_SPACE && (ch === "\u034f" || FORMAT_CHARACTER.test(ch));
}

// Conversion must not silently lose spaces, joiners or other protected PDF
// characters. U+200B follows the converter's own rules.
export function protectedCharacters(value) {
  let out = "";
  for (const ch of String(value ?? "")) {
    if (needsProtection(ch) || WHITESPACE.test(ch)) out += ch;
  }
  return out;
}

// Preserve other format characters and the combining grapheme joiner during
// these text transformations; U+200B is left to the transformation.
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

// Normalize one line at a time, with a single Engine call for each line.
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
