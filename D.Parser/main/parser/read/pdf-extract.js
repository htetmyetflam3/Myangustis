import { parseTtfCmap } from "../core/ttf-cmap.mjs";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ValueError, pyTruthy, pyChr, pyInt, pyFloat, fromHexStrict, pyStripBytes } from "../core/pylib.mjs";
import { MAP_DIR } from "../core/paths.mjs";
import { MAX_PAGES, positiveLimit } from "../core/limits.mjs";
import {
  Lexer, PdfName, PdfHexBytes, isNumeric, toNumber,
  asDocumentDecoding, FontResourceLoader, UnsetFontDecoder, pageFontDecoders,
} from "./pdf-fonts.mjs";


export const MAX_STREAM_MB = positiveLimit("PRASER_MAX_STREAM_MB", 128, 512);
export const MAX_PDF_OBJECTS = positiveLimit("PRASER_MAX_OBJECTS", 250_000, 10_000_000);


export function zlibDecompressCapped(buf, limitMb = null) {
  const limit = (limitMb === null ? MAX_STREAM_MB : limitMb) * 1024 * 1024;
  if (buf.length === 0) return Buffer.alloc(0);
  try {
    const out = zlib.inflateSync(buf, { maxOutputLength: limit + (1 << 20) });
    if (out.length > limit) {
      throw new ValueError(`decompressed stream exceeds ${MAX_STREAM_MB} MB cap (decompression bomb?)`);
    }
    return out;
  } catch (e) {
    if (e instanceof ValueError) throw e;
    if (e && (e.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|buffer too large/i.test(String(e.message)))) {
      throw new ValueError(`decompressed stream exceeds ${MAX_STREAM_MB} MB cap (decompression bomb?)`);
    }
    
    const salvaged = inflateTolerant(buf, limit);
    if (salvaged !== null) return salvaged;
    throw e;
  }
}

function inflateTolerant(buf, limit) {
  const infl = new zlib.Inflate();
  const chunks = [];
  let size = 0;
  let failed = false;
  infl.on("error", () => { failed = true; });
  try {
    infl.write(buf);
    for (const c of infl.read(null)) {
      size += c.length;
      if (size > limit) {
        throw new ValueError(`decompressed stream exceeds ${MAX_STREAM_MB} MB cap (decompression bomb?)`);
      }
      chunks.push(c);
    }
  } catch (e) {
    if (e instanceof ValueError) throw e;
    
    if (!chunks.length) return null;
  }
  if (failed && !chunks.length) return null;
  if (!chunks.length) return null;
  return Buffer.concat(chunks);
}





const B_ENDOBJ = Buffer.from("endobj");
const B_STREAM = Buffer.from("stream");
const B_ENDSTREAM = Buffer.from("endstream");
const B_FLAKE = Buffer.from("/FlateDecode");

const isDigit = (c) => c >= 0x30 && c <= 0x39;

const isWsByte = (c) => c === 0x20 || (c >= 0x09 && c <= 0x0d);

export function parsePdfObjects(raw) {
  const objects = new Map();
  const n = raw.length;
  let i = 0;
  while (i < n) {
    if (!isDigit(raw[i])) { i += 1; continue; }
    let j = i;
    while (j < n && isDigit(raw[j])) j += 1;
    const numStr = raw.toString("latin1", i, j);
    let k = j;
    while (k < n && isWsByte(raw[k])) k += 1;
    if (k === j || k >= n || !isDigit(raw[k])) { i = j; continue; }
    let m = k;
    while (m < n && isDigit(raw[m])) m += 1;
    const genStr = raw.toString("latin1", k, m);
    let p = m;
    while (p < n && isWsByte(raw[p])) p += 1;
    if (p - m === 0) { i = j; continue; }
    if (raw.toString("latin1", p, p + 3) === "obj") {
      const start = p + 3;
      const end = raw.indexOf(B_ENDOBJ, start);
      if (end !== -1) {
        const key = `${pyInt(numStr)},${pyInt(genStr)}`;
        objects.set(key, pyStripBytes(raw.subarray(start, end))); 
        if (objects.size > MAX_PDF_OBJECTS) {
          throw new ValueError(`PDF exceeds the ${MAX_PDF_OBJECTS} object cap`);
        }
      }
      i = start;
    } else {
      i = j;
    }
  }
  return objects;
}


