import fs from "node:fs";
import { parseTtfCmap } from "../core/ttf-cmap.mjs";

function readTableDirectory(data) {
  const numTables = data.readUInt16BE(4);
  const tables = new Map();
  let off = 12;
  for (let i = 0; i < numTables; i += 1) {
    if (off + 16 > data.length) break;
    const tag = data.toString("latin1", off, off + 4);
    tables.set(tag, { offset: data.readUInt32BE(off + 8), length: data.readUInt32BE(off + 12) });
    off += 16;
  }
  return tables;
}

export class TtfFont {
  /* Accepts a path OR the bytes themselves. A font embedded in a PDF
     never touches the filesystem, and that is the case that matters:
     its outlines are the document's own shapes. */
  constructor(source) {
    const isBytes = Buffer.isBuffer(source) || source instanceof Uint8Array;
    this.path = isBytes ? "<embedded>" : source;
    this.data = isBytes ? Buffer.from(source) : fs.readFileSync(source);
    const tables = readTableDirectory(this.data);
    this.tables = tables;

    const head = tables.get("head");
    if (!head) throw new Error(`${this.path} is not a TrueType font (no head table)`);
    this.unitsPerEm = this.data.readUInt16BE(head.offset + 18);
    this.indexToLocFormat = this.data.readInt16BE(head.offset + 50);
    
    this.bbox = [
      this.data.readInt16BE(head.offset + 36),
      this.data.readInt16BE(head.offset + 38),
      this.data.readInt16BE(head.offset + 40),
      this.data.readInt16BE(head.offset + 42),
    ];

    const hhea = tables.get("hhea");
    this.ascent = hhea ? this.data.readInt16BE(hhea.offset + 4) : this.unitsPerEm;
    this.descent = hhea ? this.data.readInt16BE(hhea.offset + 6) : -this.unitsPerEm;
    this.numberOfHMetrics = hhea ? this.data.readUInt16BE(hhea.offset + 34) : 0;

    const maxp = tables.get("maxp");
    this.numGlyphs = maxp ? this.data.readUInt16BE(maxp.offset + 4) : 0;

    
    
    this.advanceWidths = new Uint16Array(this.numGlyphs);
    const hmtx = tables.get("hmtx");
    if (hmtx && this.numGlyphs) {
      let p = hmtx.offset;
      let last = 600;
      for (let g = 0; g < this.numGlyphs; g += 1) {
        if (g < this.numberOfHMetrics) {
          if (p + 2 > this.data.length) break;
          last = this.data.readUInt16BE(p);
          p += 4; 
        }
        this.advanceWidths[g] = last;
      }
    }

    
    
    this.cmap = parseTtfCmap(this.data); 

    
    this.scale = 1000 / this.unitsPerEm;
    this.cw = new Map();
    for (const [cp, gid] of this.cmap) {
      const w = this.advanceWidths[gid] ?? 0;
      this.cw.set(cp, roundHalfUp(this.scale * (w === 65535 ? 0 : w) + 0.001));
    }

    this.name = sanitizeName(this.path);
    this.usedCps = new Set();
    this.notdefWidth = roundHalfUp(this.scale * (this.advanceWidths[0] ?? 0) + 0.001);
  }
  hasCodepoint(cp) {
    return this.cmap.has(cp);
  }

  glyphId(cp) {
    const gid = this.cmap.get(cp);
    return gid === undefined ? 0 : gid;
  }
  widthOf(cp) {
    const w = this.cw.get(cp);
    return w === undefined ? this.notdefWidth : w;
  }

  
  textWidthPt(text, sizePt) {
    let total = 0;
    for (const ch of text) total += this.widthOf(ch.codePointAt(0));
    return total * sizePt * 0.001;
  }
}


function roundHalfUp(x) {
  return Math.round(x);
}

function sanitizeName(filePath) {
  const base = filePath.split(/[\\/]/).pop() || "Font";
  return base.replace(/\.ttf$/i, "").replace(/[^A-Za-z0-9-]/g, "");
}

export function loadFont(filePath) {
  return new TtfFont(filePath);
}