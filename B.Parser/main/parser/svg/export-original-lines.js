// export-original-lines.js — test-only original-PDF line SVG export.
//
// This deliberately does NOT read parser output and does NOT decode glyph
// codes through ToUnicode/codepages. It opens the PDF itself, scans only the
// requested page's content operators, maps shown codes to embedded-font GIDs,
// and writes the original line artwork as SVG. Memory stays bounded to one
// page: object offsets are scanned, page commands are spooled to a temp file,
// and glyph defs are cached only for glyphs used on that page.
//
//   node B.Parser/main/parser/svg/export-original-lines.js \
//     "C.Proofreading/main/content/review/pdf-parser-representative/representative.pdf" \
//     --page 61 --outdir ./original/representative-p61

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PdfFileObjects, openPdfScannedObjects } from "../read/pdf-object-file.js";
import {
  FontResourceLoader, PdfName, PdfRef, PdfHexBytes, isNumeric, toNumber,
  buildSimpleEncoding, CMapEncoding, parseCmapStream,
} from "../read/pdf-fonts.js";
import {
  collectPages, findRootPages, getStream, iterContentOperations,
  parseToUnicodeStream, MAX_PDF_OBJECTS, MAX_STREAM_MB,
} from "../read/pdf-extract.js";
import { spoolPageContent } from "../read/pdf-content-file.js";
import { PdfFileLexer } from "../read/pdf-file-lexer.js";
import { TtfFont, glyphContours } from "../read/glyf.js";
import { parseTtfCmap } from "../core/ttf-cmap.js";
import { framesOf, pitchOf, bandFor, lineSvg, sheetSvg, fixed } from "./scan-frame.js";

const args = process.argv.slice(2);
const positional = [];
const opt = { page: 61, outdir: "./original/representative-p61", lines: "", prepared: false };
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--page") opt.page = Number(args[++i]);
  else if (a === "--outdir") opt.outdir = args[++i];
  else if (a === "--lines") opt.lines = args[++i] ?? "";
  else if (a === "--prepared") opt.prepared = true;
  else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
  else positional.push(a);
}
const PDF = positional[0]
  ?? "C.Proofreading/main/content/review/pdf-parser-representative/representative.pdf";
if (!Number.isInteger(opt.page) || opt.page < 1) throw new Error("--page must be a positive integer");

const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = (p, q) => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const translate = (x, y) => [1, 0, 0, 1, x, y];
const numOf = (v, fallback = 0) => (isNumeric(v) && Number.isFinite(toNumber(v)) ? toNumber(v) : fallback);
const fmt = (v) => {
  const n = Math.round(v * 100000) / 100000;
  return Object.is(n, -0) ? "0" : String(n);
};
const hex = (v, w = 2) => v.toString(16).toUpperCase().padStart(w, "0");

function parseLines(spec, n) {
  if (!spec) return null;
  const out = new Set();
  for (const chunk of String(spec).split(",")) {
    const t = chunk.trim();
    if (!t) continue;
    if (t.includes("-")) {
      const [a, b] = t.split("-").map(Number);
      for (let i = a; i <= b; i += 1) out.add(i);
    } else out.add(Number(t));
  }
  return new Set([...out].filter((v) => v >= 1 && v <= n));
}

function contourPath(points, upm) {
  if (!points?.length) return "";
  const P = points.map((p) => ({ x: p.x / upm, y: p.y / upm, on: Boolean(p.onCurve) }));
  if (P.length < 2) return "";
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
  let pts = P;
  if (!pts[0].on) {
    if (pts[pts.length - 1].on) pts = [pts[pts.length - 1], ...pts.slice(0, -1)];
    else pts = [mid(pts[pts.length - 1], pts[0]), ...pts];
  }
  const start = pts[0];
  let d = `M${fmt(start.x)} ${fmt(start.y)}`;
  for (let i = 1; i < pts.length;) {
    const p = pts[i];
    if (p.on) { d += `L${fmt(p.x)} ${fmt(p.y)}`; i += 1; continue; }
    const next = pts[(i + 1) % pts.length];
    if (i + 1 < pts.length && next.on) {
      d += `Q${fmt(p.x)} ${fmt(p.y)} ${fmt(next.x)} ${fmt(next.y)}`;
      i += 2;
    } else if (i + 1 < pts.length) {
      const m = mid(p, next);
      d += `Q${fmt(p.x)} ${fmt(p.y)} ${fmt(m.x)} ${fmt(m.y)}`;
      i += 1;
    } else {
      d += `Q${fmt(p.x)} ${fmt(p.y)} ${fmt(start.x)} ${fmt(start.y)}`;
      i += 1;
    }
  }
  return `${d}Z`;
}

