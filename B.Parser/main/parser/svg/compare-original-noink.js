// compare-original-noink.js — first 3-way no-ink test.
//
// Sources, all shape-only:
//   1. document glyphs exported from the ORIGINAL PDF page (export-original-lines.js)
//   2. foreground glyph defs in the existing Pyidaungsu Burmese+Pali SVG compare sheet
//   3. background glyph defs in the same compare sheet (Padauk)
//
// No parser output and no ToUnicode text is used. Candidate sample labels come
// only from the labelled SVG index entries that use a glyph def.
//
// The measurement is negative space in a fixed baseline frame: coarse white
// occupancy plus enclosed white components (holes), with ink ratio / ink box
// kept as small sanity terms. This is a comparison test, not a repair claim.

import fs from "node:fs";
import path from "node:path";
import { parsePathData } from "../B.Parser/main/parser/shape/svg.js";
import { fixed } from "./scan-frame.js";

const args = process.argv.slice(2);
const opt = {
  originalDir: "./original/representative-p61",
  compareSvg: "B.Parser/main/parser/jason-map/vector/index-font11-burmese-pali-compare-pyidaungsu-padauk.svg",
  outdir: "./original/representative-p61-noink",
  top: 3,
};
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--original-dir") opt.originalDir = args[++i];
  else if (a === "--compare") opt.compareSvg = args[++i];
  else if (a === "--outdir") opt.outdir = args[++i];
  else if (a === "--top") opt.top = Number(args[++i]);
  else throw new Error(`unknown option ${a}`);
}

const FRAME = { x0: -0.45, x1: 1.55, y0: -1.15, y1: 0.65, w: 100, h: 90 };
FRAME.dx = (FRAME.x1 - FRAME.x0) / FRAME.w;
FRAME.dy = (FRAME.y1 - FRAME.y0) / FRAME.h;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const codeLabel = (code) => code.toString(16).toUpperCase().padStart(code > 0xff ? 4 : 2, "0");

function defsOf(svg) {
  const start = svg.indexOf("<defs>");
  const end = svg.indexOf("</defs>");
  const block = start >= 0 && end > start ? svg.slice(start, end) : svg;
  const out = new Map();
  for (const m of block.matchAll(/<path\s+id="([^"]+)"\s+d="([^"]+)"\s*\/>/g)) out.set(m[1], m[2]);
  return out;
}

function canonicalContours(d, kind) {
  const contours = parsePathData(d, 6);
  if (kind === "original") return contours.map((c) => c.map(([x, y]) => [x, -y]));
  return contours.map((c) => c.map(([x, y]) => [x / 11, y / 11])); // compare sheet is font 11, y-down
}

function rasterise(contours) {
  const { x0, y0, dx, dy, w, h } = FRAME;
  const bits = new Uint8Array(w * h);
  const edges = [];
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, clipped = false;
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      for (const [x, y] of [a, b]) {
        if (x < bx0) bx0 = x;
        if (y < by0) by0 = y;
        if (x > bx1) bx1 = x;
        if (y > by1) by1 = y;
        if (x < FRAME.x0 - 0.01 || x > FRAME.x1 + 0.01 || y < FRAME.y0 - 0.01 || y > FRAME.y1 + 0.01) clipped = true;
      }
      if (a[1] !== b[1]) edges.push([a, b]);
    }
  }
  if (!Number.isFinite(bx0)) return null;
  for (let row = 0; row < h; row += 1) {
    const yc = y0 + (row + 0.5) * dy;
    const xs = [];
    for (const [[x1, y1], [x2, y2]] of edges) {
      let dir = 0;
      if (y1 <= yc && yc < y2) dir = 1;
      else if (y2 <= yc && yc < y1) dir = -1;
      else continue;
      xs.push([x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1), dir]);
    }
    xs.sort((a, b) => a[0] - b[0]);
    let winding = 0;
    for (let i = 0; i < xs.length; i += 1) {
      winding += xs[i][1];
      if (winding === 0 || i + 1 >= xs.length) continue;
      const from = Math.max(0, Math.ceil((xs[i][0] - x0) / dx - 0.5));
      const to = Math.min(w - 1, Math.ceil((xs[i + 1][0] - x0) / dx - 0.5) - 1);
      for (let col = from; col <= to; col += 1) bits[row * w + col] = 1;
    }
  }
  return { bits, bbox: [bx0, by0, bx1, by1], clipped };
}

