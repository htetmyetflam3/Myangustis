/*
(praised/decoding/pdf/font/ttf) fallback: the last-resort lanes when neither /ToUnicode nor an embedded cmap answers - raw-byte profiles and the legacy code pages (WinInnwa/Ayar layout maps, legacy font detection). Judgement decides a page belongs here; this branch only decodes.
*/
import { isLegacyFontName, isUnresolvedLegacyFont, normaliseFontName } from "../../../method/codepage-names.js";
import { CmapIdentityMap } from "../cmap/cmap.js";
export { CmapIdentityMap };
import { lookupLegacyCode, AYAR_LEGACY_CODE_PAGE, WININNWA_LEGACY_CODE_PAGE, WININNWA_UNRESOLVED_SLOTS } from "../../../method/codepage-registry.js";

// Decode an explicitly supplied single-byte profile without /ToUnicode.
// Its direct entries can be table-seeded; review candidates require opt-in.
// Unmapped bytes are errors, not ASCII fallbacks or silently dropped text.
export function decodeRawByteSlots(data, profile, { includeReview = false } = {}) {
  if (!(data instanceof Uint8Array) && typeof data !== "string") {
    throw new TypeError("Expected raw bytes or a byte string");
  }
  const table = new Map();
  for (const source of [profile?.bytes, ...(includeReview ? [profile?.resolvedForReview] : [])]) {
    if (!source || typeof source !== "object") continue;
    for (const [hex, text] of Object.entries(source)) {
      if (!/^[0-9A-F]{2}$/u.test(hex) || typeof text !== "string" || !text.length) {
        throw new TypeError(`Invalid raw byte entry ${hex}`);
      }
      const byte = Number.parseInt(hex, 16);
      if (table.has(byte) && table.get(byte) !== text) {
        throw new Error(`Conflicting raw byte entry ${hex}`);
      }
      table.set(byte, text);
    }
  }
  const codes = typeof data === "string" ? Array.from(data, (c) => c.codePointAt(0)) : data;
  const result = [];
  for (let i = 0; i < codes.length; i += 1) {
    const byte = codes[i];
    if (byte > 255 || !table.has(byte)) {
      const hex = byte.toString(16).toUpperCase().padStart(2, "0");
      throw new Error(`Unmapped raw PDF byte ${hex} at offset ${i}`);
    }
    result.push(table.get(byte));
  }
  return result;
}

export function decodeRawBytes(data, profile, options = {}) {
  return decodeRawByteSlots(data, profile, options).join("");
}

// Input slots are already in glyph order and belong to one syllable/cluster.
// A later stacked syllable cannot change this cluster's u shape. This does not
// reorder Unicode text or verify that profile values reflect the actual font.
export function encodeRawByteSlots(slots, profile, { byteChoices = {}, includeReview = false } = {}) {
  if (!Array.isArray(slots) || slots.some((s) => typeof s !== "string" || !s.length)) {
    throw new TypeError("Expected non-empty Unicode slots");
  }
  const choices = new Map();
  const byteValues = new Map();
  for (const source of [profile?.bytes, ...(includeReview ? [profile?.resolvedForReview] : [])]) {
    for (const [hex, text] of Object.entries(source || {})) {
      if (!/^[0-9A-F]{2}$/u.test(hex) || typeof text !== "string" || !text.length) {
        throw new TypeError(`Invalid raw byte entry ${hex}`);
      }
      if (byteValues.has(hex) && byteValues.get(hex) !== text) {
        throw new Error(`Conflicting raw byte entry ${hex}`);
      }
      byteValues.set(hex, text);
      const list = choices.get(text) || [];
      if (!list.includes(hex)) list.push(hex);
      choices.set(text, list);
    }
  }
  const rules = profile?.writingRules || {};
  const u = rules.uVariants;
  const baseCount = slots.filter((slot) => {
    if (slot.startsWith("\u1004\u103A\u1039")) return false;
    const c = slot.codePointAt(0);
    return (c >= 0x1000 && c <= 0x1021) || (c >= 0x1023 && c <= 0x102A) || c === 0x103F || c === 0x104E;
  }).length;
  if (baseCount > 1 || (u && slots.includes(u.unicode) && baseCount !== 1)) {
    throw new Error("Encode one syllable/cluster at a time for contextual glyph selection");
  }
  const needsLongU = u && ((u.longInPaliOrStack && slots.some((s) => s.includes("\u1039"))) ||
    (u.longWhenContains || []).some((mark) => slots.some((s) => s.includes(mark))));
  const output = [];
  for (let i = 0; i < slots.length; i += 1) {
    // A preceding ya/ra in this one cluster selects ာ, not ါ. Glyph-order
    // ra may precede the base, so inspect the preceding slots rather than
    // assuming logical Unicode order.
    const hasMedial = baseCount === 1 && slots.slice(0, i).some((s) => /[ျြ]/u.test(s));
    const value = slots[i] === "ါ" && hasMedial ? "ာ" : slots[i];
    // When the same Unicode stack has different upper-consonant glyphs,
    // select only bytes valid after the preceding raw base.
    const available = (choices.get(value) || []).filter((candidate) => {
      const restriction = rules.restrictedBytes?.[candidate];
      if (!restriction) return true;
      const previous = output.at(-1);
      if (previous === undefined) return false;
      if (restriction.precedingBytes && !restriction.precedingBytes.includes(previous)) return false;
      const upper = byteValues.get(previous);
      if (restriction.requiresPrecedingConsonant && !/^[\u1000-\u1021]$/u.test(upper || "")) return false;
      return !(restriction.excludedPrecedingValues || []).includes(upper);
    });
    let hex = byteChoices[i];
    if (u && value === u.unicode) {
      const required = needsLongU ? u.long : u.short;
      if (hex !== undefined && hex !== required) throw new Error(`Raw glyph ${hex} violates the u-shape rule`);
      hex = required;
    }
    if (hex === undefined && available.length === 1) [hex] = available;
    if (!hex || !available.includes(hex)) {
      throw new Error(`Unresolved raw glyph for slot ${i} (${JSON.stringify(value)}); candidates: ${available.join(", ") || "none"}`);
    }
    output.push(hex);
  }
  return Uint8Array.from(output, (hex) => Number.parseInt(hex, 16));
}

