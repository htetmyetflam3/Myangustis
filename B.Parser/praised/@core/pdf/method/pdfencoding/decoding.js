/*
(PDF 13) PDF branch, position 13 in the chain - after the instructions (PDF 11), before the page text is finished (PDF 19).
This module extracts one page's text lines: it spools the content (PDF 14), runs the font decoders (PDF 16) over the shown strings, tracks positions, and collects the page's images.
*/
import { parseTtfCmap } from "../unicode/ttf/ttf-cmap.js";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ValueError, pyTruthy, pyInt, fromHexStrict } from "../../../../core/@helper/pylib.js";
import { loadMapJson, mapNameForPath } from "../../../runtime/json-map.js";
import { OWNER_PARSER_WORKER, resourceLimit } from "../../../../@entry/helper/limit.js";
import { containsMyanmar } from "../../../../core/@rule/detect.js";
import { decodeVisualUnicodeRun } from "../legacy/codepage-visual.js";
import { Lexer, PdfName, PdfHexBytes, isNumeric, toNumber } from "../values.js";
import {
  asDocumentDecoding, DocumentDecoding, UnsetFontDecoder,
  pageFontDecoders, PDF_PARSING_PATHS,
} from "../decoder.js";
import { FontResourceLoader } from "../unicode/ttf.js";
import { LegacyAyarMap } from "../legacy/fallback.js";
import { spoolPageContent } from "../../pages/content.js";
import { PdfFileLexer } from "../../../runtime/lexer.js";
import { PdfPagePieces } from "../../pages/pages.js";
import { PageImageCollector } from "../../pages/image.js";


export const MAX_STREAM_MB = resourceLimit("PRASER_MAX_STREAM_MB", 128, 512);

// --- File-header validation (upfront, before any page is read) -----------
// Moved here from init/pdf/decrypt.js: these only look for marker bytes in
// the raw file - whether it is encrypted (/Encrypt) or uses object streams
// (/ObjStm) - without loading the file into the parser.
const ENCRYPT_MARK = Buffer.from("/Encrypt");
const OBJSTM_MARK = Buffer.from("/ObjStm");

export function isEncryptedPdf(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.includes(ENCRYPT_MARK);
}

export function hasObjectStreams(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.includes(OBJSTM_MARK);
}

// Match the byte-based checks without loading a path-backed PDF into memory.
export function scanPdfFileMarkers(source) {
  const fd = fs.openSync(source, "r");
  const block = Buffer.allocUnsafe(64 * 1024);
  let tail = Buffer.alloc(0);
  let encrypted = false;
  let objectStreams = false;
  let position = 0;
  try {
    while (true) {
      const count = fs.readSync(fd, block, 0, block.length, position);
      if (!count) break;
      position += count;
      const bytes = tail.length ? Buffer.concat([tail, block.subarray(0, count)]) : block.subarray(0, count);
      encrypted ||= bytes.includes(ENCRYPT_MARK);
      objectStreams ||= bytes.includes(OBJSTM_MARK);
      if (encrypted && objectStreams) break;
      tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - Math.max(ENCRYPT_MARK.length, OBJSTM_MARK.length) + 1)));
    }
    return { encrypted, objectStreams };
  } finally {
    fs.closeSync(fd);
  }
}
export const MAX_PDF_OBJECTS = resourceLimit("PRASER_MAX_OBJECTS", 250_000, 10_000_000);


export function zlibDecompressCapped(buf, limitMb = null) {
  const limit = (limitMb === null ? MAX_STREAM_MB : limitMb) * 1024 * 1024;
  if (buf.length === 0) return Buffer.alloc(0);
  try {
    const options = Number.isFinite(limit) ? { maxOutputLength: limit + (1 << 20) } : undefined;
    const out = zlib.inflateSync(buf, options);
    if (out.length > limit) {
      throw new ValueError(`decompressed stream exceeds ${MAX_STREAM_MB} MB cap (decompression bomb?)`);
    }
    return out;
  } catch (e) {
    if (e instanceof ValueError) throw e;
    if (e && (e.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|buffer too large/i.test(String(e.message)))) {
      if (!Number.isFinite(limit)) throw e;
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





const B_STREAM = Buffer.from("stream");
const B_ENDSTREAM = Buffer.from("endstream");
const B_FLAKE = Buffer.from("/FlateDecode");

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
      if (e instanceof ValueError || e?.code === "ERR_BUFFER_TOO_LARGE") throw e;
      return null;
    }
  }
  return b;
}



