function contoursToPath(contours, upm) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let d = "";
  for (const contour of contours) {
    for (const p of contour) {
      const x = p.x / upm, y = p.y / upm;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    d += contourPath(contour, upm);
  }
  return { d, bbox: x0 === Infinity ? null : [x0, y0, x1, y1] };
}

function inherited(loader, pageNum, pageGen, key) {
  let page = loader.resolve(new PdfRef(pageNum, pageGen));
  const seen = new Set();
  for (let depth = 0; page instanceof Map && depth < 32; depth += 1) {
    if (page.has(key)) return loader.resolve(page.get(key));
    const parent = page.get("Parent");
    if (!(parent instanceof PdfRef) || seen.has(parent.key())) break;
    seen.add(parent.key());
    page = loader.resolve(parent);
  }
  return null;
}

function boxOf(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isNumeric)) return null;
  const [a, b, c, d] = value.map(toNumber);
  if (![a, b, c, d].every(Number.isFinite) || a === c || b === d) return null;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

function programOf(loader, descriptor) {
  const resolved = loader.resolve(descriptor);
  if (!(resolved instanceof Map)) return null;
  for (const key of ["FontFile2", "FontFile3", "FontFile"]) {
    const data = loader.streamOf(resolved.get(key));
    if (data) return data;
  }
  return null;
}

function simpleWidths(loader, font, descriptor) {
  const first = Math.trunc(numOf(loader.resolve(font.get("FirstChar")), 0));
  const widthsRaw = loader.resolve(font.get("Widths"));
  const widths = Array.isArray(widthsRaw) ? widthsRaw.map((v) => numOf(loader.resolve(v), NaN)) : [];
  const desc = loader.resolve(descriptor);
  const missing = desc instanceof Map ? numOf(loader.resolve(desc.get("MissingWidth")), NaN) : NaN;
  return { first, widths, missing };
}

function cidWidths(loader, descendant) {
  const map = new Map();
  const dw = numOf(loader.resolve(descendant.get("DW")), 1000);
  const w = loader.resolve(descendant.get("W"));
  if (Array.isArray(w)) {
    for (let i = 0; i < w.length;) {
      const c = Math.trunc(numOf(loader.resolve(w[i]), NaN));
      const next = loader.resolve(w[i + 1]);
      if (!Number.isFinite(c)) break;
      if (Array.isArray(next)) {
        next.forEach((v, j) => map.set(c + j, numOf(loader.resolve(v), dw)));
        i += 2;
      } else {
        const last = Math.trunc(numOf(next, NaN));
        const width = numOf(loader.resolve(w[i + 2]), dw);
        if (!Number.isFinite(last)) break;
        for (let cid = c; cid <= last; cid += 1) map.set(cid, width);
        i += 3;
      }
    }
  }
  return { map, dw };
}

