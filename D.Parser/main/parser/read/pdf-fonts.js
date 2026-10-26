import { pyChr } from "../core/pylib.mjs";
import { BASE_ENCODINGS, GLYPH_NAME_TO_UNICODE } from "./pdf-encodings.mjs";
import { isLegacyFontName } from "../codepage/names.mjs";
import { parseTtfGsubReverse, parseTtfVariantSlots } from "../core/ttf-gsub.mjs";







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
    this.single = new Map();
    this.ranges = []; 
  }

  codeLengths() {
    return this.widths.size ? Array.from(this.widths).sort((a, b) => a - b) : [2];
  }

  cidFor(code) {
    if (this.identity) return code;
    const cid = this.single.get(code);
    if (cid !== undefined) return cid;
    for (const [lo, hi, base] of this.ranges) {
      if (lo <= code && code <= hi) return base + (code - lo);
    }
    return code;
  }

  _inSpace(_code, width) {
    return this.widths.has(width);
  }

  
  * iterCodes(data) {
    const lengths = this.codeLengths();
    let i = 0;
    const n = data.length;
    while (i < n) {
      let matched = false;
      for (const width of lengths) {
        if (i + width <= n) {
          let code = 0;
          for (let k = 0; k < width; k += 1) code = code * 256 + data.charCodeAt(i + k);
          if (this.identity || width === lengths[lengths.length - 1] || this._inSpace(code, width)) {
            yield [code, this.cidFor(code), width];
            i += width;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        const width = lengths[lengths.length - 1];
        let code = 0;
        for (let k = 0; k < width; k += 1) {
          code = code * 256 + (i + k < n ? data.charCodeAt(i + k) : 0);
        }
        yield [code, this.cidFor(code), width];
        i += width;
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
    while ((p = HEXPAIR_RE.exec(m[1])) !== null) enc.widths.add(Math.max(1, Math.floor(p[1].length / 2)));
  }
  CIDRANGE_RE.lastIndex = 0;
  while ((m = CIDRANGE_RE.exec(text)) !== null) {
    HEXNUM_RE.lastIndex = 0;
    let p;
    while ((p = HEXNUM_RE.exec(m[1])) !== null) {
      enc.ranges.push([Number.parseInt(p[1], 16), Number.parseInt(p[2], 16), Number.parseInt(p[3], 10)]);
    }
  }
  CIDCHAR_RE.lastIndex = 0;
  while ((m = CIDCHAR_RE.exec(text)) !== null) {
    HEXINT_RE.lastIndex = 0;
    let p;
    while ((p = HEXINT_RE.exec(m[1])) !== null) {
      enc.single.set(Number.parseInt(p[1], 16), Number.parseInt(p[2], 10));
    }
  }
  if (!enc.widths.size) enc.widths.add(2);
  if (!enc.ranges.length && !enc.single.size) enc.identity = true;
  return enc;
}






export const IDENTITY = Symbol("IDENTITY");


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
    this.keyKind = kind === "cmap" ? "gid" : "code";
    this.trustFontToUnicode = kind === "tounicode" || kind === "none";
    this.legacyTextFix = kind === "legacy";
    this.legacyCodePage = legacyCodePage;
    this.legacyFontNames = legacyFontNames ? new Set(legacyFontNames) : null;
    /* Glyph ids the cmap cannot name, recovered from their outlines by
       codepage/vector-repair.mjs. Consulted ONLY where the decoder would
       otherwise emit nothing, so it can never displace a glyph that
       already decoded. */
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

/* A shaped variant can be a variant of a variant: ု has a form for ာ and
   another for the descended consonants, and the second is reached from the
   first. Eight hops is far past any real Indic chain and stops a font whose
   tables loop back on themselves from hanging the extraction worker. */
const MAX_SHAPING_DEPTH = 8;

/* Code points that are a blank in every font, used to recognise the one gid a
   /ToUnicode " " entry may legitimately name. */
const SPACE_CODES = new Set([
  0x0009, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
]);

/**
 * Fill in the glyph ids the cmap cannot name.
 *
 * `table` is gid -> code point, built from the cmap. Every entry the reverse
 * GSUB table can explain is added as a STRING (one variant may stand for a
 * ligature of two code points), while the cmap's own entries stay numbers --
 * FontDecoder._docLookup accepts either.
 */
function resolveShapedGlyphs(fontBytes, table) {
  const reverse = parseTtfGsubReverse(fontBytes);
  if (!reverse.size) return table;
  const walking = new Set();
  const resolve = (gid, depth) => {
    const direct = table.get(gid);
    // A number is a cmap entry; a string is a variant this pass already
    // resolved (one shaped glyph can stand for a two-code-point ligature).
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

  /* Third pass: the positional forms neither the cmap nor a substitution can
     name. A family like {238, 240, 242, 246} is four interchangeable forms of
     the medial ra -- only one of which (238) has a Unicode to give -- so once
     any member is known the rest inherit it. Three rounds, because naming one
     family can name the next: the same table holds a parallel set for the
     medial ya that no member of resolves on its own. */
  const slots = parseTtfVariantSlots(fontBytes);
  for (let round = 0; round < 3; round += 1) {
    let added = false;
    for (const group of slots) {
      const unknown = group.filter((g) => !table.has(g));
      if (!unknown.length) continue;
      let best = undefined;
      let bestRank = Number.POSITIVE_INFINITY;
      for (const gid of group) {
        const value = table.get(gid);
        if (value === undefined) continue;
        const text = typeof value === "number" ? String.fromCodePoint(value) : value;
        if (!text) continue;
        // Direct cmap entries outrank anything GSUB had to derive, and a
        // single code point outranks a ligature: ြ names the family, ြွ does
        // not -- it is ြ with something else attached.
        const rank = (reverse.has(gid) ? 10 : 0) + (text.length > 1 ? 1 : 0);
        if (rank < bestRank) { bestRank = rank; best = value; }
      }
      if (best === undefined) continue;
      for (const gid of unknown) { table.set(gid, best); added = true; }
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
        // Several code points can share one glyph: AnonymousPro maps both
        // U+0020 and U+00F6 to gid 3. Reversing the cmap first-wins let
        // whichever the cmap happened to list first claim the glyph, so every
        // space in a document came back as a diaeresis. Take the lowest code
        // point, which keeps ASCII ahead of the Latin-1 supplement.
        for (const [uni, gid] of cmap) {
          if (!gid) continue;
          const prev = table.get(gid);
          if (prev === undefined || uni < prev) table.set(gid, uni);
        }
        /* Second pass: the vowel signs, medials and tone marks are not in
           the cmap at all -- shaping replaced them with positional variants
           whose glyph ids belong to no code point. Walk GSUB backwards so
           each variant is traced to the code point it was drawn instead of.
           Without this the identity fallback publishes the raw gid, and
           Myanmar text comes out as Latin-1 (`စပàဘငé`). */
        resolveShapedGlyphs(data, table);
      }
      this._gidCache.set(cacheKey, table);
      return table;
    }
    return new Map();
  }

  
  tounicodeOf(fontDict) {
    const ref = fontDict.get("ToUnicode");
    if (!(ref instanceof PdfRef)) return null;
    const cacheKey = ref.key();
    if (this._tuCache.has(cacheKey)) return this._tuCache.get(cacheKey);
    const data = this.streamOf(ref);
    const mapping = data ? usableToUnicode(this._parseToUnicode(data)) : null;
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
    if (!text.includes("/ToUnicode")) {
      const bf = baseFontRe.exec(text);
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

/**
 * The legacy-layout fonts' own faces: /BaseFont plus the /FontDescriptor
 * metrics, for every font detectLegacyLayoutFonts flagged. A PDF.js font id
 * (which never exposes the /BaseFont) carries the same ascent/descent, so a
 * pixel-identified face can be matched back to its real name by metrics --
 * the name the decode-time font gate is keyed on.
 */
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
    encoding = null, hasEncoding = false, ownGids = null, doc = null, cidToGid = null,
  } = {}) {
    this.name = name;
    this.subtype = subtype;
    this.baseFont = baseFont;
    this.isCid = isCid;
    this.cmap = cmap || new CMapEncoding(true);
    this.toUnicode = toUnicode;
    this.encoding = encoding || new Map();
    this.hasEncoding = hasEncoding;
    this.ownGids = ownGids || new Map();
    this.doc = doc !== null ? doc : new DocumentDecoding("none");
    this._cidToGid = cidToGid;
  }

  get _isSelectedLegacyFont() {
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
    if (this.doc.trustFontToUnicode) return this.toUnicode;
    // A vector-built layout identifies the actual Myanmar face by rendered
    // shape. Other simple fonts on the same page (DejaVu/Times headings in the
    // bg-mlc fixture) keep their own valid /ToUnicode instead of being pushed
    // through the document's Myanmar keyboard map.
    if (this.doc.kind === "legacy" && !this._isSelectedLegacyFont) return this.toUnicode;
    return null;
  }

  
  _legacyLookup(code) {
    const page = this.doc.legacyCodePage;
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

  
  /* `cid` is the code as the content stream wrote it; `key` is that code after
     CIDToGIDMap. They differ only for fonts that carry an explicit map. */
  _docLookup(key, cid = null) {
    if (this.doc.map === IDENTITY) return mapCode(IDENTITY, key);
    if (this.doc.keyKind === "gid" && this.ownGids.size) {
      const hit = this.ownGids.get(key);
      if (hit !== undefined) return typeof hit === "number" ? pyChr(hit) : hit;
      /* Where the font program is silent, ask the font's own /ToUnicode.

         A cmap is written from the font's point of view: it names a glyph
         only if some code point reaches it directly. Conjuncts and positional
         variants are reached by shaping, never by a code point, so they are
         absent from it -- and a subset that keeps no GSUB (this book's
         MyanmarText subsets keep none) then has NO path from those glyphs to
         text. They come out as their own glyph ids: U+01F6 printed as L·, the
         ဉ္ƒ conjunct of စဉ္ƒ.

         /ToUnicode is written from the page's point of view instead -- it says
         what each drawn code stands for -- so it does list them, often as
         several code points at once (`<1009103A>` for ဉ္ƒ). It is consulted
         only where the cmap has nothing, so a bad entry can never displace a
         good one. */
      const own = cid !== null && this.toUnicode ? this.toUnicode.get(cid) : undefined;
      if (own) {
        /* Not every glyph in that table is named correctly. The author has to
           account for every code the page draws, and for the ones whose
           meaning is not obvious -- a conjunct, a medial ra, a stacked pair --
           the filler of choice is a space. Left alone, နှင့် prints as
           "န င့်": the word is split where the unnamed glyph stood.

           So a space is believed only for a glyph the font's own cmap already
           reaches from a space code point; that is the font's real blank.
           Anywhere else the entry is that filler, and the honest reading is to
           draw nothing rather than to split the word or to publish a glyph id
           as a character. */
        if (own.trim() !== "" || this._isSpaceGid(cid)) return own;
        /* Nothing to draw, so the glyph would vanish. Ask the shape
           corpus first: the outline is still in the file even though its
           name is not. This is where the medials were being lost -- the
           reader saw အကီးအကဲ where the page said အကြီးအကဲ. */
        const repaired = this._vectorRepairLookup(key, cid);
        if (repaired !== null) return repaired;
        /* Set by the pipeline's probe pass, which walks a few pages first
           to learn which ids are unnameable before voting on them. */
        if (this.doc && this.doc.recordBlind) this.doc.recordBlind.add(key);
        return "";
      }
    }
    return mapCode(this.doc.map, key);
  }

  /* The gids this font reaches from a space code point, per its own cmap. */
  _isSpaceGid(gid) {
    if (this._spaceGids === undefined) {
      const set = new Set();
      for (const [g, uni] of this.ownGids) {
        if (typeof uni === "number" && SPACE_CODES.has(uni)) set.add(g);
      }
      this._spaceGids = set;
    }
    /* A cmap that knows no space at all cannot contradict the table, so the
       table's spaces stand. */
    return this._spaceGids.size === 0 || this._spaceGids.has(gid);
  }

  /**
   * A glyph id the cmap cannot name, read from its outline instead.
   *
   * Returns null when there is no repair table or this id is not in it,
   * so the caller keeps its existing behaviour.
   */
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

  
  decodeCode(code, cid = null) {
    const tu = this._trustedToUnicode;
    if (tu !== null) {
      const hit = tu.get(code);
      if (hit !== undefined) return hit;
    }
    if (!this.isCid) {
      const bridged = this._legacyLookup(code);
      if (bridged !== null) return bridged;
      if (this.hasEncoding) {
        const hit = this.encoding.get(code);
        return hit === undefined ? null : hit;
      }
      return this._docLookup(code);
    }
    cid = cid === null ? code : cid;
    const key = (this.doc.keyKind === "code" || this.doc.map === IDENTITY) ? cid : this.gidFor(cid);
    return this._docLookup(key, cid);
  }

  
  decode(data) {
    if (!data) return "";
    let out = "";
    if (this.isCid) {
      for (const [code, cid] of this.cmap.iterCodes(data)) {
        const text = this.decodeCode(code, cid);
        out += text !== null ? text : `[${code.toString(16).toUpperCase().padStart(4, "0")}]`;
      }
      return out;
    }
    for (let i = 0; i < data.length; i += 1) {
      const code = data.charCodeAt(i);
      let text = this.decodeCode(code);
      if (text === null) {
        text = ((code < 0x20 || (code >= 0x7f && code <= 0x9f)) && code !== 0x09 && code !== 0x0a && code !== 0x0d)
          ? "" : pyChr(code);
      }
      out += text;
    }
    return out;
  }
}

/**
 * The decoder used when a `Tf` names a font this page's resources do not hold
 * (or when text is drawn before any `Tf`). It has no /Encoding of its own, so
 * it falls back to the document-level decoding.
 *
 * One important asymmetry, and the reason this class is commented at length:
 * when the document decoding is the embedded-font cmap, its keys are GLYPH
 * IDS. A hex string under Identity-H really does carry glyph ids, so that
 * branch is right. A one-byte literal string does not: it carries character
 * codes for a simple font, and pushing those through a gid table silently
 * renumbers every character by the font's glyph order.
 *
 * That is not hypothetical. In the 100-page Zawgyi-One sample, Zawgyi-One
 * lays glyphs out at gid = ascii - 29, so byte 0x28 "(" resolved to gid 40,
 * whose cmap entry is "E"; ")" became "F", "G" became "d", '"' became "?".
 * The published sample output still shows "Eရှီယန်F" and "dod of plaughter"
 * from a build that took this path. Byte codes therefore go through
 * WinAnsiEncoding — the standard reading for a simple font — and only reach
 * the gid table when WinAnsi has nothing to say.
 */
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
  const toUnicode = loader.tounicodeOf(font);

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
    const ownGids = loader.reversedFontCmap(descendant.get("FontDescriptor"));
    return new FontDecoder(name, {
      subtype, baseFont, isCid: true, cmap, toUnicode, ownGids, doc,
      cidToGid: loader.cidToGid(descendant),
    });
  }

  const [encoding, declared] = buildSimpleEncoding(font.get("Encoding"), (v) => loader.resolve(v));
  const ownGids = loader.reversedFontCmap(font.get("FontDescriptor"));
  return new FontDecoder(name, {
    subtype, baseFont, isCid: false, toUnicode, encoding, hasEncoding: declared, ownGids, doc,
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