export function legacyLayoutForFont(baseFont) {
  const name = normaliseFontName(baseFont);
  if (name.startsWith("wininnwa")) {
    return { layout: "wininnwa", codePage: WININNWA_LEGACY_CODE_PAGE, known: true };
  }
  if (/^(?:ayar|arlarwade|amyanmar)/u.test(name) || isLegacyFontName(baseFont)) {
    return { layout: "ayar", codePage: AYAR_LEGACY_CODE_PAGE, known: true };
  }
  return { layout: "wininnwa", codePage: WININNWA_LEGACY_CODE_PAGE, known: false };
}



export class LegacyAyarMap extends Map {}

const isSurrogate = (cp) => cp >= 0xd800 && cp <= 0xdfff;











const CATEGORY_C_RE = /\p{Cc}|\p{Cf}|\p{Co}|\p{Cs}|\p{Cn}/u;
function isCategoryC(ch) {
  return CATEGORY_C_RE.test(ch);
}

export function detectLegacyLayoutFonts(objects, getStreamFn, parseToUnicodeFn) {  const found = [];
  const subtypeRe = /\/Subtype\s*\/(TrueType|Type1|MMType1)\b/;
  const encodingRe = /\/Encoding\s*(\/|\d)/;
  const touRe = /\/ToUnicode\s+(\d+)\s+(\d+)\s+R/;
  const baseFontRe = /\/BaseFont\s*\/([#\w+\-.]+)/;
  const simpleEncRe = /\/Encoding\s*\/(WinAnsi|MacRoman|Standard|MacExpert)Encoding\b/;
  const push = (key) => {
    const [numStr, genStr] = key.split(",");
    found.push(new PdfRef(Number.parseInt(numStr, 10), Number.parseInt(genStr, 10)));
  };
  for (const [key, body] of objects) {
    if (!Buffer.isBuffer(body)) continue;
    const text = body.toString("latin1");
    if (!text.includes("/Subtype")) continue;
    if (!subtypeRe.test(text)) continue;
    const bf = baseFontRe.exec(text);
    // A sparse /ToUnicode map does not make an unsupported face Ayar/WinInnwa.
    if (bf && isUnresolvedLegacyFont(bf[1])) continue;
    if (!text.includes("/ToUnicode")) {
      if (!bf || !isLegacyFontName(bf[1])) continue;
      const enc = /\/Encoding\s*(\/\w+|\d+\s+\d+\s+R)/.exec(text);
      if (enc && !simpleEncRe.test(text)) continue;
      push(key);
      continue;
    }
    if (encodingRe.test(text)) continue;
    const m = touRe.exec(text);
    if (!m) continue;
    let mapping;
    try {
      const raw = getStreamFn(objects, Number.parseInt(m[1], 10), Number.parseInt(m[2], 10));
      mapping = raw ? parseToUnicodeFn(raw) : new Map();
    } catch {
      continue;
    }
    if (!mapping || !mapping.size) continue;
    let totalChars = 0;
    let myanmar = 0;
    for (const v of mapping.values()) {
      for (const ch of v) {
        totalChars += 1;
        const cp = ch.codePointAt(0);
        if (cp >= 0x1000 && cp <= 0x109f) myanmar += 1;
      }
    }
    if (!totalChars) continue;
    if (myanmar / totalChars < 0.25) push(key);
  }
  return found;
}








export function legacyFontFaces(objects, getStreamFn, parseToUnicodeFn) {
  const faces = [];
  for (const ref of detectLegacyLayoutFonts(objects, getStreamFn, parseToUnicodeFn)) {
    const body = objects.get(ref.key());
    if (!Buffer.isBuffer(body)) continue;
    const text = body.toString("latin1");
    const bf = /\/BaseFont\s*\/([#\w+\-.]+)/.exec(text);
    const fd = /\/FontDescriptor\s+(\d+)\s+(\d+)\s+R/.exec(text);
    if (!bf || !fd) continue;
    const desc = objects.get(`${fd[1]},${fd[2]}`);
    const descText = Buffer.isBuffer(desc) ? desc.toString("latin1") : "";
    const ascent = /\/Ascent\s+(-?\d+(?:\.\d+)?)/.exec(descText);
    const descent = /\/Descent\s+(-?\d+(?:\.\d+)?)/.exec(descText);
    if (!ascent || !descent) continue;
    faces.push({
      ref: ref.key(),
      baseFont: bf[1],
      ascent: Number(ascent[1]) / 1000,
      descent: Number(descent[1]) / 1000,
    });
  }
  return faces;
}


// Avoid a separate rope node or array entry for every decoded byte of a large
// PDF string. The decoder's returned text is unchanged.