function buildFaces(loader, pageNum, pageGen, warnings) {
  const faces = new Map();
  let index = 0;
  for (const [name, entry] of loader.pageFontResources(pageNum, pageGen)) {
    const font = loader.resolve(entry);
    if (!(font instanceof Map)) continue;
    const subtype = String(loader.resolve(font.get("Subtype")) ?? "");
    const baseFont = String(loader.resolve(font.get("BaseFont")) ?? "");
    let descriptor = font.get("FontDescriptor");
    let descendant = null;
    let isCid = subtype === "Type0";
    let cmap = new CMapEncoding(true);
    let cidToGid = null;
    let widthInfo = null;

    if (isCid) {
      const descendants = loader.resolve(font.get("DescendantFonts"));
      if (Array.isArray(descendants) && descendants.length) {
        const resolved = loader.resolve(descendants[0]);
        if (resolved instanceof Map) descendant = resolved;
      }
      descendant ??= new Map();
      descriptor = descendant.get("FontDescriptor");
      const encodingRaw = font.get("Encoding");
      const encoding = loader.resolve(encodingRaw);
      if (encodingRaw instanceof PdfRef) {
        const data = loader.streamOf(encodingRaw);
        cmap = data ? parseCmapStream(data) : new CMapEncoding(true);
      } else if (!(encoding instanceof PdfName)) {
        cmap = new CMapEncoding(true);
      }
      cidToGid = loader.cidToGid(descendant);
      widthInfo = cidWidths(loader, descendant);
    } else {
      widthInfo = simpleWidths(loader, font, descriptor);
    }

    const program = programOf(loader, descriptor);
    let ttf = null;
    if (program) {
      try { ttf = new TtfFont(program); } catch (error) {
        warnings.push(`font ${name} (${baseFont}): embedded program is not readable as TrueType glyf (${error.message})`);
      }
    } else {
      warnings.push(`font ${name} (${baseFont}): no embedded FontFile program; its glyphs cannot be exported as outlines`);
    }

    const [encodingText] = isCid ? [new Map()] : buildSimpleEncoding(font.get("Encoding"), (v) => loader.resolve(v));
    const face = {
      name, subtype, baseFont, isCid, ttf, cmap, cidToGid, widthInfo, encodingText,
      idPrefix: `f${index += 1}`,
      gidForCid(cid) { return this.cidToGid ? this.cidToGid(cid) : cid; },
      gidForSimple(code) {
        const map = this.ttf?.cmap;
        if (!map) return null;
        if (map.has(code)) return map.get(code);
        if (map.has(0xf000 + code)) return map.get(0xf000 + code);
        const text = this.encodingText.get(code);
        if (text) {
          const cp = [...text][0]?.codePointAt(0);
          if (cp !== undefined && map.has(cp)) return map.get(cp);
        }
        return null;
      },
      width1000(code, cid, gid) {
        if (this.isCid) {
          const hit = this.widthInfo.map.get(cid);
          if (Number.isFinite(hit)) return hit;
          if (Number.isFinite(this.widthInfo.dw)) return this.widthInfo.dw;
        } else {
          const at = code - this.widthInfo.first;
          const hit = this.widthInfo.widths[at];
          if (Number.isFinite(hit)) return hit;
          if (Number.isFinite(this.widthInfo.missing)) return this.widthInfo.missing;
        }
        if (this.ttf && gid !== null && gid !== undefined) {
          const adv = this.ttf.advanceWidths[gid];
          if (Number.isFinite(adv)) return adv * 1000 / this.ttf.unitsPerEm;
        }
        return 1000;
      },
    };
    faces.set(name, face);
  }
  return faces;
}