export function extractMetadata(objects, raw = null) {
  const infoRef = findInfoRef(objects, raw);
  if (infoRef === null) return {};
  const body = objects.get(infoRef);
  if (body === undefined) return {};
  return parseInfoDict(body.toString("latin1"));
}


function findInfoRef(objects, raw) {
  if (raw) {
    const text = Buffer.isBuffer(raw) ? raw.toString("latin1") : String(raw);

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
    if (next === "\n") { i += 1; continue; }
    out += ESCAPES[next] ?? next;
    i += 1;
  }
  return decodeTextString(Buffer.from(out, "latin1"));
}

function decodeHex(body) {
  let hex = (body || "").replace(/\s+/g, "");
  if (hex.length % 2 === 1) hex += "0";
  if (!hex) return "";
  return decodeTextString(Buffer.from(hex, "hex"));
}


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




















const CMAP_TOKEN_RE = /<([0-9A-Fa-f]*)>|\[([\s\S]*?)\]/g;

function* cmapTokens(body) {
  CMAP_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = CMAP_TOKEN_RE.exec(body)) !== null) {
    yield m[1] !== undefined ? { hex: m[1] } : { array: m[2] };
  }
}



const MAX_BFRANGE_CODES = OWNER_PARSER_WORKER ? Infinity : 0x10000;




