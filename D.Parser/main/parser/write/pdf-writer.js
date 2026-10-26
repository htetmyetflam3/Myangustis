import fs from "node:fs";
import zlib from "node:zlib";
import { TtfFont } from "./ttf.mjs";

const PT_PER_MM = 72 / 25.4;


const FLOAT_TOLERANCE = 1e-9;
const floatEq = (a, b) => Math.abs(a - b) <= FLOAT_TOLERANCE;


const A4_W_PT = 595.28;
const A4_H_PT = 841.89;
const MARGIN_1CM_MM = 9.999999999999998;
const C_MARGIN_MM = 0.9999999999999998;
const B_MARGIN_20MM = 19.999999999999996;

export class PdfWriter {
  constructor() {
    this.k = PT_PER_MM;
    this.pageWpt = A4_W_PT;
    this.pageHpt = A4_H_PT;
    this.w = this.pageWpt / this.k;
    this.h = this.pageHpt / this.k;
    this.lMargin = MARGIN_1CM_MM;
    this.rMargin = MARGIN_1CM_MM;
    this.tMargin = MARGIN_1CM_MM;
    this.cMargin = C_MARGIN_MM;
    this.bMargin = B_MARGIN_20MM;
    this.autoPageBreak = true;
    this.pageBreakTrigger = this.h - this.bMargin;

    this.x = this.lMargin;
    this.y = this.tMargin;
    this.fonts = new Map();     
    this.fontOrder = [];        
    this.current = null;        
    this.fontSizePt = 12;
    this.fontSize = 12 / this.k;
    this.charSpacing = 0;
    this.textColor = [0, 0, 0];
    this.fallbackFamilies = [];

    this.pages = [];
    this.page = null;
    this.pageNo = 0;
    this.footerFn = null;
    this.fontSetOnPage = false;   
    this.fontFamily = "";       
    this.fontStyle = "";        
    this._inFooter = false;
  }

  
  setAutoPageBreak(auto, margin) {
    this.autoPageBreak = auto;
    if (auto) {
      this.bMargin = margin === undefined ? this.bMargin : (margin * B_MARGIN_20MM) / 20;
      this.pageBreakTrigger = this.h - this.bMargin;
    }
  }

  setFooter(fn) { this.footerFn = fn; }

  
  addPage() {
    this.fontSetOnPage = false;
    const snap = { charSpacing: this.charSpacing };
    if (this.page) this._endPage();
    this._beginpage();
    if (snap.charSpacing !== 0) this.setCharSpacing(snap.charSpacing);
  }
  _beginpage() {
    this.pageNo += 1;
    this.page = { lines: [], fonts: new Set() };
    this.pages.push(this.page);
    this._out("2 J");
    this._out(`${(0.2 * this.k).toFixed(2)} w`);
    this.x = this.lMargin;
    this.y = this.tMargin;
    this.fontFamily = "";
    this.charSpacing = 0;   
  }

  _endPage() {
    
    
    if (this.footerFn) {
      this._inFooter = true;
      try { this.footerFn(this); } finally { this._inFooter = false; }
    }
    this.page = null;
  }

  _out(s) {
    if (!this.page) throw new Error("No page open — call addPage() first");
    this.page.lines.push(s);
  }

  
  addFont(family, style, file) {
    
    
    const key = `${family.toLowerCase()}${style}`;
    if (this.fonts.has(key)) return this.fonts.get(key);
    if (!fs.existsSync(file)) return null; 
    const entry = { key, family, style, file, font: new TtfFont(file), index: 0 };
    this.fonts.set(key, entry);
    this.fontOrder.push(entry);
    entry.index = this.fontOrder.length; 
    return entry;
  }

  
  setFont(family, style = "", sizePt = null) {
    let fam = family || this.fontFamily;
    fam = fam.toLowerCase();
    let size = sizePt;
    if (!size) size = this.fontSizePt;            
    const fontkey = `${fam}${style}`;
    if (this.fontFamily === fam && this.fontStyle === style
      && floatEq(this.fontSizePt, size)
      && (this.current === null || this.current.key === fontkey)) {
      return this.current;                        
    }
    const entry = this.fonts.get(fontkey);
    if (!entry) {
      throw new Error(`Font "${family}" with style "${style}" is not included`);
    }
    this.fontFamily = fam;
    this.fontStyle = style;
    this.fontSizePt = size;
    this.fontSize = size / this.k;
    this.current = entry;
    this.fontSetOnPage = false;
    return entry;
  }

  
  setFallbackFonts(families) {
    this.fallbackFamilies = [];
    for (const fam of families) {
      const low = String(fam).toLowerCase();
      for (const e of this.fontOrder) {
        if (e.key.startsWith(low) && !this.fallbackFamilies.includes(e)) {
          this.fallbackFamilies.push(e);
        }
      }
    }
  }

  
  setCharSpacing(v) {
    if (this.charSpacing === v) return;
    this.charSpacing = v;
    if (this.pageNo > 0) this._out(`BT ${v.toFixed(2)} Tc ET`);
  }

