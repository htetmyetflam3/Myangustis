/*
(praised/decoding/pdf/font) decoder: FontDecoder and its builders - the integrator of the font branches. Tries the font's own cmap first (cmap/), falls back to the embedded TTF and legacy lanes (ttf/). It composes the branches; it is not a third re-check - judgement owns method choice above it.
*/
import { createHash } from "node:crypto";
import { pyChr } from "../../../core/@helper/pylib.js";
import { CMapEncoding, buildSimpleEncoding, parseCmapStream, mapCode, IDENTITY, CmapIdentityMap } from "./unicode/cmap/cmap.js";
import { FontResourceLoader, ResourceCache, SPACE_CODES } from "./unicode/ttf.js";
export { IDENTITY };
import { LegacyAyarMap } from "./legacy/fallback.js";
import { isUnresolvedLegacyFont, legacyLayoutForFont, normaliseFontName } from "./legacy/codepage-names.js";
import { lookupLegacyCode, WININNWA_LEGACY_CODE_PAGE, WININNWA_UNRESOLVED_SLOTS } from "./legacy/codepage-registry.js";
import { confirmedRunAt } from "./legacy/codepage-confirmed.js";
import { subsetFontBridge } from "./legacy/codepage-subset.js";
import { hasVisualUnicodeConflicts, matchVisualUnicodeGlyphs } from "./legacy/codepage-visual.js";
import { PdfName, PdfRef } from "./values.js";


// These are parsing routes, not encoding verdicts. The shared route
// decodes every font resource through its own cmap data (/ToUnicode first,
// then the embedded TTF cmap); the legacy route uses a legacy codepage.
export const PDF_PARSING_PATHS = Object.freeze({
  FONT_CMAP: "font-cmap",
  LEGACY: "legacy",
});

// The font name is a guard *inside* the legacy lane only: once a page is
// on the legacy lane (chosen by the English-violation check, never by a
// name), the name picks which of the two existing legacy layouts reads
// the resource. WinInnwa faces use the WinInnwa layout; the Ayar-family
// faces (Ayar, Arlarwade, Amyanmar and the other registered legacy faces)
// use the Ayar layout. An unknown face is parsed with WinInnwa and is
// flagged (known: false) so the cleaning stage can route it to the
// additional module that will be specified for unknown legacy faces.