function signatureOf(contours) {
  const raster = rasterise(contours);
  if (!raster) return null;
  const { bits, bbox, clipped } = raster;
  const { w, h, x0, y0, dx, dy } = FRAME;
  const total = w * h;
  let ink = 0;
  for (const bit of bits) ink += bit;

  const label = new Int32Array(total).fill(-1);
  const holes = [];
  let nextLabel = 0;
  const stack = [];
  for (let start = 0; start < total; start += 1) {
    if (bits[start] || label[start] !== -1) continue;
    const id = nextLabel++;
    let area = 0, sx = 0, sy = 0, minX = w, minY = h, maxX = -1, maxY = -1, border = false;
    stack.length = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const at = stack.pop();
      const x = at % w, y = Math.floor(at / w);
      area += 1; sx += x; sy += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      const neighbours = [x > 0 ? at - 1 : -1, x + 1 < w ? at + 1 : -1, y > 0 ? at - w : -1, y + 1 < h ? at + w : -1];
      for (const n of neighbours) {
        if (n >= 0 && !bits[n] && label[n] === -1) { label[n] = id; stack.push(n); }
      }
    }
    if (!border && area >= 3) {
      holes.push({
        area,
        areaRatio: area / total,
        cx: x0 + ((sx / area) + 0.5) * dx,
        cy: y0 + ((sy / area) + 0.5) * dy,
        bbox: [x0 + minX * dx, y0 + minY * dy, x0 + (maxX + 1) * dx, y0 + (maxY + 1) * dy],
      });
    }
  }
  holes.sort((a, b) => b.area - a.area);

  const grid = [];
  const blockW = w / 10, blockH = h / 9;
  for (let gy = 0; gy < 9; gy += 1) {
    for (let gx = 0; gx < 10; gx += 1) {
      let white = 0;
      for (let y = gy * blockH; y < (gy + 1) * blockH; y += 1) {
        for (let x = gx * blockW; x < (gx + 1) * blockW; x += 1) if (!bits[y * w + x]) white += 1;
      }
      grid.push(white / (blockW * blockH));
    }
  }

  const holeVec = [];
  for (let i = 0; i < 4; i += 1) {
    const hole = holes[i];
    if (!hole) { holeVec.push(0, 0, 0, 0, 0); continue; }
    holeVec.push(
      clamp01(hole.areaRatio * 6),
      clamp01((hole.cx - FRAME.x0) / (FRAME.x1 - FRAME.x0)),
      clamp01((hole.cy - FRAME.y0) / (FRAME.y1 - FRAME.y0)),
      clamp01((hole.bbox[2] - hole.bbox[0]) / 1.2),
      clamp01((hole.bbox[3] - hole.bbox[1]) / 1.2),
    );
  }
  return { bits, bbox, clipped, inkRatio: ink / total, holes, grid, holeVec };
}

function distance(a, b) {
  let grid = 0;
  for (let i = 0; i < a.grid.length; i += 1) grid += Math.abs(a.grid[i] - b.grid[i]);
  grid /= a.grid.length;
  let holeSq = 0;
  for (let i = 0; i < a.holeVec.length; i += 1) holeSq += (a.holeVec[i] - b.holeVec[i]) ** 2;
  const hole = clamp01(Math.sqrt(holeSq / a.holeVec.length) * 1.6);
  const holeCount = clamp01(Math.abs(a.holes.length - b.holes.length) / 3);
  const ink = clamp01(Math.abs(a.inkRatio - b.inkRatio) / 0.22);
  let box = 0;
  for (let i = 0; i < 4; i += 1) box += Math.abs(a.bbox[i] - b.bbox[i]);
  box = clamp01((box / 4) / 0.45);
  let xor = 0;
  for (let i = 0; i < a.bits.length; i += 1) if (a.bits[i] !== b.bits[i]) xor += 1;
  xor /= a.bits.length;
  const total = 0.50 * grid + 0.22 * hole + 0.08 * holeCount + 0.10 * ink + 0.10 * box;
  return { total, grid, hole, holeCount, ink, box, xor };
}

const kindRank = (kind) => ({ mark: 0, consonant: 1, digit: 2, burmese: 3, pali: 4 }[kind] ?? 9);
function summariseLabels(labels) {
  const unique = [...new Map((labels ?? []).map((l) => [l.text, l])).values()]
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind)
      || [...a.text].length - [...b.text].length || a.text.localeCompare(b.text));
  return {
    main: unique[0]?.text ?? "",
    mainKind: unique[0]?.kind ?? "",
    samples: unique.slice(0, 8).map((l) => l.text),
    count: unique.length,
  };
}

