// cluster-match.js — cluster-level sheet matching, shape-only, no rasterization.
//
// Matches each original-PDF line (from export-original-lines.js) against the
// labelled Pyidaungsu/Padauk compare sheet at CLUSTER level:
//
//   - a cluster = consecutive glyphs on one baseline whose ink boxes touch or
//     nearly touch (bounded box is the cluster boundary, no base/mark split)
//   - every glyph in a cluster is matched to compare-sheet entries by contour
//     shape (vector Chamfer distance, aspect-ratio-preserving normalization)
//   - results are reported per cluster (bounded box boundary), never per
//     isolated mark, and never by rasterizing the page
//
//   node B.Parser/main/parser/svg/cluster-match.js \
//     ./original/representative-p61 \
//     B.Parser/main/parser/jason-map/vector/index-font11-burmese-pali-compare-pyidaungsu-padauk.svg \
//     --line 1 --outdir ./original/representative-p61-cluster

import fs from "node:fs";
import path from "node:path";
import { parsePathData } from "../shape/repair/svg/svg.js";

const args = process.argv.slice(2);
const opt = {
  originalDir: "./original/representative-p61",
  compareSvg:
    "B.Parser/main/parser/jason-map/vector/index-font11-burmese-pali-compare-pyidaungsu-padauk.svg",
  line: null,
  outdir: "./original/representative-p61-cluster",
  top: 3,
  xGapPt: 2.0,      // pt: x gap that starts a new cluster on the same baseline
  arTol: 0.30,      // accept compare entries whose aspect ratio is within this
  samples: 24,      // contour samples per glyph (speed/accuracy trade-off)
};
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--original-dir") opt.originalDir = args[++i];
  else if (a === "--compare") opt.compareSvg = args[++i];
  else if (a === "--line") opt.line = Number(args[++i]);
  else if (a === "--outdir") opt.outdir = args[++i];
  else if (a === "--top") opt.top = Number(args[++i]);
  else if (a === "--x-gap") opt.xGapPt = Number(args[++i]);
  else if (a === "--ar-tol") opt.arTol = Number(args[++i]);
  else if (a === "--samples") opt.samples = Number(args[++i]);
  else throw new Error(`unknown option ${a}`);
}

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const round3 = (v) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
// Vector contour sampling (no rasterization). Aspect ratio is preserved:
// shapes are translated to origin and scaled by HEIGHT only, so a tall thin
// mark stays tall and a wide mark stays wide (no squash to unit square).
// ---------------------------------------------------------------------------

function sampleContour(contour, n) {
  if (!contour || contour.length < 2) return [];
  let total = 0;
  const segs = [];
  for (let i = 0; i < contour.length; i += 1) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push([a, b, d]);
    total += d;
  }
  if (total <= 0) return [];
  const pts = [];
  let segT = 0;
  let segIdx = 0;
  for (let k = 0; k < n; k += 1) {
    const target = (total * k) / (n - 1);
    while (segIdx < segs.length && segT + segs[segIdx][2] < target - 1e-9) {
      segT += segs[segIdx][2];
      segIdx += 1;
    }
    if (segIdx >= segs.length) break;
    const [a, b, segLen] = segs[segIdx];
    const t = segLen <= 0 ? 0 : (target - segT) / segLen;
    pts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
  }
  return pts;
}

function normalizeByHeight(contours) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of contours) {
    for (const [x, y] of c) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { contours: [], scale: 1, ox: 0, oy: 0, ar: 0 };
  const w = maxX - minX;
  const h = maxY - minY;
  const scale = h || 1;
  const out = contours.map((c) => c.map(([x, y]) => [(x - minX) / scale, (y - minY) / scale]));
  return { contours: out, scale, ox: minX, oy: minY, ar: h > 0 ? w / h : 0 };
}

function chamfer(pa, pb) {
  let sumA = 0;
  for (const [xa, ya] of pa) {
    let best = Infinity;
    for (const [xb, yb] of pb) {
      const d = Math.hypot(xa - xb, ya - yb);
      if (d < best) best = d;
    }
    sumA += best;
  }
  let sumB = 0;
  for (const [xb, yb] of pb) {
    let best = Infinity;
    for (const [xa, ya] of pa) {
      const d = Math.hypot(xa - xb, ya - yb);
      if (d < best) best = d;
    }
    sumB += best;
  }
  return (sumA / pa.length + sumB / pb.length) / 2;
}