export function getStream(objects, num, gen = 0) {
  const d = objects.get(`${num},${gen}`);
  if (d === undefined) return null;
  const i = d.indexOf(B_STREAM);
  if (i === -1) return null;
  let j = i + 6;
  if (j < d.length && d[j] === 0x0d) j += 1; 
  if (j < d.length && d[j] === 0x0a) j += 1; 
  const k = d.lastIndexOf(B_ENDSTREAM);
  if (k === -1) return null;
  const b = d.subarray(j, k);
  if (d.subarray(0, i).includes(B_FLAKE)) {
    try {
      return zlibDecompressCapped(b);
    } catch (e) {
      if (e instanceof ValueError) throw e; 
      return null;
    }
  }
  return b;
}

/**
 * Read the document's own /Info dictionary -- Title, Author, Creator,
 * Producer, CreationDate. This is what identifies a broken document later:
 * "LibreOffice 3.6" or a given Creator is usually the real explanation for a
 * whole family of bad PDFs.
 *
 * Two bugs lived here and are fixed:
 *
 *   1. It searched the CATALOG for /Info. /Info is in the TRAILER, so the
 *      search never matched and the function returned {} for every PDF ever
 *      passed to it. That is why nothing noticed it was unwired.
 *   2. It read only literal `(...)` strings. Real producers write hex
 *      `<FEFF...>` UTF-16BE, so even a found dictionary lost Author, Creator
 *      and Producer and kept only CreationDate.
 *
 * `raw` is optional: without it the old Catalog path is still tried, so
 * callers that only have the object map keep working.
 */
export function extractMetadata(objects, raw = null) {
  const infoRef = findInfoRef(objects, raw);
  if (infoRef === null) return {};
  const body = objects.get(infoRef);
  if (body === undefined) return {};
  return parseInfoDict(body.toString("latin1"));
}

/** `/Info N G R`, from the trailer first, then the catalog as a fallback. */
function findInfoRef(objects, raw) {
  if (raw) {
    const text = Buffer.isBuffer(raw) ? raw.toString("latin1") : String(raw);
    // Last trailer wins: an incrementally-updated PDF appends newer ones.
    let found = null;
    const re = /trailer[\s\S]{0,2048}?\/Info\s+(\d+)\s+(\d+)\s*R/g;
    let m;
    while ((m = re.exec(text)) !== null) found = `${pyInt(m[1])},${pyInt(m[2])}`;
    if (found !== null) return found;
  }
  for (const [, d] of objects) {
    const dStr = d.toString("latin1");
    if (!/\/Type\s*\/Catalog/.test(dStr)) continue;
    const m = /\/Info\s+(\d+)\s+(\d+)\s*R/.exec(dStr);
    return m ? `${pyInt(m[1])},${pyInt(m[2])}` : null;
  }
  return null;
}

/** /Key (literal) and /Key <hex> pairs, one pass, values decoded. */
function parseInfoDict(text) {
  const out = {};
  const re = /\/([^\s/[\]<>(){}]+)\s*(?:\(((?:[^\\)]|\\[\s\S])*)\)|<([0-9A-Fa-f\s]*)>)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const value = m[2] !== undefined ? decodeLiteral(m[2]) : decodeHex(m[3]);
    if (value !== "") out[key] = value;
  }
  return out;
}

const ESCAPES = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };

function decodeLiteral(body) {
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== "\\") { out += body[i]; continue; }
    const next = body[i + 1];
    if (next === undefined) break;
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
    if (octal) { out += String.fromCharCode(parseInt(octal[0], 8)); i += octal[0].length; continue; }
    if (next === "\n") { i += 1; continue; }            // line continuation
    out += ESCAPES[next] ?? next;
    i += 1;
  }
  return decodeTextString(Buffer.from(out, "latin1"));
}

function decodeHex(body) {
  let hex = (body || "").replace(/\s+/g, "");
  if (hex.length % 2 === 1) hex += "0";                 // spec: pad a trailing nibble
  if (!hex) return "";
  return decodeTextString(Buffer.from(hex, "hex"));
}

/** PDF text strings are UTF-16 with a BOM, or PDFDocEncoding (latin1-ish). */
function decodeTextString(buf) {
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return buf.subarray(2).swap16().toString("utf16le").replace(/\0+$/u, "");
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le").replace(/\0+$/u, "");
  }
  return buf.toString("latin1");
}


const FONT_STREAM_RE = /\/FontFile(?:2|3)?\s+(\d+)\s+(\d+)\s+R/g;

export function findFontStreams(objects) {
  const refs = [];
  const seen = new Set();
  for (const d of objects.values()) {
    const dStr = d.toString("latin1");
    FONT_STREAM_RE.lastIndex = 0;
    let m;
    while ((m = FONT_STREAM_RE.exec(dStr)) !== null) {
      const ref = [pyInt(m[1]), pyInt(m[2])];
      const k = ref.join(",");
      if (!seen.has(k)) { seen.add(k); refs.push(ref); }
    }
  }
  return refs;
}