const originalSvg = fs.readFileSync(path.join(opt.originalDir, "sheet.svg"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(opt.originalDir, "manifest.json"), "utf8"));
const originalDefs = defsOf(originalSvg);
const originalInfo = new Map();
for (const line of manifest.lines) {
  line.gids.forEach((gid, i) => {
    const id = `f1g${gid}`;
    if (!originalInfo.has(id)) originalInfo.set(id, { id, gid, codes: new Set(), lines: new Set(), count: 0 });
    const info = originalInfo.get(id);
    info.codes.add(Number.parseInt(line.codes[i], 16));
    info.lines.add(line.line);
    info.count += 1;
  });
}
const originals = [];
for (const [id, d] of originalDefs) {
  const info = originalInfo.get(id) ?? { id, gid: Number(id.replace(/^f1g/, "")), codes: new Set(), lines: new Set(), count: 0 };
  const sig = signatureOf(canonicalContours(d, "original"));
  if (!sig) continue;
  originals.push({
    id, d, sig, gid: info.gid,
    codes: [...info.codes].sort((a, b) => a - b),
    lines: [...info.lines].sort((a, b) => a - b),
    count: info.count,
  });
}
originals.sort((a, b) => (a.codes[0] ?? 9999) - (b.codes[0] ?? 9999) || a.gid - b.gid);

const compareSvgText = fs.readFileSync(opt.compareSvg, "utf8");
const compareDefs = defsOf(compareSvgText);
const entries = [];
const labels = new Map();
const addLabel = (id, label) => {
  if (!labels.has(id)) labels.set(id, []);
  labels.get(id).push(label);
};
for (const g of compareSvgText.matchAll(/<g\s+id="([^"]*)"\s+data-kind="([^"]*)"\s+data-cp="([^"]*)"\s+data-row="([^"]*)"\s+data-x="([^"]*)"\s+data-baseline="([^"]*)"\s*>([\s\S]*?)<\/g>/g)) {
  const [, text, kind, cp, row, x, baseline, inner] = g;
  const entry = { text, kind, cp, row: Number(row), x: Number(x), baseline: Number(baseline) };
  entries.push(entry);
  for (const u of inner.matchAll(/<use\s+href="#(g[^"]+)"\s+x="([^"]+)"\s+y="([^"]+)"\s*\/>/g)) addLabel(u[1], entry);
}
const byBaseline = new Map();
for (const entry of entries) {
  const key = fixed(entry.baseline);
  if (!byBaseline.has(key)) byBaseline.set(key, []);
  byBaseline.get(key).push(entry);
}
for (const list of byBaseline.values()) list.sort((a, b) => a.x - b.x);
const bgUseFreq = new Map();
const bgAtEntryX = new Map();
const bgLayer = /<g\s+id="font-layer-bg"[^>]*>([\s\S]*?)<\/g>/.exec(compareSvgText)?.[1] ?? "";
for (const u of bgLayer.matchAll(/<use\s+href="#(bg-g[^"]+)"\s+x="([^"]+)"\s+y="([^"]+)"\s*\/>/g)) {
  const [, id, xs, ys] = u;
  const x = Number(xs), y = Number(ys);
  bgUseFreq.set(id, (bgUseFreq.get(id) ?? 0) + 1);
  const list = byBaseline.get(fixed(y)) ?? [];
  let entry = null;
  for (const candidate of list) {
    if (candidate.x <= x + 1e-6) entry = candidate;
    else break;
  }
  if (entry) {
    addLabel(id, entry);
    if (Math.abs(entry.x - x) < 0.01) bgAtEntryX.set(id, (bgAtEntryX.get(id) ?? 0) + 1);
  }
}

function candidatePool(prefix) {
  const pool = [];
  for (const [id, d] of compareDefs) {
    if (prefix === "fg" && !/^g\d+$/.test(id)) continue;
    if (prefix === "bg" && !/^bg-g\d+$/.test(id)) continue;
    const rawLabels = labels.get(id) ?? [];
    const distinctMarkLabels = new Set(rawLabels.filter((l) => l.kind === "mark").map((l) => l.text));
    const markFraction = rawLabels.length
      ? rawLabels.filter((l) => l.kind === "mark").length / rawLabels.length : 0;
    // Padauk's isolated-mark rendering includes one dotted-circle placeholder
    // beside many different marks. Exclude only that placeholder pattern, not
    // real glyphs that often begin an entry.
    const dottedCircleSuspect = prefix === "bg" && distinctMarkLabels.size >= 10 && markFraction >= 0.8;
    if (dottedCircleSuspect) continue;
    const sig = signatureOf(canonicalContours(d, "compare"));
    if (!sig) continue;
    pool.push({ id, d, sig, labels: summariseLabels(labels.get(id)), dottedCircleSuspect });
  }
  return pool;
}
const pyidaungsu = candidatePool("fg");
const padauk = candidatePool("bg");