function shapeDistance(defA, defB, samples) {
  const ca = parsePathData(defA, 6);
  const cb = parsePathData(defB, 6);
  if (!ca.length || !cb.length) return null;
  const na = normalizeByHeight(ca);
  const nb = normalizeByHeight(cb);
  const pa = [];
  const pb = [];
  for (const c of na.contours) pa.push(...sampleContour(c, samples));
  for (const c of nb.contours) pb.push(...sampleContour(c, samples));
  if (!pa.length || !pb.length) return null;
  return chamfer(pa, pb);
}

// ---------------------------------------------------------------------------
// Parse original line SVG (page space).
// ---------------------------------------------------------------------------

function parseOriginalLine(file) {
  const svg = fs.readFileSync(file, "utf8");
  const defs = new Map();
  for (const m of svg.matchAll(/<path\s+id="([^"]+)"\s+d="([^"]+)"\s*\/>/g)) {
    defs.set(m[1], m[2]);
  }
  const glyphs = [];
  for (const m of svg.matchAll(
    /<use\s+xlink:href="#([^"]+)"\s+transform="matrix\(([^"]*)\)"\s*\/?>/g,
  )) {
    const [, href, mat] = m;
    const p = mat.split(",").map(Number);
    if (p.length !== 6 || p.some((v) => !Number.isFinite(v))) continue;
    const [a, b, c, d, e, f] = p;
    const def = defs.get(href);
    if (!def) continue;
    const contours = parsePathData(def, 6);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const contour of contours) {
      for (const [x, y] of contour) {
        const X = a * x + c * y + e;
        const Y = b * x + d * y + f;
        if (X < minX) minX = X;
        if (Y < minY) minY = Y;
        if (X > maxX) maxX = X;
        if (Y > maxY) maxY = Y;
      }
    }
    glyphs.push({
      href, def, matrix: p, x: e, y: f,
      ink: [minX, minY, maxX, maxY],
      contours,
    });
  }
  glyphs.sort((g1, g2) => g1.x - g2.x || g1.y - g2.y);
  return { defs, glyphs };
}

// Cluster glyphs on one line: same baseline (y within tolerance) and x gap
// below xGapPt -> same cluster. Bounded box is the cluster boundary.
function clusterGlyphs(glyphs, xGapPt) {
  const clusters = [];
  let cur = null;
  const yTol = 1.5;
  for (const g of glyphs) {
    if (!cur) { cur = { glyphs: [g] }; continue; }
    const last = cur.glyphs[cur.glyphs.length - 1];
    const sameBaseline = Math.abs(g.y - last.y) <= yTol;
    const gap = g.x - last.ink[2];
    if (sameBaseline && gap <= xGapPt) {
      cur.glyphs.push(g);
    } else {
      clusters.push(cur);
      cur = { glyphs: [g] };
    }
  }
  if (cur) clusters.push(cur);
  for (const cl of clusters) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const g of cl.glyphs) {
      if (g.ink[0] < minX) minX = g.ink[0];
      if (g.ink[1] < minY) minY = g.ink[1];
      if (g.ink[2] > maxX) maxX = g.ink[2];
      if (g.ink[3] > maxY) maxY = g.ink[3];
    }
    cl.bbox = [minX, minY, maxX, maxY];
    cl.x = minX;
    cl.y = cl.glyphs[0].y;
    cl.width = maxX - minX;
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Parse compare sheet (em units, labelled entries).
// ---------------------------------------------------------------------------