export const findFontFiles2 = findFontStreams; 


export function utf16beToStr(hexStr) {
  // PDF hex strings may contain an odd number of nibbles; ISO 32000 says the
  // final nibble is padded with zero. Keep that PDF-specific rule here rather
  // than weakening fromHexStrict for its other callers.
  const padded = hexStr.length % 2 === 0 ? hexStr : `${hexStr}0`;
  return utf16beBytesToStr(fromHexStrict(padded));
}

function utf16beBytesToStr(raw) {
  if (raw.length % 2 !== 0) {
    return swapUtf16BE(raw.subarray(0, raw.length - 1)) + "\uFFFD";
  }
  return swapUtf16BE(raw);
}

function swapUtf16BE(raw) {
  const swapped = Buffer.allocUnsafe(raw.length);
  for (let i = 0; i + 1 < raw.length; i += 2) {
    swapped[i] = raw[i + 1];
    swapped[i + 1] = raw[i];
  }
  
  
  const s = swapped.toString("utf16le");
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const lo = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (lo >= 0xdc00 && lo <= 0xdfff) { out += s[i] + s[i + 1]; i += 1; continue; }
      out += "\uFFFD";
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += "\uFFFD";
    } else out += s[i];
  }
  return out;
}

const BFCHAR_RE = /beginbfchar([\s\S]*?)endbfchar/g;
const BFCHAR_PAIR_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
const BFRANGE_RE = /beginbfrange([\s\S]*?)endbfrange/g;
const BFRANGE_SCALAR_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
const BFRANGE_ARRAY_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
const HEX_TOKEN_RE = /<([0-9A-Fa-f]+)>/g;
const BRACKET_SPAN_RE = /\[[\s\S]*?\]/g;

/* One token of a CMap body: a `<hex>` string, or a bracketed destination
   list. Tokenising is what keeps entries apart.

   The old readers were bare regexes over the whole block, and the scalar
   bfrange reader in particular was three hex tokens separated by `\s*` --
   which matches newlines. So in a block like

       6 beginbfrange
       <0100> <0101> [<0020> <103C>]
       <0102> <0103> <1017>
       endbfrange

   the array entry left `<0102> <0103>` standing next to `<0104> <010A>` two
   lines down, and the reader glued the tail of one entry to the head of the
   next: lo 0x103, hi 0x1017, destination 0x104. It expanded that into 3,605
   mappings, each code one past the last, so gid 0x148 -- which the very same
   CMap defines as U+1021 (အ) -- was overwritten with U+0149 (Å‰) and the page
   came out as Latin Extended-B. Reading one entry at a time cannot splice two
   entries together, so the phantom range is never formed. */
const CMAP_TOKEN_RE = /<([0-9A-Fa-f]+)>|\[([\s\S]*?)\]/g;

function* cmapTokens(body) {
  CMAP_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = CMAP_TOKEN_RE.exec(body)) !== null) {
    yield m[1] !== undefined ? { hex: m[1] } : { array: m[2] };
  }
}

/* A code is one or two bytes, so 65,536 destinations is the most one bfrange
   can honestly cover. A wider span is a misread token, not a big font. */
const MAX_BFRANGE_CODES = 0x10000;
/* A JavaScript Map holds at most 2**24 - 1 entries and throws RangeError past
   that -- an uncatchable-looking crash from inside a worker. Stop adding well
   before the ceiling so a document that really is this large degrades into a
   partial map instead of taking the conversion down. */
const MAX_TOUNICODE_ENTRIES = 1 << 20;

function incrementBigEndian(bytes) {
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    if (bytes[i] < 0xff) {
      bytes[i] += 1;
      return true;
    }
    bytes[i] = 0;
  }
  return false;
}