  setTextColor(r, g, b) { this.textColor = [r, g, b]; }

  setXY(x, y) { this.x = x; this.y = y; }
  setY(y) { this.y = y < 0 ? this.h + y : y; }
  setX(x) { this.x = x; }

  ln(h = null) {
    this.y += h === null ? this.fontSize : h;
    this.x = this.lMargin;
  }

  
  
  cell(w, h, text = "", opts = {}) {
    const { align = "L", newX = "RIGHT", newY = "TOP" } = opts;
    if (this.autoPageBreak && !this._inFooter && this.y + h > this.pageBreakTrigger) this.addPage();
    if (w === 0) w = this.w - this.rMargin - this.x;
    const primary = this.current;
    const fallbacks = this.fallbackFamilies.filter((e) => e !== primary);

    
    
    
    const runs = [];
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0);
      let chosen = primary.font.hasCodepoint(cp) ? primary : null;
      if (!chosen) {
        const withChar = fallbacks.filter((e) => e.font.hasCodepoint(cp));
        chosen = withChar.find((e) => e.style === primary.style) ?? primary;
      }
      const last = runs[runs.length - 1];
      if (last && last.font === chosen) last.chars.push(ch);
      else runs.push({ font: chosen, chars: [ch] });
    }
    if (!runs.length) runs.push({ font: primary, chars: [] });

    
    let widthPt = 0;
    runs.forEach((run, i) => {
      const n = run.chars.length;
      let wpt = run.font.font.textWidthPt(run.chars.join(""), this.fontSizePt);
      if (this.charSpacing !== 0) {
        wpt += i !== 0 ? this.charSpacing * n : this.charSpacing * (n - 1);
      }
      widthPt += wpt;
    });
    const styledWidth = widthPt / this.k;
    let dx;
    if (align === "R") dx = w - this.cMargin - styledWidth;
    else if (align === "C" || align === "J") dx = (w - styledWidth) / 2;
    else dx = this.cMargin;

    const tx = (this.x + dx) * this.k;
    const ty = (this.h - this.y - 0.5 * h - 0.3 * this.fontSize) * this.k;
    const [r, g, b] = this.textColor;
    const colored = r !== 0 || g !== 0 || b !== 0;

    const parts = [`BT ${tx.toFixed(2)} ${ty.toFixed(2)} Td`];
    
    
    const sizeStr = this.fontSizePt.toFixed(2);
    if (!this.fontSetOnPage && runs[0].chars.length && runs[0].font !== primary) {
      parts.push(`/F${primary.index} ${sizeStr} Tf`);
      this.fontSetOnPage = true;
    } else if (!this.fontSetOnPage) {
      this._out(`BT /F${primary.index} ${sizeStr} Tf ET`);
      this.fontSetOnPage = true;
    }
    if (colored) parts.push(`${(r / 255).toFixed(4)} ${(g / 255).toFixed(4)} ${(b / 255).toFixed(4)} rg`);

    
    let curFont = primary;
    for (const run of runs) {
      if (!run.chars.length) continue;
      this.page.fonts.add(run.font);
      if (run.font !== curFont) {
        parts.push(`/F${run.font.index} ${sizeStr} Tf`);
        curFont = run.font;
      }
      let hex = "";
      for (const ch of run.chars) {
        const cp = ch.codePointAt(0);
        run.font.font.usedCps.add(cp);
        hex += run.font.font.glyphId(cp).toString(16).padStart(4, "0");
      }
      parts.push(`<${hex}> Tj`);
    }
    if (parts.length === 1) parts.push("<> Tj");
    const line = parts.join(" ") + " ET";
    this._out(colored ? `q ${line} Q` : line);

    if (newX === "LMARGIN" || newX === "START") this.x = this.lMargin;
    else if (newX === "RIGHT" || newX === "END") this.x += w;
    if (newY === "NEXT") this.y += h;
  }

  
  output(outPath) {
    fs.writeFileSync(outPath, this.toBuffer());
    return outPath;
  }

  
  toBuffer() {
    if (this.page) this._endPage();
    const used = new Set();
    for (const p of this.pages) for (const f of p.fonts) used.add(f);
    const fonts = this.fontOrder.filter((f) => used.has(f));

    const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    let pos = chunks[0].length;
    const offsets = [];
    const push = (buf) => { chunks.push(buf); pos += buf.length; };
    const obj = (id, body, stream) => {
      offsets[id] = pos;
      let head = `${id} 0 obj\n${body}\n`;
      if (stream) {
        const s = Buffer.isBuffer(stream) ? stream : Buffer.from(stream, "latin1");
        head += `stream\n`;
        push(Buffer.from(head, "latin1"));
        push(s);
        push(Buffer.from("\nendstream\nendobj\n", "latin1"));
      } else {
        push(Buffer.from(`${head}endobj\n`, "latin1"));
      }
    };

    const nPages = this.pages.length || 1;
    const catalogId = 1;
    const pagesId = 2;
    
    const fontBase = 3;
    const pageBase = fontBase + fonts.length * 5;
    
    const total = pageBase + nPages * 2 - 1;

    const kids = [];
    for (let i = 0; i < nPages; i += 1) kids.push(`${pageBase + i * 2} 0 R`);
    obj(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    obj(pagesId, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${nPages} >>`);

    for (let i = 0; i < fonts.length; i += 1) {
      const f = fonts[i];
      const entry = f.font;
      const type0Id = fontBase + i * 5;
      const cidId = type0Id + 1;
      const descId = type0Id + 2;
      const fileId = type0Id + 3;
      const touId = type0Id + 4;
      const scale = 1000 / entry.unitsPerEm;

      const wArr = [];
      for (let g = 0; g < entry.numGlyphs; g += 1) {
        wArr.push(Math.round((entry.advanceWidths[g] ?? 0) * scale));
      }

      
      
      const cps = [...entry.usedCps].filter((cp) => entry.glyphId(cp) !== 0).sort((a, b) => a - b);
      const blocks = [];
      for (let k = 0; k < cps.length; k += 100) {
        const slice = cps.slice(k, k + 100);
        blocks.push(`${slice.length} beginbfchar\n`
          + slice.map((cp) => `<${entry.glyphId(cp).toString(16).padStart(4, "0")}> <${cp.toString(16).padStart(4, "0")}>`).join("\n")
          + "\nendbfchar");
      }
      const touText = [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin", "begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
        "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange",
        ...blocks,
        "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end",
      ].join("\n");
      const tou = zlib.deflateSync(Buffer.from(touText, "latin1"));
      const rawFont = fs.readFileSync(f.file);
      const bb = entry.bbox.map((v) => Math.round(v * scale));

      obj(type0Id, `<< /Type /Font /Subtype /Type0 /BaseFont /${entry.name} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${touId} 0 R >>`);
      obj(cidId, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${entry.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /CIDToGIDMap /Identity /DW 1000 /W [0 [${wArr.join(" ")}]] >>`);
      obj(descId, `<< /Type /FontDescriptor /FontName /${entry.name} /Flags 4 /FontBBox [${bb.join(" ")}] /ItalicAngle 0 /Ascent ${Math.round(entry.ascent * scale)} /Descent ${Math.round(entry.descent * scale)} /CapHeight ${Math.round(entry.ascent * scale)} /StemV 80 /StemH 60 /FontFile2 ${fileId} 0 R >>`);
      obj(fileId, `<< /Length ${rawFont.length} /Length1 ${rawFont.length} >>`, rawFont);
      obj(touId, `<< /Length ${tou.length} /Filter /FlateDecode >>`, tou);
    }

    for (let i = 0; i < this.pages.length; i += 1) {
      const p = this.pages[i];
      const pageId = pageBase + i * 2;
      const contId = pageId + 1;
      const fontRes = fonts.map((f) => `/F${f.index} ${fontBase + fonts.indexOf(f) * 5} 0 R`).join(" ");
      obj(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageWpt} ${this.pageHpt}] `
        + `/Resources << /ProcSet [/PDF /Text] /Font << ${fontRes} >> >> /Contents ${contId} 0 R >>`);
      const stream = Buffer.from(p.lines.join("\n") + "\n", "latin1");
      const comp = zlib.deflateSync(stream);
      obj(contId, `<< /Length ${comp.length} /Filter /FlateDecode >>`, comp);
    }

    const xrefPos = pos;
    let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= total; id += 1) {
      xref += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${total + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    push(Buffer.from(xref, "latin1"));

    return Buffer.concat(chunks);
  }
}
