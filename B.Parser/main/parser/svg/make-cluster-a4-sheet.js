// make-cluster-a4-sheet.js — one SVG, 3 vertical A4 pages stacked (not side by side).
//
// Reads the cluster-match reports for original page-61 lines and lays compact
// cluster blocks out across 3 portrait A4 pages stacked vertically in a single
// SVG canvas. A4: 595.28 pt × 841.89 pt. Stacked canvas: 595.28 × 2525.67 pt.
//
//   node B.Parser/main/parser/svg/make-cluster-a4-sheet.js \
//     <cluster-report.json> ... \
//     --out ./original/representative-p61-cluster/cluster-sheet-a4-3page.svg
//
// Each cluster card: cluster index, top matched label + vote count, glyph count,
// a small ink-bbox boundary box, and the per-glyph nearest labels/distances.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const inputs = [];
let out = "./original/representative-p61-cluster/cluster-sheet-a4-3page.svg";
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--out") out = args[++i];
  else inputs.push(a);
}
if (inputs.length === 0) throw new Error("pass at least one cluster-report.json");

const A4_W = 595.28;
const A4_H = 841.89;
const PAGES = 3;
const CANVAS_W = A4_W;
const CANVAS_H = A4_H * PAGES;

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const round1 = (v) => Math.round(v * 10) / 10;
const fixed = (v) => Math.round(v * 100) / 100;

const MARGIN = 12;
const COL_W = A4_W - 2 * MARGIN;
const PAGE_HEADER_H = 40;
const CLUSTER_PAD = 7;
const GLYPH_ROW_H = 8;
const MAX_GLYPH_ROWS = 4;
const MIN_CLUSTER_H = 40;

function loadReports(inputs) {
  const reports = [];
  for (const f of inputs) {
    const r = JSON.parse(fs.readFileSync(f, "utf8"));
    reports.push({ file: f, ...r });
  }
  return reports;
}

// Boundary-box scale helper: keep the ink bbox small and bounded.
function cbScaleFor(cbW, cbH) {
  return Math.min(100 / Math.max(cbW, 1), 55 / Math.max(cbH, 1), 1.5);
}

// Height of one cluster block (card).
function clusterBlockHeight(cl) {
  const [cb0x, cb0y, cb1x, cb1y] = cl.bbox;
  const cbW = cb1x - cb0x;
  const cbH = cb1y - cb0y;
  const cbScale = cbScaleFor(cbW, cbH);
  const cbDrawH = cbH * cbScale;
  const glyphRows = Math.min(MAX_GLYPH_ROWS, cl.glyphMatches.filter((gm) => gm.top[0]).length);
  return Math.max(
    MIN_CLUSTER_H,
    CLUSTER_PAD * 2 + 22 + cbDrawH + 9 + glyphRows * GLYPH_ROW_H
  );
}

function drawCluster({ pageTop, y, cl }) {
  const absY = pageTop + y;
  const bx = MARGIN;
  const by = absY;
  const bw = COL_W;
  const bh = clusterBlockHeight(cl);

  const parts = [];
  parts.push(`<rect x="${fixed(bx)}" y="${fixed(by)}" width="${fixed(bw)}" height="${fixed(bh)}" fill="#fbfdfe" stroke="#d7dee8"/>`);

  // header line: cluster id + top label + votes
  const hx = bx + 8;
  const hy = by + 11;
  parts.push(`<text x="${fixed(hx)}" y="${fixed(hy)}" font-size="8.5" font-family="monospace" fill="#111827">cl ${esc(cl.index)}  top=${esc(cl.topLabel)}  votes ${esc(cl.topVotes)}/${esc(cl.glyphs)}  x${esc(round1(cl.x))} y${esc(round1(cl.y))} w${esc(round1(cl.width))}</text>`);

  // cluster boundary ink box (scaled small)
  const [cb0x, cb0y, cb1x, cb1y] = cl.bbox;
  const cbW = cb1x - cb0x;
  const cbH = cb1y - cb0y;
  const cbScale = cbScaleFor(cbW, cbH);
  const cbDrawW = cbW * cbScale;
  const cbDrawH = cbH * cbScale;
  const cbX = bx + 8;
  const cbY = by + 22;
  parts.push(`<rect x="${fixed(cbX)}" y="${fixed(cbY)}" width="${fixed(cbDrawW)}" height="${fixed(cbDrawH)}" fill="#ffffff" stroke="#94a3b8" stroke-width="1"/>`);
  parts.push(`<text x="${fixed(cbX)}" y="${fixed(cbY - 3)}" font-size="6.5" font-family="sans-serif" fill="#64748b">cluster boundary (ink bbox)</text>`);

  // glyph rows: nearest label + distance (capped)
  let gy = cbY + cbDrawH + 8;
  let shown = 0;
  for (const gm of cl.glyphMatches) {
    if (shown >= MAX_GLYPH_ROWS) break;
    const best = gm.top[0];
    if (!best) continue;
    parts.push(`<rect x="${fixed(bx + 8)}" y="${fixed(gy)}" width="${fixed(24)}" height="${fixed(GLYPH_ROW_H - 2)}" fill="#f8fbff" stroke="#e5e7eb"/>`);
    parts.push(`<text x="${fixed(bx + 10)}" y="${fixed(gy + 7)}" font-size="7" font-family="monospace" fill="#334155">${esc(best.label)}</text>`);
    parts.push(`<text x="${fixed(bx + 36)}" y="${fixed(gy + 7)}" font-size="7" font-family="monospace" fill="#64748b">d${esc(best.dist)}</text>`);
    gy += GLYPH_ROW_H;
    shown += 1;
  }

  return { fits: true, nextY: by + bh + 10, parts };
}