function parseCompareSheet(file) {
  const svg = fs.readFileSync(file, "utf8");
  const defs = new Map();
  for (const m of svg.matchAll(/<path\s+id="([^"]+)"\s+d="([^"]+)"\s*\/>/g)) {
    defs.set(m[1], m[2]);
  }
  const entries = [];
  for (const g of svg.matchAll(
    /<g\s+id="([^"]*)"\s+data-kind="([^"]*)"\s+data-cp="([^"]*)"\s+data-row="([^"]*)"\s+data-x="([^"]*)"\s+data-baseline="([^"]*)"\s*>([\s\S]*?)<\/g>/g,
  )) {
    const [, id, kind, cp, row, x, baseline, inner] = g;
    const use = /<use\s+href="#([^"]+)"\s+x="([^"]+)"\s+y="([^"]+)"/.exec(inner);
    if (!use) continue;
    const [, href, ux, uy] = use;
    const def = defs.get(href);
    if (!def) continue;
    entries.push({
      id, kind, cp, row: Number(row), x: Number(x), baseline: Number(baseline),
      useX: Number(ux), useY: Number(uy), href, def,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Match one line.
// ---------------------------------------------------------------------------

function matchLine(originalFile, compareEntries, top) {
  const { glyphs } = parseOriginalLine(originalFile);
  const clusters = clusterGlyphs(glyphs, opt.xGapPt);

  // Pre-normalize compare entries once: aspect-ratio-preserving, sampled pts.
  const prepared = compareEntries.map((e) => {
    const contours = parsePathData(e.def, 6);
    const norm = normalizeByHeight(contours);
    const pts = [];
    for (const c of norm.contours) pts.push(...sampleContour(c, opt.samples));
    return { ...e, pts, ar: norm.ar, pointCount: pts.length };
  });

  // Index compare entries by aspect-ratio bucket for fast prefilter.
  const clusterResults = [];
  for (const cl of clusters) {
    const glyphMatches = [];
    for (const g of cl.glyphs) {
      const gNorm = normalizeByHeight(g.contours);
      const gPts = [];
      for (const c of gNorm.contours) gPts.push(...sampleContour(c, opt.samples));
      const gAr = gNorm.ar;
      const scored = [];
      if (gPts.length) {
        for (const e of prepared) {
          if (!e.pts.length) continue;
          // Aspect-ratio prefilter: only compare glyphs with similar width/height.
          if (Math.abs(e.ar - gAr) > opt.arTol) continue;
          const dist = chamfer(gPts, e.pts);
          scored.push({ entry: e, dist });
        }
      }
      scored.sort((a, b) => a.dist - b.dist);
      glyphMatches.push({
        glyph: g.href,
        def: g.def,
        x: g.x, y: g.y, ink: g.ink,
        ar: round3(gAr),
        top: scored.slice(0, top).map(({ entry, dist }) => ({
          glyph: entry.id, label: entry.cp, kind: entry.kind,
          ar: round3(entry.ar), dist: round3(dist),
        })),
      });
    }

    // Cluster-level verdict: dominant matched reference label across the
    // cluster's glyphs. Every glyph counted equally — base and mark ignored.
    const votes = new Map();
    for (const gm of glyphMatches) {
      const best = gm.top[0];
      if (!best) continue;
      votes.set(best.label, (votes.get(best.label) ?? 0) + 1);
    }
    let topLabel = ""; let topVotes = 0;
    for (const [label, votes_] of votes) {
      if (votes_ > topVotes) { topVotes = votes_; topLabel = label; }
    }

    clusterResults.push({
      index: clusterResults.length + 1,
      bbox: cl.bbox.map(round3),
      x: round3(cl.x), y: round3(cl.y), width: round3(cl.width),
      glyphs: glyphMatches.length,
      topLabel, topVotes,
      glyphMatches,
    });
  }
  return { glyphs: glyphs.length, clusters: clusterResults };
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

const manifest = JSON.parse(
  fs.readFileSync(path.join(opt.originalDir, "manifest.json"), "utf8"),
);
const compareEntries = parseCompareSheet(opt.compareSvg);

const lineFiles = [];
const dirEntries = fs.readdirSync(opt.originalDir);
for (const name of dirEntries) {
  const m = /^line-(\d+)\.svg$/.exec(name);
  if (m) lineFiles.push({ line: Number(m[1]), file: path.join(opt.originalDir, name) });
}
lineFiles.sort((a, b) => a.line - b.line);
if (opt.line) {
  const hit = lineFiles.find((l) => l.line === opt.line);
  if (!hit) throw new Error(`line ${opt.line} not found`);
  lineFiles.length = 0;
  lineFiles.push(hit);
}

const allResults = [];
for (const lf of lineFiles) {
  const res = matchLine(lf.file, compareEntries, opt.top);
  allResults.push({ line: lf.line, file: lf.file, ...res });
}

fs.mkdirSync(opt.outdir, { recursive: true });

const report = {
  sourceOriginalDir: opt.originalDir,
  sourceCompareSvg: opt.compareSvg,
  evidence: "original PDF line glyphs vs labelled compare-sheet entries; cluster bounded boxes as boundaries; no parser text, no ToUnicode, no rasterization",
  xGapPt: opt.xGapPt, arTol: opt.arTol, samples: opt.samples,
  lines: allResults.map(({ file, ...r }) => r),
};
fs.writeFileSync(
  path.join(opt.outdir, "cluster-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

// Contact sheet: cluster boundary boxes + nearest labels + distances.
const blocks = [];
for (const lineRes of allResults) {
  let body = `<text x="12" y="18" font-size="11" font-family="sans-serif">line ${lineRes.line}</text>`;
  let cx = 12;
  let cy = 42;
  const rowH = 110;
  const colW = 270;
  for (const cl of lineRes.clusters) {
    const bx = cx;
    const by = cy;
    body += `<rect x="${bx}" y="${by}" width="${colW - 10}" height="${rowH}" fill="#fff" stroke="#d7dee8"/>`;
    body += `<text x="${bx + 6}" y="${by + 13}" font-size="9" font-family="monospace">cl ${cl.index} x${cl.x} y${cl.y} w${cl.width} g${cl.glyphs}</text>`;
    body += `<text x="${bx + 6}" y="${by + 26}" font-size="8" font-family="sans-serif">top: ${esc(cl.topLabel)} (v${cl.topVotes}/${cl.glyphs})</text>`;
    const [bx0, by0, bx1, by1] = cl.bbox;
    const cw = Math.max(40, (bx1 - bx0) * 2.2);
    const ch = Math.max(30, (by1 - by0) * 2.2);
    body += `<rect x="${bx + 6}" y="${by + 36}" width="${cw}" height="${ch}" fill="#fbfdfe" stroke="#94a3b8" stroke-width="1"/>`;
    body += `<text x="${bx + 6}" y="${by + 48}" font-size="7" font-family="sans-serif">cluster boundary (ink bbox)</text>`;
    let gx = bx + 6;
    let gy = by + 36 + ch + 6;
    for (const gm of cl.glyphMatches) {
      const best = gm.top[0];
      body += `<rect x="${gx}" y="${gy}" width="42" height="30" fill="#f8fbff" stroke="#e5e7eb"/>`;
      body += `<text x="${gx + 2}" y="${gy + 15}" font-size="6" font-family="monospace">x${gm.x.toFixed(0)} ar${gm.ar}</text>`;
      if (best) {
        body += `<text x="${gx + 2}" y="${gy + 27}" font-size="6" font-family="sans-serif">${esc(best.label)} d${best.dist}</text>`;
      } else {
        body += `<text x="${gx + 2}" y="${gy + 27}" font-size="6" font-family="sans-serif">(no ar match)</text>`;
      }
      gx += 48;
      if (gx - bx > colW - 50) { gx = bx + 6; gy += 44; }
    }
    cx += colW;
    if (cx + colW > 1200) { cx = 12; cy += rowH + 40; }
  }
  blocks.push(`<g>${body}</g>`);
}

const allDefs = new Map();
for (const lf of lineFiles) {
  const svg = fs.readFileSync(lf.file, "utf8");
  for (const m of svg.matchAll(/<path\s+id="([^"]+)"\s+d="([^"]+)"\s*\/>/g)) {
    allDefs.set(m[1], m[2]);
  }
}
const defXml = [...allDefs.entries()].map(([id, d]) => `<path id="${esc(id)}" d="${esc(d)}"/>`).join("");

const sheetPath = path.join(opt.outdir, "cluster-contact-sheet.svg");
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1240" height="2400" viewBox="0 0 1240 2400">
  <rect width="1240" height="2400" fill="#ffffff"/>
  <text x="12" y="26" font-size="14" font-family="sans-serif">Cluster-level match: original PDF line vs compare sheet (bounded-box clusters, no rasterization)</text>
  <text x="12" y="42" font-size="10" font-family="sans-serif">Cluster = bounded-box boundary (no base/mark split). Each glyph matched by contour Chamfer (aspect-ratio preserved); label+dist = nearest compare entry.</text>
  <defs>${defXml}</defs>
  ${blocks.join("")}
</svg>\n`;
fs.writeFileSync(sheetPath, sheet);

console.log(`lines matched: ${allResults.length}`);
let totalClusters = 0, totalGlyphs = 0, totalNoAr = 0;
for (const r of allResults) {
  totalClusters += r.clusters.length;
  totalGlyphs += r.glyphs;
  for (const cl of r.clusters) {
    for (const gm of cl.glyphMatches) if (!gm.top[0]) totalNoAr += 1;
  }
  console.log(`line ${r.line}: ${r.clusters.length} clusters, ${r.glyphs} glyphs`);
}
console.log(`total clusters: ${totalClusters}; total glyphs: ${totalGlyphs}; no aspect-ratio match: ${totalNoAr}`);
console.log(`-> ${sheetPath}`);
console.log(`-> ${path.join(opt.outdir, "cluster-report.json")}`);