export class DocumentDecoding {
  constructor(kind, mapping = null, legacyCodePage = null, { legacyFontNames = null, vectorRepair = null } = {}) {
    this.kind = kind;
    this.map = kind === "identity" ? IDENTITY : (mapping || new Map());
    this.keyKind = kind === "cmap" || kind === "font" ? "gid" : "code";
    this.trustFontToUnicode = kind === "tounicode" || kind === "none" || kind === "font";
    this.legacyCodePage = legacyCodePage;
    this.legacyFontNames = legacyFontNames ? new Set(legacyFontNames) : null;
    this.legacyResources = null;




    this.vectorRepair = vectorRepair;
    this.loader = null;
    this._decoders = new ResourceCache(64);
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

class DecodedTextBuilder {
  constructor() { this.batch = []; this.parts = []; }

  add(text) {
    if (!text) return;
    this.batch.push(text);
    if (this.batch.length >= 4096) {
      this.parts.push(this.batch.join(""));
      this.batch.length = 0;
    }
  }

  finish() {
    if (!this.parts.length) return this.batch.join("");
    if (this.batch.length) this.parts.push(this.batch.join(""));
    return this.parts.join("");
  }
}

export class FontDecoder {
  constructor(name, {
    subtype = "", baseFont = "", isCid = false, cmap = null, toUnicode = null,
    encoding = null, hasEncoding = false, hasPdfEncoding = hasEncoding, encodingHasDifferences = false,
    ownGids = null, doc = null, cidToGid = null,
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
    this.encodingHasDifferences = encodingHasDifferences;
    this.ownGids = ownGids || new Map();
    this.zawcodeGlyphs = zawcodeGlyphs;
    this.confirmedRawRuns = confirmedRawRuns;
    this.fontLegacyCodePage = fontLegacyCodePage;
    this.doc = doc !== null ? doc : new DocumentDecoding("none");
    this._cidToGid = cidToGid;
    const widths = this.toUnicode?.byWidth;
    // Some simple-font PDFs encode their one-byte character codes as
    // zero-padded two-byte ToUnicode entries. Recover only when the entire
    // map is two-byte and every source code fits a simple-font byte.
    this._paddedSimpleToUnicode = !this.isCid && widths?.size === 1 && widths.has(2);
    if (this._paddedSimpleToUnicode) {
      for (const code of widths.get(2).keys()) {
        if (code < 0 || code > 0xff) { this._paddedSimpleToUnicode = false; break; }
      }
    }
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
    // A font name never selects a lane here. Only a matched resource
    // profile (confirmed raw runs or a profile legacy codepage) marks the
    // resource legacy from outside the legacy lane; in-lane layout choice
    // by name is legacyLayoutForFont's job, applied when the lane is built.
    if (this.confirmedRawRuns || this.fontLegacyCodePage
        || isUnresolvedLegacyFont(this.baseFont)) return PDF_PARSING_PATHS.LEGACY;
    return PDF_PARSING_PATHS.FONT_CMAP;
  }

  get _isSelectedLegacyFont() {
    if (isUnresolvedLegacyFont(this.baseFont)) return false;
    if (this.fontLegacyCodePage) return true;
    if (this.doc.legacyResources !== null) return this.doc.legacyResources.has(this);
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


  _toUnicodeForCode(map, code, width) {
    if (!map) return undefined;
    if (!map.byWidth) return map.get(code);
    const exact = map.byWidth.get(width)?.get(code);
    return exact !== undefined ? exact
      : width === 1 && this._paddedSimpleToUnicode ? map.byWidth.get(2).get(code) : undefined;
  }

  _legacyLookup(code) {
    const page = this.fontLegacyCodePage || this.doc.legacyCodePage;
    if (!page) return null;
    if (!this._isSelectedLegacyFont) return null;
    // The selected layout belongs to the character slots, not the visual
    // font family. A page-selected simple resource can use the same layout
    // under another face; unselected resources do not inherit it. The lane
    // was already selected above this decoder: no font-name check here may
    // refuse the parse - selection is the only guard.
    if (!this.toUnicode && !this.encodingHasDifferences) {
      if (page === WININNWA_LEGACY_CODE_PAGE && WININNWA_UNRESOLVED_SLOTS.has(code)) {
        return String.fromCodePoint(code);
      }
      const direct = lookupLegacyCode(code, page);
      return direct === undefined ? null : direct;
    }
    // Differences and /ToUnicode describe PDF codes -> character slots. They
    // must be followed before applying the selected keyboard layout: a PDF
    // code such as 01 is not itself necessarily a keyboard slot.
    const src = this.toUnicode ? this._toUnicodeForCode(this.toUnicode, code, 1) : this.encoding.get(code);
    if (!src) return null;
    let out = "";
    for (const ch of src) {
      const slot = ch.codePointAt(0);
      // Keep an ambiguous legacy slot visible rather than inventing a
      // Burmese reading or confusing it with this PDF's raw byte.
      if (page === WININNWA_LEGACY_CODE_PAGE && WININNWA_UNRESOLVED_SLOTS.has(slot)) {
        out += ch;
        continue;
      }
      const hit = lookupLegacyCode(slot, page);
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
    const hit = this._toUnicodeForCode(tu, code, width);
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
      const out = new DecodedTextBuilder();
      const width = this.isCid ? 4 : 2;
      if (this.isCid) {
        for (const [code] of this.cmap.iterCodes(data)) out.add(`[${code.toString(16).toUpperCase().padStart(width, "0")}]`);
      } else {
        for (const char of data) out.add(`[${char.charCodeAt(0).toString(16).toUpperCase().padStart(width, "0")}]`);
      }
      return out.finish();
    }
    if (this.zawcodeGlyphs !== null && this.doc.zawcodeStats) {
      this.doc.zawcodeStats.glyphs += Math.floor(data.length / 2);
    }
    const out = new DecodedTextBuilder();
    if (this.isCid) {
      for (const [code, cid, width, invalid] of this.cmap.iterCodes(data)) {
        const text = invalid ? null : this.decodeCode(code, cid, width, useConfirmed);
        if (text !== null) out.add(text);
        else if (!skipUnknown) out.add(`[${code.toString(16).toUpperCase().padStart(width * 2, "0")}]`);
      }
      return out.finish();
    }
    for (let i = 0; i < data.length; i += 1) {
      const code = data.charCodeAt(i);
      if (useConfirmed && this.confirmedRawRuns) {
        const run = confirmedRunAt(this.confirmedRawRuns, data, i);
        if (run) {
          out.add(run.text);
          i += run.bytes.length - 1;
          continue;
        }
        if (this.confirmedRawRuns.unresolved.has(code)) {
          if (!skipUnknown) out.add(`[${code.toString(16).toUpperCase().padStart(2, "0")}]`);
          continue;
        }
      }
      let text = this.decodeCode(code, null, 1, useConfirmed);
      if (text === null) {
        text = ((code < 0x20 || (code >= 0x7f && code <= 0x9f)) && code !== 0x09 && code !== 0x0a && code !== 0x0d)
          ? "" : pyChr(code);
      }
      out.add(text);
    }
    return out.finish();
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
    const decoder = new FontDecoder(name, {
      subtype, baseFont, isCid: true, cmap, toUnicode, ownGids, doc, zawcodeGlyphs,
      hasPdfEncoding: font.has("Encoding"), cidToGid: loader.cidToGid(descendant),
    });
    if (doc.kind === "font" && doc.visualUnicodeEnabled && hasVisualUnicodeConflicts(decoder)) {
      const resolved = loader.resolve(descriptor);
      const program = resolved instanceof Map ? loader.streamOf(resolved.get("FontFile2")) : null;
      decoder.visualUnicodeGlyphs = matchVisualUnicodeGlyphs(decoder, program);
    }
    return decoder;
  }

  const [encoding, declared] = buildSimpleEncoding(font.get("Encoding"), (v) => loader.resolve(v));
  const encodingDictionary = loader.resolve(font.get("Encoding"));
  const encodingHasDifferences = encodingDictionary instanceof Map
    && Array.isArray(loader.resolve(encodingDictionary.get("Differences")));
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
  // Inside the legacy lane the font name is only a layout guard: a matched
  // subset profile wins; otherwise the name picks WinInnwa vs Ayar, and an
  // unknown face falls back to Ayar (legacyLayoutForFont).
  // Family was decided at the stem (doc.stemFonts, keyed by font
  // object); the bridge still wins for a profiled subset, and the name
  // gate is only the fallback for fonts the stem could not settle.
  const stemVerdict = doc.stemFonts && entry instanceof PdfRef ? doc.stemFonts.get(entry.key()) : null;
  const fontLegacyCodePage = doc.kind === "legacy"
    ? (bridge?.codePage || stemVerdict?.codePage || legacyLayoutForFont(baseFont).codePage)
    : null;
  return new FontDecoder(name, {
    subtype, baseFont, isCid: false, toUnicode, encoding, hasEncoding: declared, encodingHasDifferences,
    hasPdfEncoding: font.has("Encoding"), ownGids, doc,
    confirmedRawRuns, fontLegacyCodePage,
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