export function parseToUnicodeStream(data) {
  let text;
  try {
    text = data.toString("latin1");
  } catch {
    return new Map();
  }
  const mapping = new Map();
  const put = (code, value) => {
    if (mapping.size >= MAX_TOUNICODE_ENTRIES) return false;
    mapping.set(code, value);
    return true;
  };

  /* bfchar: `<src> <dst>` pairs, each pair one mapping. */
  BFCHAR_RE.lastIndex = 0;
  let m;
  while ((m = BFCHAR_RE.exec(text)) !== null) {
    let src = null;
    for (const tok of cmapTokens(m[1])) {
      if (src === null) {
        if (tok.hex !== undefined) src = Number(BigInt("0x" + tok.hex));
        continue;
      }
      if (tok.hex !== undefined && !put(src, utf16beToStr(tok.hex))) return mapping;
      src = null;
    }
  }

  /* bfrange: `<lo> <hi> <dst>` or `<lo> <hi> [<dst> <dst> ...]`. */
  BFRANGE_RE.lastIndex = 0;
  while ((m = BFRANGE_RE.exec(text)) !== null) {
    let lo = null;
    let hi = null;
    for (const tok of cmapTokens(m[1])) {
      if (lo === null) {
        if (tok.hex !== undefined) lo = Number(BigInt("0x" + tok.hex));
        continue;
      }
      if (hi === null) {
        if (tok.hex !== undefined) hi = Number(BigInt("0x" + tok.hex));
        else lo = null;
        continue;
      }
      if (tok.array !== undefined) {
        const items = [];
        HEX_TOKEN_RE.lastIndex = 0;
        let q;
        while ((q = HEX_TOKEN_RE.exec(tok.array)) !== null) items.push(q[1]);
        let i = 0;
        for (let code = lo; code <= hi; code += 1, i += 1) {
          if (i >= items.length) break;
          if (!put(code, utf16beToStr(items[i]))) return mapping;
        }
      } else {
        if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi < lo
            || hi - lo + 1 > MAX_BFRANGE_CODES) {
          lo = null;
          hi = null;
          continue;
        }
        // A bfrange destination is a UTF-16BE *byte string*, not a Unicode
        // scalar. Converting the whole token to a number and calling chr()
        // works for <0061>, but crashes on valid surrogate pairs such as
        // <D83DDE00> and on multi-code-unit mappings such as <00660069>. PDF
        // specifies that the byte string is incremented big-endian for each
        // source code.
        const raw = tok.hex.length % 2 === 0 ? tok.hex : `${tok.hex}0`;
        const destination = fromHexStrict(raw);
        for (let code = lo; code <= hi; code += 1) {
          if (!put(code, utf16beBytesToStr(destination))) return mapping;
          if (code < hi && !incrementBigEndian(destination)) break;
        }
      }
      lo = null;
      hi = null;
    }
  }
  return mapping;
}

const TOUNICODE_RE = /\/ToUnicode\s+(\d+)\s+\d+\s+R/g;


export function findToUnicodeMaps(objects) {
  const codeToUni = new Map();
  const seen = new Set();
  for (const d of objects.values()) {
    const dStr = d.toString("latin1");
    if (!dStr.includes("/ToUnicode")) continue;
    TOUNICODE_RE.lastIndex = 0;
    let m;
    while ((m = TOUNICODE_RE.exec(dStr)) !== null) {
      const tn = pyInt(m[1]);
      if (seen.has(tn)) continue;
      seen.add(tn);
      const s = getStream(objects, tn);
      if (!pyTruthy(s)) continue;
      const mp = parseToUnicodeStream(s);
      if (mp.size === 0) continue;
      let spaces = 0;
      for (const v of mp.values()) if (v === " ") spaces += 1;
      if (spaces / mp.size > 0.9) {
        for (const [k, v] of [...mp]) if (v === " ") mp.delete(k); 
      }
      for (const [code, uni] of mp) if (!codeToUni.has(code)) codeToUni.set(code, uni);
    }
  }
  return codeToUni;
}


export function loadSidecarMap(p = null) {
  const file = p ?? path.join(MAP_DIR, "cipher-map.json");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return new Map();
  }
  try {
    const json = JSON.parse(text);
    const out = new Map();
    for (const [k, v] of Object.entries(json)) {
      let key = k.trim();
      if (/^0[xX]/.test(key)) key = key.slice(2);
      out.set(Number(BigInt("0x" + key.replace(/_/g, ""))), String(v));
    }
    return out;
  } catch {
    return new Map();
  }
}


const MEDIABOX_RE = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/;
const PARENT_RE = /\/Parent\s+(\d+)\s+(\d+)\s+R/;

export function getPageMediabox(objects, pageNum, pageGen) {
  let d = objects.get(`${pageNum},${pageGen}`);
  if (d === undefined) d = Buffer.alloc(0);
  let text = d.toString("latin1");
  for (let hop = 0; hop < 8; hop += 1) {
    const m = MEDIABOX_RE.exec(text);
    if (m) {
      
      const [x0, y0, x1, y1] = [m[1], m[2], m[3], m[4]].map(pyFloat);
      return [Math.abs(x1 - x0), Math.abs(y1 - y0)];
    }
    const pm = PARENT_RE.exec(text);
    if (!pm) break;
    const parent = objects.get(`${pyInt(pm[1])},${pyInt(pm[2])}`);
    text = parent === undefined ? "" : parent.toString("latin1");
  }
  return [612.0, 792.0];
}