function rank(original, pool) {
  return pool.map((candidate) => ({ candidate, dist: distance(original.sig, candidate.sig) }))
    .sort((a, b) => a.dist.total - b.dist.total)
    .slice(0, opt.top);
}

const round = (v) => Math.round(v * 1000) / 1000;
const results = originals.map((original) => {
  const p = rank(original, pyidaungsu);
  const d = rank(original, padauk);
  const pMain = p[0]?.candidate.labels.main ?? "";
  const dMain = d[0]?.candidate.labels.main ?? "";
  const pSamples = new Set(p[0]?.candidate.labels.samples ?? []);
  const sharedSamples = (d[0]?.candidate.labels.samples ?? []).filter((text) => pSamples.has(text));
  const pack = (items) => items.map(({ candidate, dist }) => ({
    glyph: candidate.id,
    distance: round(dist.total),
    parts: {
      whiteGrid: round(dist.grid), holes: round(dist.hole), holeCount: round(dist.holeCount),
      inkRatio: round(dist.ink), inkBox: round(dist.box), maskXor: round(dist.xor),
    },
    candidateHoles: candidate.sig.holes.length,
    candidateInkRatio: round(candidate.sig.inkRatio),
    labels: candidate.labels,
  }));
  return {
    original: {
      glyph: original.id,
      gid: original.gid,
      codes: original.codes.map(codeLabel),
      lines: original.lines,
      count: original.count,
      holes: original.sig.holes.length,
      holeAreas: original.sig.holes.map((h) => round(h.areaRatio)),
      inkRatio: round(original.sig.inkRatio),
      bboxEm: original.sig.bbox.map(round),
      clipped: original.sig.clipped,
    },
    pyidaungsu: pack(p),
    padauk: pack(d),
    agreeMain: Boolean(pMain && pMain === dMain),
    sharedSamples,
    _pGlyph: p[0]?.candidate ?? null,
    _dGlyph: d[0]?.candidate ?? null,
    _original: original,
  };
});

const summary = {
  sourceOriginalDir: opt.originalDir,
  sourceCompareSvg: opt.compareSvg,
  evidence: "original PDF glyph outlines vs labelled SVG index glyph defs; no parser text/ToUnicode",
  frameEm: FRAME,
  originalGlyphs: originals.length,
  pyidaungsuGlyphs: pyidaungsu.length,
  padaukGlyphs: padauk.length,
  agreeMain: results.filter((r) => r.agreeMain).length,
  sharedSample: results.filter((r) => r.sharedSamples.length).length,
  medianPyidaungsuDistance: round([...results].sort((a, b) => a.pyidaungsu[0].distance - b.pyidaungsu[0].distance)[Math.floor(results.length / 2)]?.pyidaungsu[0].distance ?? 0),
  medianPadaukDistance: round([...results].sort((a, b) => a.padauk[0].distance - b.padauk[0].distance)[Math.floor(results.length / 2)]?.padauk[0].distance ?? 0),
};

fs.mkdirSync(opt.outdir, { recursive: true });
fs.writeFileSync(path.join(opt.outdir, "noink-report.json"), `${JSON.stringify({
  summary,
  results: results.map(({ _pGlyph, _dGlyph, _original, ...rest }) => rest),
}, null, 2)}\n`);

