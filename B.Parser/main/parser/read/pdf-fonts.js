import { createHash } from "node:crypto";
import { pyChr } from "../core/pylib.js";
import { BASE_ENCODINGS, GLYPH_NAME_TO_UNICODE } from "./pdf-encodings.js";
import { isLegacyFontName, isUnresolvedLegacyFont, normaliseFontName } from "../codepage/names.js";
import { confirmedRunAt } from "../codepage/confirmed-pdf-runs.js";
import { subsetFontBridge } from "../codepage/subset-font-bridges.js";
import { parseTtfGsubReverse, parseTtfVariantSlots } from "../core/ttf-gsub.js";







// Decode a selected single-byte font profile without consulting /ToUnicode.
// Unreviewed bytes are errors, not ASCII fallbacks or silently dropped text.
export function decodeRawByteSlots(data, profile) {
  if (!(data instanceof Uint8Array) && typeof data !== "string") {
    throw new TypeError("Expected raw bytes or a byte string");
  }
  const table = new Map();
  for (const source of [profile?.bytes, profile?.resolvedForReview]) {
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

export function decodeRawBytes(data, profile) {
  return decodeRawByteSlots(data, profile).join("");
}

// Input slots are already in glyph order and belong to one syllable/cluster.
// A later stacked syllable cannot change this cluster's u shape. This does not
// reorder Unicode text or guess between unverified alternatives.
export function encodeRawByteSlots(slots, profile, { byteChoices = {} } = {}) {
  if (!Array.isArray(slots) || slots.some((s) => typeof s !== "string" || !s.length)) {
    throw new TypeError("Expected non-empty Unicode slots");
  }
  const choices = new Map();
  const byteValues = new Map();
  for (const source of [profile?.bytes, profile?.resolvedForReview]) {
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

export class PdfName {
  constructor(v) { this.v = v; }
  toString() { return this.v; }
  valueOf() { return this.v; }
}


export class PdfKeyword {
  constructor(v) { this.v = v; }
  toString() { return this.v; }
  valueOf() { return this.v; }
}


export class PdfFloat extends Number {}


export const isNumeric = (v) => typeof v === "number" || v instanceof PdfFloat;
export const toNumber = (v) => (typeof v === "number" ? v : v.valueOf());


export class PdfHexBytes {
  constructor(s) { this.s = s; }
}
export class PdfRef {
  constructor(num, gen = 0) {
    this.num = Math.trunc(num);
    this.gen = Math.trunc(gen);
  }
  key() { return `${this.num},${this.gen}`; }
  toString() { return `${this.num} ${this.gen} R`; }
}




const WS = "\\x00\\x09-\\x0d\\x20";
const TOKEN_RE = new RegExp(
  `[${WS}]*(?:`
  + "(?<comment>%[^\\r\\n]*)"
  + `|(?<name>/[^${WS}()<>\\[\\]{}/%]*)`
  + "|(?<num>[+-]*(?:\\d+\\.\\d*|\\.\\d+|\\d+))"
  + "|(?<dopen><<)"
  + "|(?<dclose>>>)"
  + "|(?<hex><[^>]*>)"
  + "|(?<aopen>\\[)"
  + "|(?<aclose>\\])"
  + "|(?<lit>\\()"
  + "|(?<popen>\\{)"
  + "|(?<pclose>\\})"
  + "|(?<kw>[A-Za-z'\"*][A-Za-z0-9'\"*]*)"
  + `|(?<other>[^${WS}])`
  + ")",
  "y",
);

const LIT_SPECIAL_RE = /[()\\\r]/g;

const ESCAPES = new Map([
  [0x6e, "\n"], [0x72, "\r"], [0x74, "\t"], [0x62, "\b"], [0x66, "\f"],
  [0x28, "("], [0x29, ")"], [0x5c, "\\"],
]);

export function scanLiteralString(data, i) {
  let depth = 1;
  let out = "";
  const n = data.length;
  while (i < n) {
    LIT_SPECIAL_RE.lastIndex = i;
    const m = LIT_SPECIAL_RE.exec(data);
    if (m === null) {
      out += data.slice(i);
      return [out, n];
    }
    out += data.slice(i, m.index);
    const c = m[0];
    i = m.index + 1;
    if (c === "(") {
      depth += 1;
      out += "(";
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0) return [out, i];
      out += ")";
    } else if (c === "\r") {
      if (i < n && data[i] === "\n") i += 1;
      out += "\n";
    } else {
      if (i >= n) break;
      const b = data.charCodeAt(i);
      i += 1;
      if (ESCAPES.has(b)) {
        out += ESCAPES.get(b);
      } else if (b >= 0x30 && b <= 0x37) {
        let val = b - 0x30;
        for (let k = 0; k < 2; k += 1) {
          if (i < n && data.charCodeAt(i) >= 0x30 && data.charCodeAt(i) <= 0x37) {
            val = val * 8 + (data.charCodeAt(i) - 0x30);
            i += 1;
          } else break;
        }
        out += String.fromCharCode(val & 0xff);
      } else if (b === 0x0a) { // line continuation
        /* pass */
      } else if (b === 0x0d) {
        if (i < n && data[i] === "\n") i += 1;
      } else {
        out += String.fromCharCode(b);
      }
    }
  }
  return [out, n];
}


function hexToByteString(text) {
  let digits = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if ((c >= "0" && c <= "9") || (c >= "A" && c <= "F") || (c >= "a" && c <= "f")) digits += c;
  }
  if (digits.length % 2) digits += "0";
  let out = "";
  for (let i = 0; i < digits.length; i += 2) {
    const v = Number.parseInt(digits.slice(i, i + 2), 16);
    if (Number.isNaN(v)) return "";
    out += String.fromCharCode(v);
  }
  return out;
}
const NAME_ESC_RE = /#([0-9A-Fa-f]{2})/g;


function decodeName(raw) {
  return raw.replace(NAME_ESC_RE, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}


export class Lexer {
  constructor(data, pos = 0) {
    this.data = data;
    this.pos = pos;
  }


  nextToken() {
    const { data } = this;
    for (;;) {
      TOKEN_RE.lastIndex = this.pos;
      const m = TOKEN_RE.exec(data);
      if (m === null || m.index !== this.pos || TOKEN_RE.lastIndex === this.pos) return null;
      this.pos = TOKEN_RE.lastIndex;
      const g = m.groups;
      if (g.comment !== undefined) continue;
      if (g.name !== undefined) return ["obj", new PdfName(decodeName(g.name.slice(1)))];
      if (g.num !== undefined) {
        const raw = g.num.replace(/^\+*/, "");
        if (raw.includes(".")) {
          const v = Number.parseFloat(raw);
          return ["obj", Number.isNaN(v) ? 0 : new PdfFloat(v)];
        }
        const v = Number.parseInt(raw, 10);
        return ["obj", Number.isNaN(v) ? 0 : v];
      }
      if (g.hex !== undefined) return ["obj", new PdfHexBytes(hexToByteString(g.hex.slice(1, -1)))];
      if (g.lit !== undefined) {
        const [s, end] = scanLiteralString(data, this.pos);
        this.pos = end;
        return ["obj", s];
      }
      if (g.kw !== undefined) {
        const kw = g.kw;
        if (kw === "true") return ["obj", true];
        if (kw === "false") return ["obj", false];
        if (kw === "null") return ["obj", null];
        return ["kw", new PdfKeyword(kw)];
      }
      if (g.dopen !== undefined) return ["dopen", null];
      if (g.dclose !== undefined) return ["dclose", null];
      if (g.aopen !== undefined) return ["aopen", null];
      if (g.aclose !== undefined) return ["aclose", null];
      if (g.popen !== undefined || g.pclose !== undefined) continue;

      return ["kw", new PdfKeyword(g.other)];
    }
  }
}

function collapseRefs(stack) {
  const top = stack[stack.length - 1];
  if (stack.length >= 3 && top instanceof PdfKeyword && String(top) === "R") {
    const gen = stack[stack.length - 2];
    const num = stack[stack.length - 3];
    if (typeof num === "number" && typeof gen === "number") {
      stack.length -= 3;
      stack.push(new PdfRef(num, gen));
      return true;
    }
  }
  return false;
}

const isKeyword = (v) => v instanceof PdfKeyword;
const isIntLike = (v) => typeof v === "number" || typeof v === "boolean";


export function parseObject(data, pos = 0) {
  const lex = new Lexer(data, pos);
  const stack = [];
  const containers = [];
  for (;;) {
    const tok = lex.nextToken();
    if (tok === null) break;
    const [kind, value] = tok;
    if (kind === "aopen") { containers.push({ type: "a", mark: stack.length }); continue; }
    if (kind === "dopen") { containers.push({ type: "d", mark: stack.length }); continue; }
    if (kind === "aclose" || kind === "dclose") {
      if (!containers.length) continue;
      const { type, mark } = containers.pop();
      const items = stack.splice(mark);
      if (type === "a") {
        stack.push(items);
      } else {
        const d = new Map();
        for (let i = 0; i < items.length - 1; i += 2) {
          const key = items[i];
          if (key instanceof PdfName) d.set(String(key), items[i + 1]);
        }
        stack.push(d);
      }
    } else if (kind === "kw") {
      stack.push(value);
      collapseRefs(stack);
      if (!containers.length && (String(value) === "stream" || String(value) === "endobj")) break;
    } else {
      stack.push(value);
    }
    if (!containers.length && stack.length && !isKeyword(stack[stack.length - 1])) {
      if (stack.length === 1 && !isIntLike(stack[0])) return stack[0];
      if (stack[stack.length - 1] instanceof PdfRef) return stack[stack.length - 1];
    }
  }
  for (const item of stack) {
    if (!isKeyword(item)) return item;
  }
  return null;
}




const UNI_NAME_RE = /^uni([0-9A-Fa-f]{4,6})$/;
const U_NAME_RE = /^u([0-9A-Fa-f]{4,6})$/;

export function glyphNameToUnicode(name) {
  if (!name || name === ".notdef") return null;
  const hit = GLYPH_NAME_TO_UNICODE.get(name);
  if (hit !== undefined) return hit;
  let m = UNI_NAME_RE.exec(name);
  if (m) {
    const hex = m[1];
    let out = "";
    for (let i = 0; i < hex.length; i += 4) {
      out += pyChr(Number.parseInt(hex.slice(i, i + 4), 16));
    }
    return out;
  }
  m = U_NAME_RE.exec(name);
  if (m) {
    const cp = Number.parseInt(m[1], 16);
    return (cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) ? pyChr(cp) : null;
  }
  if (name.includes(".")) return glyphNameToUnicode(name.split(".", 1)[0]);
  if (Array.from(name).length === 1) return name;
  return null;
}


export function buildSimpleEncoding(encodingObj, resolve) {
  encodingObj = resolve(encodingObj);
  if (encodingObj instanceof PdfName) {
    const base = BASE_ENCODINGS.get(String(encodingObj));
    if (base === undefined) return [new Map(), false];
    return [new Map(base), true];
  }
  if (encodingObj instanceof Map) {
    const baseNameVal = resolve(encodingObj.get("BaseEncoding"));
    const base = baseNameVal instanceof PdfName ? BASE_ENCODINGS.get(String(baseNameVal)) : undefined;
    let declared = base !== undefined;
    const table = new Map(base !== undefined ? base : BASE_ENCODINGS.get("StandardEncoding"));
    const diffs = resolve(encodingObj.get("Differences"));
    if (Array.isArray(diffs)) {
      let code = 0;
      for (let item of diffs) {
        item = resolve(item);
        if (isNumeric(item)) {
          code = Math.trunc(toNumber(item));
        } else if (item instanceof PdfName) {
          const ch = glyphNameToUnicode(String(item));
          if (ch !== null) table.set(code, ch);
          else table.delete(code);
          code += 1;
        }
      }
      declared = true;
    }
    return [table, declared];
  }
  return [new Map(), false];
}






export class CMapEncoding {
  constructor(identity = true) {
    this.identity = identity;
    this.widths = new Set();
    this.spaces = [];
    this.single = new Map();
    this.singleByWidth = new Map();
    this.ranges = [];
  }

  codeLengths() {
    return this.widths.size ? Array.from(this.widths).sort((a, b) => a - b) : [2];
  }

  cidFor(code, width = null) {
    if (this.identity) return code;
    const cid = width !== null && this.singleByWidth.size
      ? this.singleByWidth.get(width)?.get(code) : this.single.get(code);
    if (cid !== undefined) return cid;
    for (const [lo, hi, base, rangeWidth] of this.ranges) {
      if ((width === null || rangeWidth === undefined || rangeWidth === width) && lo <= code && code <= hi) {
        return base + (code - lo);
      }
    }
    return code;
  }

  _inSpace(code, width) {
    if (!this.spaces.length) return this.widths.size ? this.widths.has(width) : width === 2;
    return this.spaces.some(([w, lo, hi]) => w === width && code >= lo && code <= hi);
  }

  * iterCodes(data) {
    const lengths = this.codeLengths();
    for (let i = 0; i < data.length;) {
      let matched = false;
      for (const width of lengths) {
        if (i + width > data.length) continue;
        let code = 0;
        for (let k = 0; k < width; k += 1) code = code * 256 + data.charCodeAt(i + k);
        if (!this._inSpace(code, width)) continue;
        yield [code, this.cidFor(code, width), width, false];
        i += width;
        matched = true;
        break;
      }
      if (!matched) {
        // Do not pad a truncated/invalid code with zero or interpret it as a
        // different CID. Retain each unmatched byte as an explicit unknown.
        yield [data.charCodeAt(i), null, 1, true];
        i += 1;
      }
    }
  }
}

const CODESPACE_RE = /begincodespacerange([\s\S]*?)endcodespacerange/g;
const CIDRANGE_RE = /begincidrange([\s\S]*?)endcidrange/g;
const CIDCHAR_RE = /begincidchar([\s\S]*?)endcidchar/g;
const HEXPAIR_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
const HEXNUM_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\d+)/g;
const HEXINT_RE = /<([0-9A-Fa-f]+)>\s*(\d+)/g;


export function parseCmapStream(data) {
  const text = Buffer.isBuffer(data) ? data.toString("latin1") : data;
  const enc = new CMapEncoding(false);
  let m;
  CODESPACE_RE.lastIndex = 0;
  while ((m = CODESPACE_RE.exec(text)) !== null) {
    HEXPAIR_RE.lastIndex = 0;
    let p;
    while ((p = HEXPAIR_RE.exec(m[1])) !== null) {
      const width = p[1].length / 2;
      if (!Number.isInteger(width) || width < 1 || width > 4 || p[2].length !== p[1].length) continue;
      enc.widths.add(width);
      enc.spaces.push([width, parseInt(p[1], 16), parseInt(p[2], 16)]);
    }
  }
  CIDRANGE_RE.lastIndex = 0;
  while ((m = CIDRANGE_RE.exec(text)) !== null) {
    HEXNUM_RE.lastIndex = 0;
    let p;
    while ((p = HEXNUM_RE.exec(m[1])) !== null) {
      const width = p[1].length / 2;
      if (!Number.isInteger(width) || width < 1 || width > 4 || p[2].length !== p[1].length) continue;
      enc.ranges.push([Number.parseInt(p[1], 16), Number.parseInt(p[2], 16), Number.parseInt(p[3], 10), width]);
    }
  }
  CIDCHAR_RE.lastIndex = 0;
  while ((m = CIDCHAR_RE.exec(text)) !== null) {
    HEXINT_RE.lastIndex = 0;
    let p;
    while ((p = HEXINT_RE.exec(m[1])) !== null) {
      const width = p[1].length / 2;
      if (!Number.isInteger(width) || width < 1 || width > 4) continue;
      const code = Number.parseInt(p[1], 16);
      const cid = Number.parseInt(p[2], 10);
      if (!enc.singleByWidth.has(width)) enc.singleByWidth.set(width, new Map());
      enc.singleByWidth.get(width).set(code, cid);
      enc.single.set(code, cid);
    }
  }
  if (!enc.widths.size) enc.widths.add(2);
  if (!enc.ranges.length && !enc.single.size) enc.identity = true;
  return enc;
}






export const IDENTITY = Symbol("IDENTITY");

// These are parsing routes, not declarations that all text on the shared
// Zawgyi-One route is Zawgyi encoded.
export const PDF_PARSING_PATHS = Object.freeze({
  ZAWGYI_ONE: "zawgyi-one",
  LEGACY: "legacy",
});

export class CmapIdentityMap extends Map {}


export class LegacyAyarMap extends Map {}

const isSurrogate = (cp) => cp >= 0xd800 && cp <= 0xdfff;











const CATEGORY_C_RE = /\p{Cc}|\p{Cf}|\p{Co}|\p{Cs}|\p{Cn}/u;
function isCategoryC(ch) {
  return CATEGORY_C_RE.test(ch);
}


export function mapCode(codeToUni, cid) {
  if (codeToUni === IDENTITY) {
    if (cid >= 0 && cid <= 0x10ffff && !isSurrogate(cid)) return pyChr(cid);
    return null;
  }
  const v = codeToUni.get(cid);
  if (v === undefined) {
    if (codeToUni instanceof CmapIdentityMap) {
      if (cid === 0) return " ";
      if (cid >= 0x20 && cid <= 0x10ffff && !isSurrogate(cid)) {
        const ch = pyChr(cid);
        if (!isCategoryC(ch)) return ch;
      }
    }
    return null;
  }
  return typeof v === "number" ? pyChr(v) : v;
}
export function usableToUnicode(mapping) {
  if (!mapping || !mapping.size) return null;
  let spaces = 0;
  for (const v of mapping.values()) if (v === " ") spaces += 1;
  if (spaces / mapping.size > 0.9) {
    const filtered = new Map();
    for (const [k, v] of mapping) if (v !== " ") filtered.set(k, v);
    mapping = filtered;
  }
  return mapping.size ? mapping : null;
}

export class DocumentDecoding {
  constructor(kind, mapping = null, legacyCodePage = null, { legacyFontNames = null, vectorRepair = null } = {}) {
    this.kind = kind;
    this.map = kind === "identity" ? IDENTITY : (mapping || new Map());
    this.keyKind = kind === "cmap" || kind === "font" ? "gid" : "code";
    this.trustFontToUnicode = kind === "tounicode" || kind === "none" || kind === "font";
    this.legacyTextFix = kind === "legacy";
    this.legacyCodePage = legacyCodePage;
    this.legacyFontNames = legacyFontNames ? new Set(legacyFontNames) : null;




    this.vectorRepair = vectorRepair;
    this.loader = null;
    this._decoders = new Map();
    this._pageFonts = new Map();
  }

  resetFontCache() {
    this._decoders.clear();
    this._pageFonts.clear();
  }
}


export function asDocumentDecoding(decoding) {
  if (decoding instanceof DocumentDecoding) return decoding;
  if (decoding === IDENTITY) return new DocumentDecoding("identity");
  if (decoding instanceof LegacyAyarMap) return new DocumentDecoding("legacy", decoding);
  if (decoding instanceof CmapIdentityMap) return new DocumentDecoding("cmap", decoding);
  if (!decoding || (decoding instanceof Map && decoding.size === 0)) return new DocumentDecoding("none");
  return new DocumentDecoding("tounicode", decoding);
}





const MAX_SHAPING_DEPTH = 8;



const SPACE_CODES = new Set([
  0x0009, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
]);









function resolveShapedGlyphs(fontBytes, table) {
  const reverse = parseTtfGsubReverse(fontBytes);
  if (!reverse.size) return table;
  const walking = new Set();
  const resolve = (gid, depth) => {
    const direct = table.get(gid);


    if (direct !== undefined) {
      return typeof direct === "number" ? String.fromCodePoint(direct) : direct;
    }
    if (depth >= MAX_SHAPING_DEPTH || walking.has(gid)) return undefined;
    const inputs = reverse.get(gid);
    if (!inputs) return undefined;
    walking.add(gid);
    let out = "";
    for (const part of inputs) {
      const text = resolve(part, depth + 1);
      if (text === undefined) { out = undefined; break; }
      out += text;
    }
    walking.delete(gid);
    return out;
  };
  for (const gid of reverse.keys()) {
    if (table.has(gid)) continue;
    const text = resolve(gid, 0);
    if (text) table.set(gid, text);
  }







  const slots = parseTtfVariantSlots(fontBytes);
  for (let round = 0; round < 3; round += 1) {
    let added = false;
    for (const group of slots) {
      const unknown = group.filter((g) => !table.has(g));
      if (!unknown.length) continue;
      const known = new Map();
      for (const gid of group) {
        const value = table.get(gid);
        if (value === undefined) continue;
        const text = typeof value === "number" ? String.fromCodePoint(value) : value;
        if (text) known.set(text, value);
      }
      // A shaping group can contain different characters or sequences. A
      // single convenient-looking member is not evidence for the others.
      if (known.size !== 1) continue;
      const value = known.values().next().value;
      for (const gid of unknown) { table.set(gid, value); added = true; }
    }
    if (!added) break;
  }
  return table;
}

export class FontResourceLoader {
  constructor(objects, getStream, parseTtfCmap, parseToUnicodeStream) {
    this.objects = objects;
    this._getStream = getStream;
    this._parseTtfCmap = parseTtfCmap;
    this._parseToUnicode = parseToUnicodeStream;
    this._objCache = new Map();
    this._gidCache = new Map();
    this._tuCache = new Map();
  }

  objectValue(ref) {
    const key = ref.key();
    if (this._objCache.has(key)) return this._objCache.get(key);
    let raw = this.objects.get(key);
    if (raw === undefined && ref.gen !== 0) raw = this.objects.get(`${ref.num},0`);
    const value = raw ? parseObject(raw.toString("latin1")) : null;
    this._objCache.set(key, value);
    return value;
  }

  resolve(value, depth = 0) {
    while (value instanceof PdfRef && depth < 32) {
      value = this.objectValue(value);
      depth += 1;
    }
    return value;
  }

  streamOf(ref) {
    if (!(ref instanceof PdfRef)) return null;
    return this._getStream(this.objects, ref.num, ref.gen);
  }


  reversedFontCmap(descriptor) {
    descriptor = this.resolve(descriptor);
    if (!(descriptor instanceof Map)) return new Map();
    for (const key of ["FontFile2", "FontFile3", "FontFile"]) {
      const ref = descriptor.get(key);
      if (!(ref instanceof PdfRef)) continue;
      const cacheKey = ref.key();
      if (this._gidCache.has(cacheKey)) return this._gidCache.get(cacheKey);
      const data = this.streamOf(ref);
      const table = new Map();
      if (data) {
        const cmap = this._parseTtfCmap(data) || new Map();





        const direct = new Map();
        const ambiguous = new Set();
        const codepoints = new Map();
        for (const [uni, gid] of cmap) {
          if (!gid) continue;
          if (!codepoints.has(gid)) codepoints.set(gid, new Set());
          codepoints.get(gid).add(uni);
          const prev = table.get(gid);
          if (prev === undefined || uni < prev) table.set(gid, uni);
          if (direct.has(gid) && direct.get(gid) !== uni) {
            direct.delete(gid);
            ambiguous.add(gid);
          } else if (!ambiguous.has(gid)) {
            direct.set(gid, uni);
          }
        }
        table.direct = direct;
        table.ambiguous = ambiguous;
        table.codepoints = codepoints;
        resolveShapedGlyphs(data, table);
      }
      this._gidCache.set(cacheKey, table);
      return table;
    }
    return new Map();
  }


  tounicodeOf(fontDict, { preserveSpaces = false } = {}) {
    const ref = fontDict.get("ToUnicode");
    if (!(ref instanceof PdfRef)) return null;
    const cacheKey = `${ref.key()}:${preserveSpaces ? "all" : "filtered"}`;
    if (this._tuCache.has(cacheKey)) return this._tuCache.get(cacheKey);
    const data = this.streamOf(ref);
    const parsed = data ? this._parseToUnicode(data) : null;
    const mapping = preserveSpaces ? (parsed?.size ? parsed : null) : usableToUnicode(parsed);
    this._tuCache.set(cacheKey, mapping);
    return mapping;
  }


  cidToGid(descendant) {
    const entry = descendant.get("CIDToGIDMap");
    if (entry instanceof PdfRef) {
      const data = this.streamOf(entry);
      if (data && data.length) {
        const count = Math.floor(data.length / 2);
        const gids = new Array(count);
        for (let i = 0; i < count; i += 1) gids[i] = data.readUInt16BE(i * 2);
        return (cid) => (cid >= 0 && cid < gids.length ? gids[cid] : 0);
      }
    }
    return null;
  }


  pageFontResources(pageNum, pageGen = 0) {
    let page = this.resolve(new PdfRef(pageNum, pageGen));
    const fonts = new Map();
    const seen = new Set();
    let depth = 0;
    while (page instanceof Map && depth < 32) {
      const resources = this.resolve(page.get("Resources"));
      if (resources instanceof Map) {
        const fontDict = this.resolve(resources.get("Font"));
        if (fontDict instanceof Map) {
          for (const [name, entry] of fontDict) {
            if (!fonts.has(name)) fonts.set(name, entry);
          }
        }
      }
      const parent = page.get("Parent");
      if (!(parent instanceof PdfRef) || seen.has(parent.key())) break;
      seen.add(parent.key());
      page = this.resolve(parent);
      depth += 1;
    }
    return fonts;
  }
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


export class FontDecoder {
  constructor(name, {
    subtype = "", baseFont = "", isCid = false, cmap = null, toUnicode = null,
    encoding = null, hasEncoding = false, hasPdfEncoding = hasEncoding, ownGids = null, doc = null, cidToGid = null,
    zawcodeGlyphs = null, confirmedRawRuns = null, fontLegacyCodePage = null,
  } = {}) {
    this.name = name;
    this.subtype = subtype;
    this.baseFont = baseFont;
    this.isCid = isCid;
    this.cmap = cmap || new CMapEncoding(true);
    this.toUnicode = toUnicode;
    this.encoding = encoding || new Map();
    this.hasEncoding = hasEncoding;
    this.hasPdfEncoding = hasPdfEncoding;
    this.ownGids = ownGids || new Map();
    this.zawcodeGlyphs = zawcodeGlyphs;
    this.confirmedRawRuns = confirmedRawRuns;
    this.fontLegacyCodePage = fontLegacyCodePage;
    this.doc = doc !== null ? doc : new DocumentDecoding("none");
    this._cidToGid = cidToGid;
    this._conflictingSpaceMap = false;
    if (this.doc.kind === "font" && this.isCid && this.toUnicode && this.ownGids.direct?.size) {
      let contradictions = 0;
      const groups = this.toUnicode.byWidth || new Map([[2, this.toUnicode]]);
      for (const [width, entries] of groups) {
        for (const [code, value] of entries) {
          if (value !== " ") continue;
          const cid = this.cmap.cidFor(code, width);
          const gid = this.gidFor(cid);
          const cp = this.ownGids.direct.get(gid);
          if (cp !== undefined && !SPACE_CODES.has(cp)) contradictions += 1;
        }
      }
      // Use only this resource's own direct cmap to detect a heavily
      // contradictory ToUnicode map. A few shaped clusters are not enough.
      this._conflictingSpaceMap = contradictions >= 4 && contradictions / this.toUnicode.size >= 0.08;
    }
    // A mixed document can contain CID text alongside simple legacy fonts.
    // Use a substantial Myanmar ToUnicode map for that CID font's raw text,
    // not the other font's legacy table. This is not an encoding verdict;
    // sparse or space-dominated maps remain on the existing fallback path.
    const mappings = this.toUnicode ? [...this.toUnicode.values()] : [];
    const myanmarMappings = mappings.filter((v) => /[\u1000-\u109f]/u.test(v)).length;
    const spaceMappings = mappings.filter((v) => v === " ").length;
    this._unicodeCidInLegacyDocument = this.doc.kind === "legacy" && this.isCid
      && this.zawcodeGlyphs === null && mappings.length >= 8 && myanmarMappings >= 4
      && myanmarMappings * 2 >= mappings.length && spaceMappings * 2 < mappings.length;
  }

  get parsingPath() {
    // A font name is not a byte map. Only a matched resource profile supplies
    // legacy byte mappings; unsupported legacy faces remain unresolved.
    if (this.confirmedRawRuns || this.fontLegacyCodePage
        || isUnresolvedLegacyFont(this.baseFont)) return PDF_PARSING_PATHS.LEGACY;
    const name = normaliseFontName(this.baseFont);
    if (!this.isCid && !this.hasPdfEncoding && /^(?:wininnwa|arlarwade|ayar)/u.test(name)) {
      const unicodeMap = this.toUnicode && [...this.toUnicode.values()]
        .some((value) => /[\u1000-\u109f\ua9e0-\ua9ff\uaa60-\uaa7f]/u.test(value));
      if (!unicodeMap) return PDF_PARSING_PATHS.LEGACY;
    }
    return PDF_PARSING_PATHS.ZAWGYI_ONE;
  }

  get _isSelectedLegacyFont() {
    if (isUnresolvedLegacyFont(this.baseFont)) return false;
    if (this.fontLegacyCodePage) return true;
    const selected = this.doc.legacyFontNames;
    if (!selected) return true;
    const normalize = (name) => String(name || "")
      .replace(/^[A-Z]{6}\+/u, "")
      .replace(/[^A-Za-z0-9]+/gu, "")
      .toLowerCase();
    const actual = normalize(this.baseFont);
    return [...selected].some((name) => normalize(name) === actual);
  }

  get _trustedToUnicode() {
    if (!this.toUnicode) return null;
    if (this.doc.trustFontToUnicode || this._unicodeCidInLegacyDocument) return this.toUnicode;
    if (this.doc.kind === "legacy" && !this._isSelectedLegacyFont) return this.toUnicode;
    return null;
  }

  get needsLegacyTextFix() {
    return this.doc.legacyTextFix && !this._unicodeCidInLegacyDocument && this._isSelectedLegacyFont;
  }

  _legacyLookup(code) {
    const page = this.fontLegacyCodePage || this.doc.legacyCodePage;
    if (!page) return null;
    if (!this._isSelectedLegacyFont) return null;
    if (!this.toUnicode) {
      if (!isLegacyFontName(this.baseFont)) return null;
      const direct = page.get(code);
      return direct === undefined ? null : direct;
    }
    const src = this.toUnicode.get(code);
    if (!src) return null;
    let out = "";
    for (const ch of src) {
      const hit = page.get(ch.codePointAt(0));
      if (hit === undefined) return null;
      out += hit;
    }
    return out;
  }




  _docLookup(key, cid = null) {
    if (this.zawcodeGlyphs !== null) {
      const hit = this.zawcodeGlyphs.get(key);
      return hit === undefined ? null : hit;
    }
    if (this.doc.map === IDENTITY) return mapCode(IDENTITY, key);
    if (this.doc.keyKind === "gid" && this.ownGids.size) {
      const hit = this.ownGids.get(key);
      if (hit !== undefined) return typeof hit === "number" ? pyChr(hit) : hit;















      const own = cid !== null && this.toUnicode ? this.toUnicode.get(cid) : undefined;
      if (own) {











        if (own.trim() !== "" || this._isSpaceGid(cid)) return own;




        const repaired = this._vectorRepairLookup(key, cid);
        if (repaired !== null) return repaired;


        if (this.doc && this.doc.recordBlind) this.doc.recordBlind.add(key);
        return "";
      }
    }
    return mapCode(this.doc.map, key);
  }


  _isSpaceGid(gid) {
    if (this._spaceGids === undefined) {
      const set = new Set();
      for (const [g, uni] of this.ownGids) {
        if (typeof uni === "number" && SPACE_CODES.has(uni)) set.add(g);
      }
      this._spaceGids = set;
    }


    return this._spaceGids.size === 0 || this._spaceGids.has(gid);
  }







  _vectorRepairLookup(key, cid = null) {
    const repair = this.doc ? this.doc.vectorRepair : null;
    if (!repair || !repair.byGid || !repair.byGid.size) return null;
    for (const candidate of [cid, key]) {
      if (candidate === null || candidate === undefined) continue;
      const hit = repair.byGid.get(candidate);
      if (hit !== undefined && hit !== null) return hit;
    }
    return null;
  }

  gidFor(cid) {
    if (this._cidToGid === null || this._cidToGid === undefined) return cid;
    return this._cidToGid(cid);
  }


  decodeCode(code, cid = null, width = this.isCid ? 2 : 1, useConfirmed = true) {
    if (isUnresolvedLegacyFont(this.baseFont)
        || (useConfirmed && this.confirmedRawRuns?.unresolved.has(code))) return null;
    // These are raw PDF codes, not /ToUnicode values or physical key positions.
    const confirmed = useConfirmed && !this.isCid ? this.confirmedRawRuns?.bytes?.get(code) : undefined;
    if (confirmed !== undefined) return confirmed;
    if (!this.isCid && this.doc.kind === "font" && this.fontLegacyCodePage) {
      const bridged = this._legacyLookup(code);
      if (bridged !== null) return bridged;
    }
    const tu = this._trustedToUnicode;
    const hit = tu?.byWidth ? tu.byWidth.get(width)?.get(code) : tu?.get(code);
    if (this.isCid && this.doc.kind === "font" && this._conflictingSpaceMap) {
      // Reuse the existing font-cmap parser for this resource when its
      // ToUnicode map is dominated by contradictory space mappings. Do not
      // invent a new direct encoding or use a different font's glyph IDs.
      const localCid = cid === null ? code : cid;
      const gid = this.gidFor(localCid);
      if (!this.ownGids.ambiguous?.has(gid)) {
        const local = this._docLookup(gid, localCid);
        if (local !== null) return local;
      }
    }
    if (hit !== undefined) return hit;
    if (!this.isCid) {
      const bridged = this._legacyLookup(code);
      if (bridged !== null) return bridged;
      if (this.hasEncoding) {
        const encoded = this.encoding.get(code);
        return encoded === undefined ? null : encoded;
      }
      return this._docLookup(code);
    }
    cid = cid === null ? code : cid;
    const key = (this.doc.keyKind === "code" || this.doc.map === IDENTITY) ? cid : this.gidFor(cid);
    return this._docLookup(key, cid);
  }


  decode(data, { useConfirmed = true, skipUnknown = false } = {}) {
    if (!data) return "";
    if (isUnresolvedLegacyFont(this.baseFont)) {
      if (skipUnknown) return "";
      // Keep raw character codes visible rather than applying a different
      // font's map, /ToUnicode, or a document-wide glyph fallback.
      const codes = this.isCid
        ? [...this.cmap.iterCodes(data)].map(([code]) => code)
        : Array.from(data, (ch) => ch.charCodeAt(0));
      const width = this.isCid ? 4 : 2;
      return codes.map((code) => `[${code.toString(16).toUpperCase().padStart(width, "0")}]`).join("");
    }
    if (this.zawcodeGlyphs !== null && this.doc.zawcodeStats) {
      this.doc.zawcodeStats.glyphs += Math.floor(data.length / 2);
    }
    let out = "";
    if (this.isCid) {
      for (const [code, cid, width, invalid] of this.cmap.iterCodes(data)) {
        const text = invalid ? null : this.decodeCode(code, cid, width, useConfirmed);
        if (text !== null) out += text;
        else if (!skipUnknown) out += `[${code.toString(16).toUpperCase().padStart(width * 2, "0")}]`;
      }
      return out;
    }
    for (let i = 0; i < data.length; i += 1) {
      const code = data.charCodeAt(i);
      if (useConfirmed && this.confirmedRawRuns) {
        const run = confirmedRunAt(this.confirmedRawRuns, data, i);
        if (run) {
          out += run.text;
          i += run.bytes.length - 1;
          continue;
        }
        if (this.confirmedRawRuns.unresolved.has(code)) {
          if (!skipUnknown) out += `[${code.toString(16).toUpperCase().padStart(2, "0")}]`;
          continue;
        }
      }
      let text = this.decodeCode(code, null, 1, useConfirmed);
      if (text === null) {
        text = ((code < 0x20 || (code >= 0x7f && code <= 0x9f)) && code !== 0x09 && code !== 0x0a && code !== 0x0d)
          ? "" : pyChr(code);
      }
      out += text;
    }
    return out;
  }
}





















export class UnsetFontDecoder extends FontDecoder {


  static _hasNulByte(s) {
    for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) === 0) return true;
    return false;
  }

  decode(data) {
    if (!data) return "";
    if (data instanceof PdfHexBytes) {
      const s = data.s;
      let out = "";
      for (let i = 0; i + 1 < s.length; i += 2) {
        const code = (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1);
        const text = this._docLookup(code);
        out += text !== null ? text : `[${code.toString(16).toUpperCase().padStart(4, "0")}]`;
      }
      return out;
    }


    const byteCodes = this.doc.keyKind === "gid" && !UnsetFontDecoder._hasNulByte(data);
    const winAnsi = byteCodes ? BASE_ENCODINGS.get("WinAnsiEncoding") : null;
    let out = "";
    for (let i = 0; i < data.length; i += 1) {
      const code = data.charCodeAt(i);
      const simple = winAnsi ? winAnsi.get(code) : undefined;
      if (simple !== undefined) {
        out += simple;
        continue;
      }
      const text = this._docLookup(code);
      out += text !== null ? text : pyChr(code);
    }
    return out;
  }
}

export function buildFontDecoder(loader, name, entry, doc) {
  const font = loader.resolve(entry);
  if (!(font instanceof Map)) return new FontDecoder(name, { doc });
  const subtype = font.get("Subtype") instanceof PdfName ? String(loader.resolve(font.get("Subtype"))) : "";
  const baseFontVal = loader.resolve(font.get("BaseFont"));
  const baseFont = baseFontVal !== undefined && baseFontVal !== null ? String(baseFontVal) : "";
  if (subtype === "Type0") {
    const encodingRaw = font.get("Encoding");
    const encoding = loader.resolve(encodingRaw);
    let cmap;
    if (encoding instanceof PdfName) {
      cmap = new CMapEncoding(true);
    } else if (encodingRaw instanceof PdfRef) {
      const data = loader.streamOf(encodingRaw);
      cmap = data ? parseCmapStream(data) : new CMapEncoding(true);
    } else {
      cmap = new CMapEncoding(true);
    }
    const descendants = loader.resolve(font.get("DescendantFonts"));
    let descendant = new Map();
    if (Array.isArray(descendants) && descendants.length) {
      const resolved = loader.resolve(descendants[0]);
      if (resolved instanceof Map) descendant = resolved;
    }
    const descriptor = descendant.get("FontDescriptor");
    let zawcodeGlyphs = null;
    if (doc.zawcodeProfiles && encoding instanceof PdfName && String(encoding) === "Identity-H") {
      const cidMap = loader.resolve(descendant.get("CIDToGIDMap"));
      const identityGids = cidMap == null || (cidMap instanceof PdfName && String(cidMap) === "Identity");
      const resolved = loader.resolve(descriptor);
      const program = identityGids && resolved instanceof Map ? loader.streamOf(resolved.get("FontFile2")) : null;
      const digest = program ? createHash("sha256").update(program).digest("hex") : null;
      const profile = digest && doc.zawcodeProfiles[digest];
      if (profile) {
        const template = profile.template ? doc.zawcodeTemplates?.[profile.template] : profile;
        if (!template) throw new Error(`Missing ZawCode draft template for ${digest}`);
        const alternatives = { ...(template.alternatives ?? {}), ...(profile.alternatives ?? {}) };
        const glyphs = { ...(template.glyphs ?? {}), ...(profile.glyphs ?? {}) };
        const orderGlyphs = { ...(template.orderGlyphs ?? {}), ...(profile.orderGlyphs ?? {}) };
        zawcodeGlyphs = new Map(Object.entries(glyphs)
          .filter(([gid]) => !Object.hasOwn(alternatives, gid))
          .map(([gid, value]) => [Number.parseInt(gid, 16), value]));
        for (const [gid, entry] of Object.entries(orderGlyphs)) {
          if (Object.hasOwn(alternatives, gid)) continue;
          const key = Number.parseInt(gid, 16);
          if (zawcodeGlyphs.has(key) && zawcodeGlyphs.get(key) !== entry.slot) zawcodeGlyphs.delete(key);
          else zawcodeGlyphs.set(key, entry.slot);
        }
      }
    }
    // A matched profile reads raw GIDs only. Other font resources retain
    // their own ToUnicode/encoding rather than inheriting this profile.
    const toUnicode = zawcodeGlyphs === null
      ? loader.tounicodeOf(font, { preserveSpaces: doc.kind === "font" }) : null;
    const ownGids = zawcodeGlyphs === null ? loader.reversedFontCmap(descriptor) : new Map();
    return new FontDecoder(name, {
      subtype, baseFont, isCid: true, cmap, toUnicode, ownGids, doc, zawcodeGlyphs,
      hasPdfEncoding: font.has("Encoding"), cidToGid: loader.cidToGid(descendant),
    });
  }

  const [encoding, declared] = buildSimpleEncoding(font.get("Encoding"), (v) => loader.resolve(v));
  const descriptor = loader.resolve(font.get("FontDescriptor"));
  const normalizedFont = normaliseFontName(baseFont);
  let bridge = null;
  if (doc.kind === "legacy" && descriptor instanceof Map
      && /^(?:wininnwa|arlarwade|amyanmar|ayar)/u.test(normalizedFont)) {
    const program = loader.streamOf(descriptor.get("FontFile2"));
    const digest = program ? createHash("sha256").update(program).digest("hex") : null;
    const toUnicodeStream = loader.streamOf(font.get("ToUnicode"));
    const toUnicodeSha256 = toUnicodeStream ? createHash("sha256").update(toUnicodeStream).digest("hex") : null;
    // The bridge describes this exact font resource and its encoding, not the
    // PDF file. Unmatched resources never inherit another subset's byte map.
    bridge = subsetFontBridge({
      fontSha256: digest, toUnicodeSha256, baseFont: normalizedFont,
      firstChar: font.get("FirstChar"), lastChar: font.get("LastChar"),
      hasEncoding: font.has("Encoding"),
    });
  }
  const confirmedRawRuns = bridge?.rawRuns || null;
  const ownGids = loader.reversedFontCmap(font.get("FontDescriptor"));
  const toUnicode = loader.tounicodeOf(font, { preserveSpaces: doc.kind === "font" });
  return new FontDecoder(name, {
    subtype, baseFont, isCid: false, toUnicode, encoding, hasEncoding: declared,
    hasPdfEncoding: font.has("Encoding"), ownGids, doc,
    confirmedRawRuns, fontLegacyCodePage: bridge?.codePage || null,
  });
}


export function pageFontDecoders(loader, pageNum, pageGen, doc) {
  const cacheKey = `${pageNum},${pageGen}`;
  if (doc._pageFonts.has(cacheKey)) return doc._pageFonts.get(cacheKey);
  const decoders = new Map();
  for (const [name, entry] of loader.pageFontResources(pageNum, pageGen)) {
    const key = entry instanceof PdfRef ? entry.key() : `${pageNum},${pageGen},${name}`;
    let decoder = doc._decoders.get(key);
    if (decoder === undefined) {
      decoder = buildFontDecoder(loader, name, entry, doc);
      doc._decoders.set(key, decoder);
    }
    decoders.set(name, decoder);
  }
  doc._pageFonts.set(cacheKey, decoders);
  return decoders;
}
