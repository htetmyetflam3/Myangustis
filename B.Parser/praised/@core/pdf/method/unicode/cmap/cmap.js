/*
(praised/decoding/pdf/font/cmap) cmap branch: decode by the font's own maps - glyph names, simple encodings, /ToUnicode CMaps (CMapEncoding, parseCmapStream), and code mapping helpers. Standard encoding tables live in encodings.js beside it.
*/
import { BASE_ENCODINGS, GLYPH_NAME_TO_UNICODE } from "../../pdfencoding/encodings.js";
import { PdfName } from "../../values.js";
import { pyChr } from "../../../../../core/@helper/pylib.js";

// Marker for the identity code->unicode lane (no map needed).
export const IDENTITY = Symbol("IDENTITY");

// A Map that IS the identity lane: code in, same code out.
export class CmapIdentityMap extends Map {}

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

// Font and object resources are reused across pages, but keeping every
// document resource forever defeats disk-backed PDF input on large books.