let scanned = null;
let objects = null;
let spooled = null;
try {
  if (opt.prepared) {
    objects = new PdfFileObjects(PDF, { maxObjects: MAX_PDF_OBJECTS });
  } else {
    scanned = openPdfScannedObjects(PDF, { maxObjects: MAX_PDF_OBJECTS });
    objects = scanned.objects;
  }

  const loader = new FontResourceLoader(objects, getStream, parseTtfCmap, parseToUnicodeStream);
  const root = findRootPages(objects);
  if (root === null || root === undefined) throw new Error("no page tree found in the original PDF");
  const pages = collectPages(objects, root);
  if (opt.page > pages.length) throw new Error(`page ${opt.page} requested, PDF has ${pages.length} pages`);
  const [pageNum, pageGen] = pages[opt.page - 1];

  const media = boxOf(inherited(loader, pageNum, pageGen, "MediaBox")) ?? [0, 0, 612, 792];
  const rotate = ((Math.trunc(numOf(inherited(loader, pageNum, pageGen, "Rotate"), 0)) % 360) + 360) % 360;
  if (rotate !== 0) throw new Error(`page rotation ${rotate} is not supported by this test exporter yet`);
  const pageW = media[2] - media[0];
  const pageH = media[3] - media[1];
  const flip = [1, 0, 0, -1, -media[0], media[3]];

  const warnings = [];
  const faces = buildFaces(loader, pageNum, pageGen, warnings);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "original-line-svg-"));
  spooled = spoolPageContent(loader, pageNum, pageGen, {
    maxBytes: MAX_STREAM_MB * 1024 * 1024,
    scratchDir: scratch,
  });

  const defs = Object.create(null);
  const defInfo = new Map();
  const uses = [];
  const stats = {
    shownGlyphs: 0, exportedGlyphs: 0, emptyGlyphs: 0, missingGlyphs: 0,
    unsetFontGlyphs: 0, formXObjects: 0, rotatedGlyphs: 0,
  };

  const glyphDef = (face, gid) => {
    const id = `${face.idPrefix}g${gid}`;
    if (defInfo.has(id)) return defInfo.get(id);
    let info = null;
    if (face.ttf) {
      const contours = glyphContours(face.ttf, gid);
      if (contours.length) {
        const built = contoursToPath(contours, face.ttf.unitsPerEm || 1000);
        if (built.d) {
          defs[id] = built.d;
          info = { id, bbox: built.bbox };
        }
      }
    }
    defInfo.set(id, info);
    return info;
  };

  let ctm = [...IDENTITY];
  let tm = [...IDENTITY];
  let tlm = [...IDENTITY];
  let inText = false;
  let fontName = null;
  let fontSize = 0;
  let charSpace = 0;
  let wordSpace = 0;
  let hScale = 100;
  let leading = 0;
  let rise = 0;
  let renderMode = 0;
  const stack = [];

  const advanceText = (tx) => { tm = multiply(tm, translate(tx, 0)); };
  const moveLine = (tx, ty) => { tlm = multiply(tlm, translate(tx, ty)); tm = [...tlm]; };
  const glyphMatrix = () => {
    const trm = [fontSize * hScale / 100, 0, 0, fontSize, 0, rise];
    return multiply(flip, multiply(ctm, multiply(tm, trm)));
  };

  const recordGlyph = (face, code, cid, gid) => {
    stats.shownGlyphs += 1;
    const width = face ? face.width1000(code, cid, gid) : 1000;
    if (face && gid !== null && gid !== undefined && renderMode !== 3) {
      const def = glyphDef(face, gid);
      if (def) {
        const m = glyphMatrix();
        const size = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || fontSize;
        if (Math.abs(m[1]) > size * 1e-6) stats.rotatedGlyphs += 1;
        let ink = null;
        if (def.bbox) {
          const [x0, y0, x1, y1] = def.bbox;
          const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => apply(m, x, y));
          ink = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
            Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
        }
        uses.push({
          href: def.id, x: m[4], y: m[5], ink, size: Number(fixed(size)),
          raw: `<use xlink:href="#${def.id}" transform="matrix(${m.map(fmt).join(",")})"/>`,
          index: uses.length, font: face.name, baseFont: face.baseFont, code, cid, gid,
        });
        stats.exportedGlyphs += 1;
      } else {
        stats.emptyGlyphs += 1;
      }
    } else if (!face) {
      stats.unsetFontGlyphs += 1;
    } else {
      stats.missingGlyphs += 1;
    }
    const tx = ((width / 1000) * fontSize + charSpace + (!face?.isCid && code === 32 ? wordSpace : 0)) * hScale / 100;
    advanceText(tx);
  };

  const showBytes = (value) => {
    const data = value instanceof PdfHexBytes ? value.s : value;
    if (typeof data !== "string" || !data.length) return;
    const face = fontName ? faces.get(fontName) : null;
    if (!face) {
      for (let i = 0; i < data.length; i += 1) recordGlyph(null, data.charCodeAt(i), null, null);
      return;
    }
    if (face.isCid) {
      for (const [code, cid, width, invalid] of face.cmap.iterCodes(data)) {
        recordGlyph(face, code, cid, invalid ? null : face.gidForCid(cid));
      }
    } else {
      for (let i = 0; i < data.length; i += 1) {
        const code = data.charCodeAt(i);
        recordGlyph(face, code, null, face.gidForSimple(code));
      }
    }
  };

  const lexer = spooled.size ? new PdfFileLexer(spooled.fd, spooled.size) : "";
  for (const [op, operands] of iterContentOperations(lexer)) {
    if (op === "q") {
      stack.push({ ctm: [...ctm], fontName, fontSize, charSpace, wordSpace, hScale, leading, rise, renderMode });
      continue;
    }
    if (op === "Q") {
      const saved = stack.pop();
      if (saved) ({ ctm, fontName, fontSize, charSpace, wordSpace, hScale, leading, rise, renderMode } = saved);
      continue;
    }
    if (op === "cm" && operands.length >= 6 && operands.slice(-6).every(isNumeric)) {
      ctm = multiply(ctm, operands.slice(-6).map(toNumber));
      continue;
    }
    if (op === "Do") { stats.formXObjects += 1; continue; }
    if (op === "BT") { inText = true; tm = [...IDENTITY]; tlm = [...IDENTITY]; continue; }
    if (op === "ET") { inText = false; continue; }
    if (op === "Tf") {
      const name = operands.at(-2);
      if (name instanceof PdfName) fontName = String(name);
      if (isNumeric(operands.at(-1))) fontSize = toNumber(operands.at(-1));
      continue;
    }
    if (!inText) continue;
    if (op === "Tm" && operands.length >= 6 && operands.slice(-6).every(isNumeric)) {
      tm = operands.slice(-6).map(toNumber); tlm = [...tm]; continue;
    }
    if ((op === "Td" || op === "TD") && operands.length >= 2 && operands.slice(-2).every(isNumeric)) {
      const [tx, ty] = operands.slice(-2).map(toNumber);
      if (op === "TD") leading = -ty;
      moveLine(tx, ty); continue;
    }
    if (op === "TL" && isNumeric(operands.at(-1))) { leading = toNumber(operands.at(-1)); continue; }
    if (op === "T*") { moveLine(0, -leading); continue; }
    if (op === "Tc" && isNumeric(operands.at(-1))) { charSpace = toNumber(operands.at(-1)); continue; }
    if (op === "Tw" && isNumeric(operands.at(-1))) { wordSpace = toNumber(operands.at(-1)); continue; }
    if (op === "Tz" && isNumeric(operands.at(-1))) { hScale = toNumber(operands.at(-1)); continue; }
    if (op === "Ts" && isNumeric(operands.at(-1))) { rise = toNumber(operands.at(-1)); continue; }
    if (op === "Tr" && isNumeric(operands.at(-1))) { renderMode = Math.trunc(toNumber(operands.at(-1))); continue; }
    if (op === "Tj") { showBytes(operands.at(-1)); continue; }
    if (op === "TJ") {
      const arr = operands.at(-1);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === "string" || item instanceof PdfHexBytes) showBytes(item);
          else if (isNumeric(item)) advanceText((-toNumber(item) / 1000) * fontSize * hScale / 100);
        }
      }
      continue;
    }
    if (op === "'") { moveLine(0, -leading); showBytes(operands.at(-1)); continue; }
    if (op === '"') {
      if (isNumeric(operands.at(-3))) wordSpace = toNumber(operands.at(-3));
      if (isNumeric(operands.at(-2))) charSpace = toNumber(operands.at(-2));
      moveLine(0, -leading); showBytes(operands.at(-1)); continue;
    }
  }
  spooled.close(); spooled = null;
  fs.rmSync(scratch, { recursive: true, force: true });

  // Original line grouping: positions only. No decoded text participates.
  const rows = [];
  for (const u of [...uses].sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index)) {
    const tol = Math.max(1.25, u.size * 0.18);
    let row = rows.find((r) => Math.abs(u.y - r.y) <= tol);
    if (!row) { row = { y: u.y, glyphs: [] }; rows.push(row); }
    row.glyphs.push(u);
  }
  rows.sort((a, b) => a.y - b.y);
  for (const row of rows) {
    row.glyphs.sort((a, b) => a.x - b.x || a.index - b.index);
    const ys = row.glyphs.map((u) => u.y).sort((a, b) => a - b);
    row.y = ys[Math.floor(ys.length / 2)];
    const sizes = new Map();
    for (const u of row.glyphs) sizes.set(u.size, (sizes.get(u.size) ?? 0) + 1);
    row.size = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    row.x = Math.min(...row.glyphs.map((u) => (u.ink ? u.ink[0] : u.x)));
    row.band = bandFor(row.y, row.size, row.glyphs);
  }

  const frames = framesOf(rows.map((r) => [r.x, r.y, r.size, "", r.band]));
  const pitch = pitchOf(frames);
  const keep = parseLines(opt.lines, frames.length);
  const selected = frames.filter((f) => !keep || keep.has(f.index));
  if (!selected.length) throw new Error("line selector matched no original lines");

  fs.mkdirSync(opt.outdir, { recursive: true });
  const sheetRows = selected.map((frame) => ({ frame, uses: rows[frame.index - 1].glyphs }));
  const sheetPath = path.join(opt.outdir, "sheet.svg");
  fs.writeFileSync(sheetPath, sheetSvg({
    width: pageW, rows: sheetRows, defs, pitch, pageHeight: pageH,
  }));

  const manifestLines = [];
  for (const frame of selected) {
    const row = rows[frame.index - 1];
    const file = `line-${String(frame.index).padStart(2, "0")}.svg`;
    fs.writeFileSync(path.join(opt.outdir, file), lineSvg({
      width: pageW, frame, uses: row.glyphs, defs, pitch,
      label: `${path.basename(PDF)} original page ${opt.page} line ${frame.index}`,
    }));
    manifestLines.push({
      line: frame.index,
      file,
      baseline: Number(fixed(frame.baseline)),
      size: frame.size,
      glyphs: row.glyphs.length,
      fonts: [...new Set(row.glyphs.map((u) => `${u.font}:${u.baseFont}`))],
      codes: row.glyphs.map((u) => hex(u.code, u.code > 0xff ? 4 : 2)),
      gids: row.glyphs.map((u) => u.gid),
    });
  }

  const manifest = {
    sourcePdf: PDF,
    sourceMode: opt.prepared ? "prepared-pdf-file-objects" : "original-pdf-scanned-objects",
    evidence: "original PDF content operators + embedded font outlines; no parser output, no ToUnicode/codepage text decode",
    page: opt.page,
    pages: pages.length,
    pageObject: `${pageNum},${pageGen}`,
    mediaBox: media,
    width: pageW,
    height: pageH,
    pitch: pitch || null,
    lines: manifestLines,
    stats,
    warnings,
  };
  fs.writeFileSync(path.join(opt.outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`${path.basename(PDF)} page ${opt.page}/${pages.length} object ${pageNum},${pageGen}`);
  console.log(`original glyphs: shown ${stats.shownGlyphs}, exported ${stats.exportedGlyphs}, empty ${stats.emptyGlyphs}, missing ${stats.missingGlyphs}, unset-font ${stats.unsetFontGlyphs}`);
  console.log(`lines: ${frames.length} total, ${selected.length} written; pitch ${pitch || "—"}`);
  console.log(`-> ${sheetPath}`);
  console.log(`-> ${path.join(opt.outdir, "line-*.svg")}`);
  console.log(`-> ${path.join(opt.outdir, "manifest.json")}`);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (stats.formXObjects) console.warn(`warning: ${stats.formXObjects} Do operator(s) seen; form XObject text is not recursed by this test exporter`);
  if (stats.rotatedGlyphs) console.warn(`warning: ${stats.rotatedGlyphs} rotated glyph(s) grouped by origin only`);
} finally {
  try { spooled?.close(); } catch { /* already closed */ }
  if (scanned) scanned.close();
  else objects?.close?.();
}
