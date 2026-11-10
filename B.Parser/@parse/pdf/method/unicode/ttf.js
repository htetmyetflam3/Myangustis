/*
(praised/decoding/pdf/font/ttf) ttf branch: decode through the embedded TrueType program itself - GSUB shaping resolution, variant slots, and the FontResourceLoader that pulls embedded font streams. This is the fallback when the font carries no usable /ToUnicode.
*/
import { parseTtfGsubReverse, parseTtfVariantSlots } from "./ttf/ttf-gsub.js";
import { PdfRef, parseObject } from "../values.js";

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
    this._objCache = new ResourceCache(512);
    this._gidCache = new ResourceCache(32);
    this._tuCache = new ResourceCache(32);
    this._cidCache = new ResourceCache(32);
  }

  objectValue(ref) {
    const key = ref.key();
    if (this._objCache.has(key)) return this._objCache.get(key);
    const read = (objectKey) => this.objects.dictionary
      ? this.objects.dictionary(objectKey) : this.objects.get(objectKey);
    let raw = read(key);
    if (raw === undefined && ref.gen !== 0) raw = read(`${ref.num},0`);
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
      const key = entry.key();
      if (this._cidCache.has(key)) return this._cidCache.get(key);
      const data = this.streamOf(entry);
      if (data && data.length) {
        const count = Math.floor(data.length / 2);
        const gids = new Uint16Array(count);
        for (let i = 0; i < count; i += 1) gids[i] = data.readUInt16BE(i * 2);
        const lookup = (cid) => (cid >= 0 && cid < gids.length ? gids[cid] : 0);
        this._cidCache.set(key, lookup);
        return lookup;
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