const RES_REF_RE = /\/Resources\s+(\d+)\s+\d+\s+R/;
const XOBJECT_REF_RE = /\/XObject\s+(\d+)\s+\d+\s+R/;
const SUBTYPE_IMAGE_RE = /\/Subtype\s*\/Image/;
const ANY_REF_RE = /(\d+)\s+\d+\s+R/g;

export function pageHasImages(objects, pageNum, pageGen) {
  const get = (refNum) => {
    const raw = objects.get(`${pyInt(refNum)},0`);
    return raw === undefined ? "" : raw.toString("latin1");
  };
  const pageBuf = objects.get(`${pageNum},${pageGen}`);
  const d = pageBuf === undefined ? "" : pageBuf.toString("latin1");
  let res = d;
  const m = RES_REF_RE.exec(d);
  if (m) res = get(m[1]);
  if (SUBTYPE_IMAGE_RE.test(res)) return true;
  const mx = XOBJECT_REF_RE.exec(res);
  const xo = mx ? get(mx[1]) : res;
  if (SUBTYPE_IMAGE_RE.test(xo)) return true;
  ANY_REF_RE.lastIndex = 0;
  let rm;
  while ((rm = ANY_REF_RE.exec(xo)) !== null) {
    if (SUBTYPE_IMAGE_RE.test(get(rm[1]))) return true;
  }
  return false;
}

export function collectPages(
  objects,
  pageNum,
  gen = 0,
  state = { visiting: new Set(), seenPages: new Set(), count: 0 },
) {
  const key = `${pageNum},${gen}`;
  if (state.visiting.has(key)) throw new ValueError("Cycle found in PDF page tree");
  const buf = objects.get(key);
  const dStr = buf === undefined ? "" : buf.toString("latin1");
  if (/\/Type\s*\/Page(?!s)/.test(dStr)) {
    if (state.seenPages.has(key)) return [];
    state.seenPages.add(key);
    state.count += 1;
    if (state.count > MAX_PAGES) {
      throw new ValueError(`PDF exceeds the ${MAX_PAGES} page cap`);
    }
    return [[pageNum, gen]];
  }
  if (/\/Type\s*\/Pages/.test(dStr)) {
    state.visiting.add(key);
    try {
      const pages = [];
      const km = /\/Kids\s*\[([\s\S]*?)\]/.exec(dStr);
      if (km) {
        const kidsText = km[1];
        ANY_REF_RE.lastIndex = 0;
        const refs = [];
        let r;
        while ((r = ANY_REF_RE.exec(kidsText)) !== null) refs.push(r[1]);
        for (const ref of refs) {
          
          pages.push(...collectPages(objects, pyInt(ref), 0, state));
        }
      }
      return pages;
    } finally {
      state.visiting.delete(key);
    }
  }
  return [];
}

export function findRootPages(objects) {
  for (const [key, d] of objects) {
    const dStr = d.toString("latin1");
    if (/\/Type\s*\/Catalog/.test(dStr)) {
      const pm = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(dStr);
      if (pm) return pyInt(pm[1]);
    }
  }
  return null;
}





export { IDENTITY, CmapIdentityMap, LegacyAyarMap, mapCode } from "./pdf-fonts.mjs";














export const ARLARWADE_AYAR_MAP = new Map([
  [33, "ြ"], [34, "ပ"], [35, "ည"], [36, "်"], [37, "ေ"], [38, "ထ"],
  [39, "ာ"], [40, "င"], [41, "စ"], [42, "ု"], [43, "သ"], [44, "မ"],
  [45, "္မ"], [46, "တ"], [47, "န"], [48, "န"], [49, "ိ"], [50, "ံ"],
  [51, "ရ"], [52, "း"], [53, "၀"], [54, "ြ"], [55, "က"], [56, "ီ"],
  [57, "ဌ"], [58, "အ"], [59, "ဖ"], [60, "ွ"], [61, "ဲ"], [62, "့"],
  [63, "ဥ"], [64, "ဒ"], [65, "ယ"], [66, "ှ"], [67, "ခ"], [68, "၂"],
  [69, "၀"], [70, "၁"], [71, "၃"], [72, "—"], [73, "၊"], [74, " "],
  [75, "လ"], [76, "ူ"], [77, "။"], [78, "က"], [79, "ျ"], [80, "ါ"],
  [81, "္ဒ"], [82, "ါ"], [83, "၅"], [84, "ဇ"], [85, "ံ"], [86, "့"],
  [87, "ြ"], [88, "ု"], [89, "၂"], [90, "၍"], [91, "ဝ"], [92, ""],
  [93, "ဉ"], [94, "ဏ"], [95, "ဆ"], [96, "၉"], [97, "၈"], [98, "၄"],
  [99, "ဘ"], [100, "၆"], [101, "ဤ"], [102, "ြ"], [103, "ခ"], [104, "ဂ"],
  [105, ""], [106, "ဗ"], [107, "ရ"], [108, "("], [109, ")"], [110, "ဃ"],
  [111, "၌"], [112, "ဈ"], [113, "ဍ"], [114, "ဎ"], [115, "၊"], [116, "ဝ"],
  [117, "စ"], [118, "ဗ"], [119, "ဝ"], [120, "ၺ"], [121, "ပ"],
]);
const DEP_MARKS = new Set(Array.from(
  "\u103b\u103c\u103d\u103e\u1031\u102d\u102e\u102f"
  + "\u1030\u1032\u102c\u102b\u1036\u103a\u1037\u1038",
).map((c) => c.codePointAt(0)));