// Contact sheet: Original (black) / Pyidaungsu (blue) / Padauk (red).
const usedDefs = new Map();
for (const r of results) {
  usedDefs.set(r._original.id, r._original.d);
  if (r._pGlyph) usedDefs.set(r._pGlyph.id, r._pGlyph.d);
  if (r._dGlyph) usedDefs.set(r._dGlyph.id, r._dGlyph.d);
}
const scale = 30;
const cellW = 58, cellH = 54;
const blockW = 252, blockH = 104;
const cols = 4;
const rows = Math.ceil(results.length / cols);
const width = cols * blockW + 24;
const height = rows * blockH + 58;
const baselineInCell = (0 - FRAME.y0) * scale;
const glyphUse = (id, x, y, source, color) => {
  const tx = x - FRAME.x0 * scale;
  const ty = y - FRAME.y0 * scale;
  const s = source === "original" ? `${scale},${-scale}` : `${scale / 11},${scale / 11}`;
  return `<use href="#${esc(id)}" transform="translate(${fixed(tx)} ${fixed(ty)}) scale(${s})" fill="${color}"/>`;
};
let body = "";
results.forEach((r, i) => {
  const bx = 12 + (i % cols) * blockW;
  const by = 46 + Math.floor(i / cols) * blockH;
  const title = `${r.original.codes.join("/")} g${r.original.gid} x${r.original.count} h${r.original.holes}`;
  const p = r.pyidaungsu[0], d = r.padauk[0];
  const pText = `Pyi ${p ? p.distance.toFixed(3) : "-"} ${p?.labels.main ?? ""}`;
  const dText = `Pad ${d ? d.distance.toFixed(3) : "-"} ${d?.labels.main ?? ""}`;
  body += `<g><rect x="${bx}" y="${by}" width="${blockW - 8}" height="${blockH - 8}" fill="#fff" stroke="#d7dee8"/>`;
  body += `<text x="${bx + 6}" y="${by + 12}" font-size="9" font-family="monospace">${esc(title)}</text>`;
  const items = [
    [r._original.id, bx + 6, "original", "#111827", "orig"],
    [r._pGlyph?.id, bx + 70, "compare", "#2563eb", pText],
    [r._dGlyph?.id, bx + 134, "compare", "#e11d48", dText],
  ];
  for (const [id, x, source, color, label] of items) {
    if (!id) continue;
    body += `<rect x="${x}" y="${by + 16}" width="${cellW}" height="${cellH}" fill="#f8fbff" stroke="#e5e7eb"/>`;
    body += `<line x1="${x}" y1="${fixed(by + 16 + baselineInCell)}" x2="${x + cellW}" y2="${fixed(by + 16 + baselineInCell)}" stroke="#facc15" stroke-width="1"/>`;
    body += glyphUse(id, x, by + 16, source, color);
    body += `<text x="${x}" y="${by + 82}" font-size="8" font-family="sans-serif">${esc(String(label).slice(0, 18))}</text>`;
  }
  body += `<text x="${bx + 202}" y="${by + 30}" font-size="8" font-family="sans-serif">${r.agreeMain ? "same" : r.sharedSamples.length ? "share" : "diff"}</text>`;
  body += `<text x="${bx + 202}" y="${by + 42}" font-size="8" font-family="monospace">lines ${esc(r.original.lines.slice(0, 4).join(","))}</text>`;
  body += `</g>`;
});
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`
  + `<rect width="${width}" height="${height}" fill="#ffffff"/>\n`
  + `<text x="12" y="20" font-size="14" font-family="sans-serif">Original PDF glyphs vs Pyidaungsu SVG vs Padauk — no-ink nearest test (page ${manifest.page})</text>\n`
  + `<text x="12" y="37" font-size="10" font-family="sans-serif">black=original PDF, blue=Pyidaungsu, red=Padauk; lower distance is closer; labels are sample SVG-index entries using that glyph.</text>\n`
  + `<defs>${[...usedDefs].map(([id, d]) => `<path id="${esc(id)}" d="${esc(d)}"/>`).join("")}</defs>\n${body}\n</svg>\n`;
const sheetPath = path.join(opt.outdir, "noink-contact-sheet.svg");
fs.writeFileSync(sheetPath, sheet);

console.log(`original glyphs ${originals.length}; Pyidaungsu candidates ${pyidaungsu.length}; Padauk candidates ${padauk.length}`);
console.log(`nearest main-label agreement ${summary.agreeMain}/${results.length}; shared sample label ${summary.sharedSample}/${results.length}`);
console.log(`median distance Pyidaungsu ${summary.medianPyidaungsuDistance}; Padauk ${summary.medianPadaukDistance}`);
console.log(`-> ${sheetPath}`);
console.log(`-> ${path.join(opt.outdir, "noink-report.json")}`);
for (const r of results.slice(0, 12)) {
  console.log(`${r.original.codes.join("/")} g${r.original.gid} h${r.original.holes} -> Pyi ${r.pyidaungsu[0]?.glyph} ${r.pyidaungsu[0]?.distance} ${r.pyidaungsu[0]?.labels.main} | Pad ${r.padauk[0]?.glyph} ${r.padauk[0]?.distance} ${r.padauk[0]?.labels.main} | ${r.agreeMain ? "same" : "diff"}`);
}