const reports = loadReports(inputs);

// Flatten all clusters grouped by line, then interleave round-robin so every
// line is represented across the 3 pages instead of only the first lines.
const byLine = new Map();
for (const rep of reports) {
  for (const lineRes of rep.lines) {
    const key = `line ${lineRes.line}`;
    if (!byLine.has(key)) byLine.set(key, []);
    for (const cl of lineRes.clusters) {
      byLine.get(key).push({ ...cl, line: lineRes.line, sourceFile: rep.file });
    }
  }
}
const lineKeys = [...byLine.keys()].sort((a, b) => {
  const na = Number(a.split(" ")[1]);
  const nb = Number(b.split(" ")[1]);
  return na - nb;
});
const allClusters = [];
let done = false;
let round = 0;
while (!done) {
  done = true;
  for (const key of lineKeys) {
    const arr = byLine.get(key);
    if (round < arr.length) {
      allClusters.push(arr[round]);
      done = false;
    }
  }
  round += 1;
}

// Layout across 3 A4 pages stacked vertically.
const pages = [[], [], []];
let pageIdx = 0;
let cursorY = PAGE_HEADER_H;
for (const cl of allClusters) {
  const bh = clusterBlockHeight(cl);
  if (cursorY + bh > A4_H - 8) {
    pageIdx += 1;
    cursorY = PAGE_HEADER_H;
    if (pageIdx >= PAGES) break;
  }
  pages[pageIdx].push({ ...cl, y: cursorY });
  cursorY += bh + 10;
}

const usedPages = pages.filter((p) => p.length > 0).length;
const totalClusters = pages.reduce((s, p) => s + p.length, 0);
const totalAvailable = allClusters.length;

// Draw everything.
const bodyParts = [];
for (let p = 0; p < PAGES; p += 1) {
  const py = p * A4_H;
  bodyParts.push(`<rect x="${fixed(MARGIN - 2)}" y="${fixed(py + MARGIN - 2)}" width="${fixed(COL_W + 4)}" height="${fixed(A4_H - 2 * MARGIN + 4)}" fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4,4"/>`);
  bodyParts.push(`<text x="${fixed(MARGIN)}" y="${fixed(py + MARGIN + 15)}" font-size="9.5" font-family="sans-serif" fill="#64748b">A4 page ${esc(p + 1)} — cluster matches (original PDF line vs compare sheet)</text>`);
  bodyParts.push(`<text x="${fixed(MARGIN)}" y="${fixed(py + MARGIN + 28)}" font-size="7" font-family="sans-serif" fill="#94a3b8">595.28 × 841.89 pt · stacked vertically, not side by side · cluster = ink bounded-box boundary · no parser text · no ToUnicode · no rasterization</text>`);

  for (const item of pages[p]) {
    const res = drawCluster({ pageTop: py, y: item.y, cl: item });
    bodyParts.push(...res.parts);
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fixed(CANVAS_W)}" height="${fixed(CANVAS_H)}" viewBox="0 0 ${fixed(CANVAS_W)} ${fixed(CANVAS_H)}">
  <rect width="${fixed(CANVAS_W)}" height="${fixed(CANVAS_H)}" fill="#ffffff"/>
  <text x="${fixed(MARGIN)}" y="${fixed(12)}" font-size="12" font-family="sans-serif" fill="#111827">Cluster-level sheet — original PDF line vs Pyidaungsu/Padauk compare sheet</text>
  <text x="${fixed(MARGIN)}" y="${fixed(26)}" font-size="8.5" font-family="sans-serif" fill="#475569">3 vertical A4 pages stacked inside one SVG · cluster = bounded-box boundary · glyphs matched by contour Chamfer (aspect-ratio preserved)</text>
  <text x="${fixed(MARGIN)}" y="${fixed(40)}" font-size="8" font-family="sans-serif" fill="#64748b">source: ${esc(inputs.join(", "))} · ${totalClusters}/${esc(totalAvailable)} clusters shown across ${usedPages} page(s) (rest in cluster-report.json)</text>
  ${bodyParts.join("")}
</svg>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, svg);

console.log(`wrote ${out}`);
console.log(`canvas ${fixed(CANVAS_W)} × ${fixed(CANVAS_H)} pt (3 × A4 stacked vertically)`);
console.log(`pages used: ${usedPages}/${PAGES}; clusters shown: ${totalClusters}/${totalAvailable}`);
for (let p = 0; p < PAGES; p += 1) console.log(`  page ${p + 1}: ${pages[p].length} clusters`);