export function fixDigitConsonantConfusion(text) {
  const letterOrMark = (ch) => {
    if (!ch) return false;
    const cp = ch.codePointAt(0);
    return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027
      || cp === 0x1039 || DEP_MARKS.has(cp);
  };
  const isDigit = (ch) => {
    if (!ch) return false;
    const cp = ch.codePointAt(0);
    return cp >= 0x1040 && cp <= 0x1049;
  };
  const isBase = (ch) => {
    if (!ch) return false;
    const cp = ch.codePointAt(0);
    return cp >= 0x1000 && cp <= 0x1021;
  };
  let out = Array.from(text);
  const n = out.length;
  for (let i = 0; i < n; i += 1) {
    const after = i + 1 < n ? out[i + 1] : "";
    const before = i > 0 ? out[i - 1] : "";
    if (out[i] === "\u1040") {
      
      if (DEP_MARKS.has((after || "").codePointAt(0)) || (letterOrMark(before) && letterOrMark(after))) {
        out[i] = "\u101d";
      } else if (!isDigit(before) && !letterOrMark(before) && isBase(after)) {
        
        out[i] = "\u101d";
      }
    }
  }
  text = out.join("");

  
  
  
  
  for (let pass = 0; pass < 3; pass += 1) {
    const chars = Array.from(text);
    let changed = false;
    for (let i = 0; i < chars.length; i += 1) {
      if (chars[i] !== "\u101b") continue;
      const before = i > 0 ? chars[i - 1] : "";
      const after = i + 1 < chars.length ? chars[i + 1] : "";
      if ((isDigit(before) || isDigit(after))
          && (!letterOrMark(after) || isDigit(after) || after === "\u101b")) {
        chars[i] = "\u1047";
        changed = true;
      }
    }
    text = chars.join("");
    if (!changed) break;
  }
  return text;
}


export function collapseOverprint(text) {
  const chars = Array.from(text);
  const n = chars.length;
  if (n < 2 || n > 9) return text;
  for (const size of [1, 2, 3]) {
    if (n % size !== 0 || Math.floor(n / size) < 2) continue;
    const unit = chars.slice(0, size).join("");
    if (unit.repeat(n / size) === text) return unit;
  }
  return text;
}


export function legacyAyarToUnicode(text) {
  text = text.replace(/\u200b/g, "");
  
  
  
  
  text = text.replace(
    /([ေြ]+)([က-အ၀၇၈])(င်္)?((?:္[က-အ])*)/g,
    (_m, vowel, base, kinzi, stacked) => (kinzi || "") + base + (stacked || "") + vowel,
  );

  
  
  
  
  
  text = text.replace(
    /([က-အ][ါ-ှ]*)(င်္)(?![က-အ])/g,
    "$2$1",
  );
  text = text.replace(/(ေ)([ျွဲှ္ြ]+)/g, "$2$1");
  text = text.replace(/([က-အ])([က-အ])(င်္)/g, "$1$3$2");
  
  
  text = text.replace(/ဦး/g, "ဦး");

  
  
  
  
  return fixDigitConsonantConfusion(text);
}