const MAX_TOUNICODE_ENTRIES = OWNER_PARSER_WORKER ? Infinity : (1 << 20);

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
  // The same numeric value can occur at different source widths (<01> and
  // <0001>). Keep them distinct for resource-local PDF decoding.
  mapping.byWidth = new Map();
  mapping.codeSpaces = [];
  const spaces = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  for (const block of text.matchAll(spaces)) {
    for (const match of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const width = match[1].length / 2;
      if (Number.isInteger(width) && width >= 1 && width <= 4 && match[2].length === match[1].length) {
        mapping.codeSpaces.push([width, parseInt(match[1], 16), parseInt(match[2], 16)]);
      }
    }
  }
  const put = (code, value, width) => {
    if (mapping.size >= MAX_TOUNICODE_ENTRIES) return false;
    if (!mapping.byWidth.has(width)) mapping.byWidth.set(width, new Map());
    mapping.byWidth.get(width).set(code, value);
    mapping.set(code, value);
    return true;
  };


  BFCHAR_RE.lastIndex = 0;
  let m;
  while ((m = BFCHAR_RE.exec(text)) !== null) {
    let src = null;
    for (const tok of cmapTokens(m[1])) {
      if (src === null) {
        if (tok.hex && tok.hex.length <= 8 && tok.hex.length % 2 === 0) {
          src = { code: parseInt(tok.hex, 16), width: tok.hex.length / 2 };
        }
        continue;
      }
      if (tok.hex !== undefined && !put(src.code, utf16beToStr(tok.hex), src.width)) return mapping;
      src = null;
    }
  }


  BFRANGE_RE.lastIndex = 0;
  while ((m = BFRANGE_RE.exec(text)) !== null) {
    let lo = null;
    let hi = null;
    let width = null;
    for (const tok of cmapTokens(m[1])) {
      if (lo === null) {
        if (tok.hex && tok.hex.length <= 8 && tok.hex.length % 2 === 0) {
          lo = parseInt(tok.hex, 16);
          width = tok.hex.length / 2;
        }
        continue;
      }
      if (hi === null) {
        if (tok.hex && tok.hex.length === width * 2) hi = parseInt(tok.hex, 16);
        else lo = null;
        continue;
      }
      if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi < lo
          || hi - lo + 1 > MAX_BFRANGE_CODES) {
        lo = null;
        hi = null;
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
          if (!put(code, utf16beToStr(items[i]), width)) return mapping;
        }
      } else {
        if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi < lo
            || hi - lo + 1 > MAX_BFRANGE_CODES) {
          lo = null;
          hi = null;
          continue;
        }






        const raw = tok.hex.length % 2 === 0 ? tok.hex : `${tok.hex}0`;
        const destination = fromHexStrict(raw);
        for (let code = lo; code <= hi; code += 1) {
          if (!put(code, utf16beBytesToStr(destination), width)) return mapping;
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
  try {
    const name = p ? mapNameForPath(p) : "cipher-map.json";
    const json = name ? loadMapJson(name) : JSON.parse(fs.readFileSync(p, "utf8"));
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

function objectDictionary(objects, key) {
  return objects.dictionary ? objects.dictionary(key) : objects.get(key);
}

export function getPageMediabox(objects, pageNum, pageGen) {
  let d = objectDictionary(objects, `${pageNum},${pageGen}`);
  if (d === undefined) d = Buffer.alloc(0);
  let text = d.toString("latin1");
  for (let hop = 0; hop < 8; hop += 1) {
    const m = MEDIABOX_RE.exec(text);
    if (m) {

      const [x0, y0, x1, y1] = [m[1], m[2], m[3], m[4]].map(Number);
      if ([x0, y0, x1, y1].every(Number.isFinite) && x0 !== x1 && y0 !== y1) {
        return [Math.abs(x1 - x0), Math.abs(y1 - y0)];
      }
    }
    const pm = PARENT_RE.exec(text);
    if (!pm) break;
    const parent = objectDictionary(objects, `${pyInt(pm[1])},${pyInt(pm[2])}`);
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
    const raw = objectDictionary(objects, `${pyInt(refNum)},0`);
    return raw === undefined ? "" : raw.toString("latin1");
  };
  const pageBuf = objectDictionary(objects, `${pageNum},${pageGen}`);
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

// Page discovery (catalog -> /Pages -> /Kids leaf order) lives in the
// outside-stream instruction pass: core/pdf/page-instructions.js
// (decodePdfInstructions). This module only extracts what the
// instructions point at.




export { IDENTITY, PDF_PARSING_PATHS } from "../decoder.js";
export { CmapIdentityMap, LegacyAyarMap } from "../legacy/fallback.js";
export { mapCode } from "../unicode/cmap/cmap.js";














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












const INLINE_IMAGE_END_RE = /[\x00\x09-\x0d\x20]EI(?=[\x00\x09-\x0d\x20[\]<>/%(]|$)/g;

function skipInlineImage(data, pos) {
  INLINE_IMAGE_END_RE.lastIndex = pos;
  const m = INLINE_IMAGE_END_RE.exec(data);
  return m ? INLINE_IMAGE_END_RE.lastIndex : data.length;
}
export function* iterContentOperations(data, { prefix = false } = {}) {
  const lex = typeof data === "string" ? new Lexer(data) : data;
  let operands = [];
  const containers = [];
  for (;;) {
    const tok = lex.nextToken();
    // At a checkpoint the last token may continue in the next byte. Leave it
    // for the full page parse instead of treating a truncated token as text.
    if (tok === null || (prefix && lex.pos === data.length)) break;
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
        if (typeof lex.skipInlineImage === "function") lex.skipInlineImage();
        else lex.pos = skipInlineImage(data, lex.pos);
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
  // An unfinished array is not necessarily a TJ operation. Its strings
  // remain buffered for the complete-page parse, not for route selection.
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

// Keep adjacent runs of the profiled font together across text operations
// and pieces, but never apply its ordering to another font resource.
function joinDraftRuns(pieces, order) {
  let selected = null;
  let pending = "";
  let out = "";
  const flush = () => { out += selected ? order(pending) : pending; pending = ""; };
  for (const [, , text, runs] of pieces) {
    for (const [isDraft, part] of (runs ?? [[false, text]])) {
      if (!part) continue;
      if (selected !== null && selected !== isDraft) flush();
      selected = isDraft;
      pending += part;
    }
  }
  flush();
  return out;
}

function joinOrderedLine(ordered, doc, onVisualGlyphRecovery = null) {
  if (doc.kind === "font") {
    let decoder = null;
    let pending = "";
    let rawParts = [];
    let hasRaw = true;
    const transformed = [];
    const flushRun = () => {
      let text = pending;
      if (decoder?.visualUnicodeGlyphs && hasRaw && rawParts.length) {
        let unresolved = false;
        text = decodeVisualUnicodeRun(decoder, rawParts, {
          onUnresolved: () => { unresolved = true; }, startsAtBoundary: transformed.length === 0,
        });
        if (text !== pending || unresolved) onVisualGlyphRecovery?.({ changed: text !== pending, unresolved });
      } else if (decoder && doc.transformRun) text = doc.transformRun(decoder, pending);
      if (decoder) transformed.push(text);
      pending = "";
      rawParts = [];
      hasRaw = true;
    };
    for (const [, , text, runs] of ordered) {
      for (const [font, part, , raw] of runs || [[null, text]]) {
        if (font !== decoder) { flushRun(); decoder = font; }
        pending += part;
        if (typeof raw === "string") rawParts.push(raw);
        else hasRaw = false;
      }
    }
    if (decoder) flushRun();
    else if (pending) transformed.push(pending);
    return transformed.join("");
  }
  if (doc.zawcodeOrder) return joinDraftRuns(ordered, doc.zawcodeOrder);
  return ordered.map(([, , text]) => text).join("");
}

// Long, painted vertical rules are evidence of a table rather than facing
// pages. Keep only a bounded set of distinct lines; clipping paths do not
// count. Text inside a table retains the ordinary top-to-bottom order.
function pageGridEvidence(width, height, left = 0) {
  let current = null;
  let pending = [];
  const rules = [];
  let grid = false;
  const add = (target, a, b) => {
    const low = Math.min(a[1], b[1]);
    const high = Math.max(a[1], b[1]);
    const x = (a[0] + b[0]) / 2;
    if (Math.abs(a[0] - b[0]) > 3 || high - low < height * 0.2 || x < left || x > left + width) return;
    if (target.length < 32 && !target.some((rule) => Math.abs(rule.x - x) < 3)) target.push({ x, low, high });
  };
  return {
    consume(op, operands, matrix) {
      if (grid || width < height * 1.25 || height <= 0) return;
      const point = (x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
      if (op === "re" && operands.length >= 4 && operands.slice(-4).every(isNumeric)) {
        const [x, y, w, h] = operands.slice(-4).map(toNumber);
        const corners = [point(x, y), point(x + w, y), point(x, y + h), point(x + w, y + h)];
        const xs = corners.map((p) => p[0]);
        const ys = corners.map((p) => p[1]);
        if (Math.max(...xs) - Math.min(...xs) <= 3) {
          add(pending, [Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]);
        }
      } else if (["m", "l"].includes(op) && operands.length >= 2 && operands.slice(-2).every(isNumeric)) {
        const next = point(...operands.slice(-2).map(toNumber));
        if (op === "l" && current) add(pending, current, next);
        current = next;
      } else if (["c", "v", "y"].includes(op)) {
        current = null;
      } else if (["n", "S", "s", "f", "F", "f*", "B", "B*", "b", "b*"].includes(op)) {
        if (op !== "n") {
          for (const line of pending) add(rules, [line.x, line.low], [line.x, line.high]);
          grid = rules.some((line) => rules.filter((other) =>
            Math.min(line.high, other.high) - Math.max(line.low, other.low) >= height * 0.15).length >= 4);
        }
        pending = [];
        current = null;
      }
    },
    get detected() { return grid; },
  };
}

export function extractPageLines(objects, pageNum, pageGen, decoding, {
  pageBox = null, usedMyanmarFonts = null, usedFontKinds = null, usedLegacyFonts = null,
  inspectPrefix = null, onPageContent = null, onConfirmedRepair = null, onVisualGlyphRecovery = null,
  scratchDir = null, pieceStore = null,
} = {}) {
  let doc = asDocumentDecoding(decoding);
  const loader = documentLoader(doc, objects);
  let decoders = pageFontDecoders(loader, pageNum, pageGen, doc);
  let unsetFont = new UnsetFontDecoder("", { doc });
  const imageCollector = new PageImageCollector(loader, pageNum, pageGen, iterContentOperations);
  const contentOptions = {
    maxBytes: MAX_STREAM_MB * 1024 * 1024,
    inspect: (prefix) => {
      const selected = inspectPrefix?.(prefix, decoders, loader, imageCollector.media);
      if (!(selected instanceof DocumentDecoding) || selected === doc) return;
      doc = selected;
      if (doc.loader !== loader) {
        doc.loader = loader;
        doc.resetFontCache();
      }
      decoders = pageFontDecoders(loader, pageNum, pageGen, doc);
      unsetFont = new UnsetFontDecoder("", { doc });
    },
  };
  const spooled = spoolPageContent(loader, pageNum, pageGen, { ...contentOptions, scratchDir });
  const suppliedStore = pieceStore;
  try {
  pieceStore ??= new PdfPagePieces(path.dirname(spooled.file));
  const { streams, references } = spooled;
  const [pageW, pageH] = pageBox ?? getPageMediabox(objects, pageNum, pageGen);
  pieceStore.begin(doc);
  onPageContent?.(streams, references, loader, spooled);
  const pageLeft = imageCollector.media[0];
  const gridEvidence = pageGridEvidence(pageW, pageH, pageLeft);





  let active = null;

  // A /Contents array is one logical sequence of page commands. Keep the
  // original stream boundaries for the writer, but do not reset text or
  // graphics state between them while parsing.
  const sources = spooled.size ? [new PdfFileLexer(spooled.fd, spooled.size)] : [];
  for (const content of sources) {

    let inBlock = false;
    let blockTexts = [];
    let blockRuns = [];
    let blockXy = null;
    let blockSize = null;
    let lineMatrix = [1, 0, 0, 1, 0, 0];
    let leading = 0;
    let fontSize = 12;
    const savedTextStates = [];
    let pendingDecoder = null;
    let pendingBytes = "";
    const position = (matrix = lineMatrix) => {
      const [a, b, c, d, e, f] = imageCollector.state.matrix;
      return [a * matrix[4] + c * matrix[5] + e, b * matrix[4] + d * matrix[5] + f];
    };
    const effectiveSize = () => {
      const [a, b, c, d] = imageCollector.state.matrix;
      return Math.abs(fontSize) * Math.hypot(a * lineMatrix[2] + c * lineMatrix[3],
        b * lineMatrix[2] + d * lineMatrix[3]);
    };
    const flushPiece = () => {
      if (blockTexts.length && blockXy !== null) {
        const text = blockTexts.join("");
        // Repeated glyphs in one text run may be intentional (including
        // U+102F U+102F); do not collapse them without separate evidence.
        pieceStore.add([blockXy[1], blockXy[0], blockSize ?? 12, text,
          doc.kind === "font" || doc.zawcodeOrder ? blockRuns : null]);
      }
      blockTexts = [];
      blockRuns = [];
      blockXy = null;
      blockSize = null;
    };
    const moveLine = (next) => {
      // A single BT/ET can contain an entire page. Flush when a text matrix
      // moves to a different baseline, not merely at ET. Small offsets are
      // kept together because they can position Burmese combining glyphs.
      if (blockXy !== null) {
        const nextXy = position(next);
        const changesBaseline = Math.abs(nextXy[1] - blockXy[1]) > 3;
        const middle = pageLeft + pageW / 2;
        const crossesSpread = pageW >= pageH * 1.25 && pageH > 0
          && (blockXy[0] < middle) !== (nextXy[0] < middle);
        if (changesBaseline || crossesSpread) flushPiece();
      }
      lineMatrix = next;
    };
    const translateLine = (dx, dy) => {
      const [a, b, c, d, e, f] = lineMatrix;
      moveLine([a, b, c, d, e + dx * a + dy * c, f + dx * b + dy * d]);
    };
    const recordText = (decoder, text, confirmedText = text, raw = null) => {
      if (blockXy === null) blockXy = position();
      blockSize = Math.max(blockSize ?? 0, effectiveSize());
      if (text && decoder.parsingPath === PDF_PARSING_PATHS.LEGACY) usedLegacyFonts?.add(decoder.baseFont || "");
      if (containsMyanmar(confirmedText) || decoder.fontLegacyCodePage || decoder.confirmedRawRuns) {
        if (usedMyanmarFonts) usedMyanmarFonts.add(decoder.baseFont || "");
        if (usedFontKinds && doc.fontKind) usedFontKinds.add(doc.fontKind(decoder));
      }
      blockTexts.push(text);
      if (doc.kind === "font") blockRuns.push([decoder, text, confirmedText, decoder.visualUnicodeGlyphs ? raw : null]);
      else if (doc.zawcodeOrder) blockRuns.push([decoder.zawcodeGlyphs != null, text, confirmedText]);
    };
    const flushConfirmedRun = () => {
      if (pendingDecoder) {
        const original = pendingDecoder.decode(pendingBytes, { useConfirmed: false });
        const confirmed = pendingDecoder.decode(pendingBytes, { useConfirmed: true });
        recordText(pendingDecoder, original, confirmed);
      }
      pendingDecoder = null;
      pendingBytes = "";
    };

    for (const [op, operands] of iterContentOperations(content)) {
      // Preserve the old graphics matrix until pending text is recorded.
      // Match only adjacent text-show bytes in the same font and positioning run.
      if (["BT", "ET", "Tf", "Tm", "Td", "TD", "T*", "'", '"', "q", "Q", "cm"].includes(op)) flushConfirmedRun();
      if (inBlock && (op === "Q" || op === "cm")) flushPiece();
      gridEvidence.consume(op, operands, imageCollector.state.matrix);
      imageCollector.consume(op, operands);
      // Text state is part of the graphics state. BT/ET reset the text
      // matrices, but do not themselves reset the font, size or leading.
      if (op === "q") { savedTextStates.push({ active, fontSize, leading }); continue; }
      if (op === "Q") {
        const saved = savedTextStates.pop();
        if (saved) ({ active, fontSize, leading } = saved);
        continue;
      }
      if (op === "Tf") {
        if (operands.length >= 2 && operands[operands.length - 2] instanceof PdfName) {
          active = decoders.get(String(operands[operands.length - 2])) ?? null;
        }
        if (operands.length && isNumeric(operands[operands.length - 1])) {
          fontSize = toNumber(operands[operands.length - 1]);
        }
        continue;
      }

      if (op === "BT") {
        if (!inBlock) {
          inBlock = true;
          blockTexts = [];
          blockRuns = [];
          blockXy = null;
          blockSize = null;
          lineMatrix = [1, 0, 0, 1, 0, 0];
        }
        continue;
      }

      if (!inBlock) continue;

      if (op === "Tm") {
        if (operands.length >= 6 && operands.slice(-6).every(isNumeric)) {
          moveLine(operands.slice(-6).map(toNumber));
        }
        continue;
      }

      if (op === "Td" || op === "TD") {
        if (operands.length >= 2 && operands.slice(-2).every(isNumeric)) {
          const dx = toNumber(operands[operands.length - 2]);
          const dy = toNumber(operands[operands.length - 1]);
          if (op === "TD") leading = -dy;
          translateLine(dx, dy);
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
        translateLine(0, -leading);
        continue;
      }

      if (op === "ET") {
        inBlock = false;
        flushPiece();
        continue;
      }

      if (op === "Tj" || op === "TJ" || op === "'" || op === '"') {
        // The two quote operators include the same line move as T*.
        if (op === "'" || op === '"') translateLine(0, -leading);
        const decoder = active !== null ? active : unsetFont;
        for (const shown of shownStrings(op, operands)) {




          const arg = decoder instanceof UnsetFontDecoder || !(shown instanceof PdfHexBytes)
            ? shown : shown.s;
          if (decoder.confirmedRawRuns && typeof arg === "string") {
            if (pendingDecoder && pendingDecoder !== decoder) flushConfirmedRun();
            pendingDecoder = decoder;
            pendingBytes += arg;
          } else {
            flushConfirmedRun();
            recordText(decoder, decoder.decode(arg), undefined, typeof arg === "string" ? arg : null);
          }
        }
      }
    }
  }










  pieceStore.finish({ onConfirmedRepair,
    joinRuns: (ordered, selectedDoc) => joinOrderedLine(ordered, selectedDoc, onVisualGlyphRecovery),
    pageLeft, pageWidth: pageW, pageHeight: pageH, hasTableRules: gridEvidence.detected });
  const lines = suppliedStore ? pieceStore : [...pieceStore.lines()];
  return [lines, pageW, pageH, imageCollector.images];
  } finally {
    pieceStore?.abort();
    if (!suppliedStore) pieceStore?.close();
    spooled.close();
  }
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