const INLINE_IMAGE_END_RE = /[\x00\x09-\x0d\x20]EI(?=[\x00\x09-\x0d\x20[\]<>/%(]|$)/g;

function skipInlineImage(data, pos) {
  INLINE_IMAGE_END_RE.lastIndex = pos;
  const m = INLINE_IMAGE_END_RE.exec(data);
  return m ? INLINE_IMAGE_END_RE.lastIndex : data.length;
}
function* iterContentOperations(data) {
  const lex = new Lexer(data);
  let operands = [];
  const containers = [];
  for (;;) {
    const tok = lex.nextToken();
    if (tok === null) break;
    const [kind, value] = tok;
    if (kind === "aopen") { containers.push({ type: "a", mark: operands.length }); continue; }
    if (kind === "dopen") { containers.push({ type: "d", mark: operands.length }); continue; }
    if (kind === "aclose" || kind === "dclose") {
      if (!containers.length) continue;
      const { type, mark } = containers.pop();
      const items = operands.splice(mark);
      if (type === "a") {
        operands.push(items);
      } else {
        const d = new Map();
        for (let i = 0; i < items.length - 1; i += 2) {
          if (items[i] instanceof PdfName) d.set(String(items[i]), items[i + 1]);
        }
        operands.push(d);
      }
      continue;
    }
    if (kind === "kw") {
      if (containers.length) { operands.push(value); continue; }
      const op = String(value);
      if (op === "ID") { 
        lex.pos = skipInlineImage(data, lex.pos);
        operands = [];
        continue;
      }
      yield [op, operands];
      operands = [];
      continue;
    }
    operands.push(value);
    if (!containers.length && operands.length > 64) {
      
      operands.splice(0, operands.length - 16);
    }
  }
}


function shownStrings(op, operands) {
  if (!operands.length) return [];
  if (op === "Tj" || op === "'" || op === '"') {
    const last = operands[operands.length - 1];
    return (typeof last === "string" || last instanceof PdfHexBytes) ? [last] : [];
  }
  if (op === "TJ") {
    const last = operands[operands.length - 1];
    if (Array.isArray(last)) return last.filter((item) => typeof item === "string" || item instanceof PdfHexBytes);
  }
  return [];
}


function documentLoader(doc, objects) {
  let { loader } = doc;
  if (loader === null || loader.objects !== objects) {
    loader = new FontResourceLoader(objects, getStream, parseTtfCmap, parseToUnicodeStream);
    doc.loader = loader;
    doc.resetFontCache();
  }
  return loader;
}

const CONTENTS_REF_RE = /\/Contents\s+(\d+)\s+\d+\s+R/;
const CONTENTS_ARR_RE = /\/Contents\s*\[([\s\S]*?)\]/;


export function extractPageLines(objects, pageNum, pageGen, decoding) {
  const doc = asDocumentDecoding(decoding);
  const loader = documentLoader(doc, objects);
  const decoders = pageFontDecoders(loader, pageNum, pageGen, doc);
  const unsetFont = new UnsetFontDecoder("", { doc });

  const pdBuf = objects.get(`${pageNum},${pageGen}`);
  const pdStr = pdBuf === undefined ? "" : pdBuf.toString("latin1");
  let streams = [];
  const cm = CONTENTS_REF_RE.exec(pdStr);
  if (cm) {
    streams = [pyInt(cm[1])];
  } else {
    const ca = CONTENTS_ARR_RE.exec(pdStr);
    if (ca) {
      ANY_REF_RE.lastIndex = 0;
      streams = [];
      let x;
      while ((x = ANY_REF_RE.exec(ca[1])) !== null) streams.push(pyInt(x[1]));
    }
  }

  const pieces = [];

  
  
  
  
  let active = null;

  for (const sn of streams) {
    const s = getStream(objects, sn);
    if (!pyTruthy(s)) continue;
    const content = s.toString("latin1");

    let inBlock = false;
    let blockTexts = [];
    let blockXy = null;
    let blockSize = null;
    let textXy = [0.0, 0.0];
    let leading = 0.0;

    for (const [op, operands] of iterContentOperations(content)) {
      if (op === "Tf") {
        if (operands.length >= 2 && operands[operands.length - 2] instanceof PdfName) {
          active = decoders.get(String(operands[operands.length - 2])) ?? null;
        }
        if (inBlock && operands.length && isNumeric(operands[operands.length - 1])) {
          blockSize = toNumber(operands[operands.length - 1]); 
        }
        continue;
      }

      if (op === "BT") {
        if (!inBlock) {
          inBlock = true;
          blockTexts = [];
          blockXy = null;
          blockSize = null;
          
          textXy = [0.0, 0.0];
          leading = 0.0;
        }
        continue;
      }

      if (!inBlock) continue;

      if (op === "Tm") {
        if (operands.length >= 6 && operands.slice(-6).every(isNumeric)) {
          textXy = [toNumber(operands[operands.length - 2]), toNumber(operands[operands.length - 1])];
          if (blockXy === null) blockXy = textXy;
        }
        continue;
      }

      
      
      if (op === "Td" || op === "TD") {
        if (operands.length >= 2 && operands.slice(-2).every(isNumeric)) {
          const dx = toNumber(operands[operands.length - 2]);
          const dy = toNumber(operands[operands.length - 1]);
          
          
          textXy = [textXy[0] + dx, textXy[1] + dy];
          if (op === "TD") leading = -dy;
          if (blockXy === null) blockXy = textXy;
        }
        continue;
      }

      if (op === "TL") {
        if (operands.length && isNumeric(operands[operands.length - 1])) {
          leading = toNumber(operands[operands.length - 1]);
        }
        continue;
      }

      if (op === "T*") {
        textXy = [textXy[0], textXy[1] - leading];
        if (blockXy === null) blockXy = textXy;
        continue;
      }

      if (op === "ET") {
        inBlock = false;
        if (blockTexts.length && blockXy !== null) {
          
          
          
          let text = blockTexts.join("");
          if (doc.legacyTextFix) text = collapseOverprint(text);
          pieces.push([blockXy[1], blockXy[0], blockSize === null ? 12.0 : blockSize, text]);
        }
        blockTexts = [];
        continue;
      }

      if (op === "Tj" || op === "TJ" || op === "'" || op === '"') {
        const decoder = active !== null ? active : unsetFont;
        for (const shown of shownStrings(op, operands)) {
          
          
          
          
          const arg = decoder instanceof UnsetFontDecoder || !(shown instanceof PdfHexBytes)
            ? shown : shown.s;
          blockTexts.push(decoder.decode(arg));
        }
      }
    }
  }

  
  
  
  
  
  
  
  
  
  const uniquePieces = [];
  for (const piece of pieces) {
    const [y, x, , text] = piece;
    let drop = false;
    for (let k = 0; k < uniquePieces.length; k += 1) {
      const [oldY, oldX, , oldText] = uniquePieces[k];
      if (Math.abs(x - oldX) > 1.0 || Math.abs(y - oldY) > 1.0) continue;
      if (text === oldText || oldText.includes(text)) {
        drop = true;
        break;
      }
      if (text.includes(oldText)) {
        
        uniquePieces[k] = piece;
        drop = true;
        break;
      }
    }
    if (!drop) uniquePieces.push(piece);
  }
  pieces.length = 0;
  pieces.push(...uniquePieces);

  const [pageW, pageH] = getPageMediabox(objects, pageNum, pageGen);
  if (!pieces.length) return [[], pageW, pageH];

  pieces.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));

  const lines = [];
  let currentY = pieces[0][0];
  let currentLine = [];
  const flush = () => {
    
    
    
    const ordered = [...currentLine].sort((p, q) => p[0] - q[0]);
    let maxSize = -Infinity;
    for (const [, s] of ordered) if (s > maxSize) maxSize = s;
    let joined = ordered.map(([, , t]) => t).join("");
    if (doc.legacyTextFix) joined = legacyAyarToUnicode(joined);
    lines.push([ordered[0][0], currentY, maxSize, joined]);
  };

  for (const [y, x, size, text] of pieces) {
    if (Math.abs(y - currentY) > 3) {
      flush();
      currentLine = [];
      currentY = y;
    }
    currentLine.push([x, size, text]);
  }
  if (currentLine.length) flush();

  return [lines, pageW, pageH];
}
const isAsciiDigitOrDot = (ch) => (ch >= "0" && ch <= "9") || ch === ".";
export function extractPageTextLayout(objects, pageNum, pageGen, codeToUni) {
  const [lines] = extractPageLines(objects, pageNum, pageGen, codeToUni);
  return lines.map((l) => l[3]).join("\n");
}

const MYA_LO = 0x1000;
const MYA_HI = 0x109f;

function hasMyanmarGlyphs(cmap) {
  for (const cp of cmap.keys()) if (cp >= MYA_LO && cp <= MYA_HI) return true;
  return false;
}
export function pickEmbeddedFont(objects, refs, log = () => {}) {
  let fallback = null;
  for (const ref of refs) {
    const ttf = getStream(objects, ref[0], ref[1]);
    if (!pyTruthy(ttf)) continue;
    const cmap = parseTtfCmap(ttf);
    if (hasMyanmarGlyphs(cmap)) {
      log(`[+] Chosen embedded font obj ${ref[0]} (contains Myanmar glyphs)`);
      return [ref, ttf, cmap];
    }
    if (fallback === null) fallback = [ref, ttf, cmap];
  }
  if (fallback !== null) {
    log(`[i] No Myanmar-glyph font found; using first font stream obj ${fallback[0][0]}`);
    return fallback;
  }
  return [null, null, new Map()];
}

export { hasMyanmarGlyphs };
