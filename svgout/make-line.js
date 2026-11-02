// make-line.js — vectorize ONE random line from the original page and emit it
// as a standalone page-width SVG, plus the full sheet it can be overlaid on.
//
// Input is the page exported from the ORIGINAL content stream
// (pdf2svg.py reads the page operators, not the parser's text), so every
// outline below is the page's own artwork.
//
//   node svgout/make-line.js svgout/representative-p14.svg
import fs from "node:fs";
import { frameOf, framesOf, pitchOf, blankOf, overflow, lineSvg, sheetSvg } from "./scan-frame.js";

const SRC = process.argv[2] ?? "svgout/representative-p14.svg";
const SIZE = 12.96;                     // page 14, one size throughout
const TOL = SIZE * 0.9;                 // baseline grouping, < one line
const SEED = Number(process.argv[3] ?? 14);
const SUFFIX = process.argv[4] ?? "";
const ONLY = process.argv[5] ?? "";   // e.g. "1-8" or "1,3,5"; empty = every line

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

const svg = fs.readFileSync(SRC, "utf8");
const W = Number(/width="([\d.]+)"/.exec(svg)[1]);

// ---- defs: glyph outlines, straight out of the page ---------------------
const defs = {};
for (const m of svg.matchAll(/<path id="([^"]+)" d="([^"]*)"/g)) defs[m[1]] = m[2];

// ---- ink bbox of a glyph, in em units, from its own path ----------------
const bboxCache = new Map();
const ARITY = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
const NUM = /[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

// Glyph bbox in em units, walked command by command. H and V take one number,
// so a naive "numbers come in pairs" scan desyncs and invents ink. Control
// points are included, which makes the box a superset: the fit check can only
// ever be pessimistic, never optimistic.
function bboxOf(d) {
  if (bboxCache.has(d)) return bboxCache.get(d);
  const tok = d.match(NUM) ?? [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const note = (px, py) => {
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  };
  let cmd = null;
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) { cmd = tok[i]; i += 1; }
    if (cmd === null || i >= tok.length) continue;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { x = sx; y = sy; continue; }
    const n = ARITY[C];
    if (n === undefined) { i += 1; continue; }
    if (i + n > tok.length || /[A-Za-z]/.test(tok[i])) continue;   // no args yet
    const v = [];
    for (let k = 0; k < n; k += 1) v.push(Number(tok[i + k]));
    i += n;
    const ox = x, oy = y;
    if (C === 'H') { x = rel ? x + v[0] : v[0]; note(x, y); }
    else if (C === 'V') { y = rel ? y + v[0] : v[0]; note(x, y); }
    else if (C === 'M') {
      x = rel ? x + v[0] : v[0]; y = rel ? y + v[1] : v[1];
      sx = x; sy = y; note(x, y); cmd = rel ? 'l' : 'L';
    } else if (C === 'L' || C === 'T') {
      x = rel ? x + v[0] : v[0]; y = rel ? y + v[1] : v[1]; note(x, y);
    } else if (C === 'C') {
      for (let k = 0; k < 6; k += 2) note(rel ? ox + v[k] : v[k], rel ? oy + v[k + 1] : v[k + 1]);
      x = rel ? ox + v[4] : v[4]; y = rel ? oy + v[5] : v[5];
    } else if (C === 'S' || C === 'Q') {
      for (let k = 0; k < 4; k += 2) note(rel ? ox + v[k] : v[k], rel ? oy + v[k + 1] : v[k + 1]);
      x = rel ? ox + v[2] : v[2]; y = rel ? oy + v[3] : v[3];
    } else if (C === 'A') {
      x = rel ? ox + v[5] : v[5]; y = rel ? oy + v[6] : v[6]; note(x, y);
    }
  }
  const r = x0 === Infinity ? null : [x0, y0, x1, y1];
  bboxCache.set(d, r);
  return r;
}

// ---- every glyph the page draws, with its baseline ----------------------
const uses = [];
const seen = new Set();
for (const m of svg.matchAll(/<use\b[^>]*\/>/g)) {
  const tag = m[0];
  const href = /(?:xlink:)?href="#([^"]+)"/.exec(tag);
  const mat = /transform="matrix\(([^)]+)\)"/.exec(tag);
  if (!href || !mat) continue;
  const [a, b, c, d, e, f] = mat[1].split(",").map(Number);
  // the page draws each glyph twice: once filled, once stroked. Keep one.
  const key = `${href[1]}:${e.toFixed(2)}:${f.toFixed(2)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const id = href[1];
  const bb = bboxOf(defs[id] ?? "");
  if (!bb) continue;
  const [bx0, by0, bx1, by1] = bb;
  // corners through the matrix -> page-space ink box
  const xs = [a * bx0 + c * by0 + e, a * bx1 + c * by0 + e, a * bx0 + c * by1 + e, a * bx1 + c * by1 + e];
  const ys = [b * bx0 + d * by0 + f, b * bx1 + d * by0 + f, b * bx0 + d * by1 + f, b * bx1 + d * by1 + f];
  const ink = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (ink[2] - ink[0] < 0.01 && ink[3] - ink[1] < 0.01) continue;   // space ghost
  uses.push({ href: id, x: e, y: f, ink, raw: tag });
}

// ---- rows, from the PDF's own baselines ---------------------------------
const buckets = new Map();
for (const u of uses) {
  let key = null;
  for (const k of buckets.keys()) if (Math.abs(k - u.y) <= TOL) { key = k; break; }
  if (key === null) { key = u.y; buckets.set(key, []); }
  buckets.get(key).push(u);
}
const lines = [...buckets.entries()]
  .sort((p, q) => p[0] - q[0])
  .map(([y, g]) => {
    const tally = new Map();
    for (const u of g) { const k = +u.y.toFixed(2); tally.set(k, (tally.get(k) ?? 0) + 1); }
    const base = [...tally.entries()].sort((p, q) => q[1] - p[1])[0][0];
    return [Math.min(...g.map((u) => u.ink[0])), base, SIZE, ""];
  });

const frames = framesOf(lines);
const pitch = pitchOf(frames);

// ---- one line, picked at random ----------------------------------------
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry(SEED);
const pick = 1 + Math.floor(rnd() * frames.length);
const frame = frames[pick - 1];
const rowsUses = (y) => uses.filter((u) => Math.abs(u.y - y) <= TOL);
const lineUses = rowsUses(frame.baseline);

console.log(`page width ${W}   ${uses.length} glyphs   ${frames.length} lines`);
console.log(`pitch ${pitch}   slot ${frame.slot.toFixed(2)}   blank ${blankOf(frame, pitch).toFixed(2)}`);
console.log(`E ${frame.E.toFixed(2)}  rules ${[frame.r1, frame.r2, frame.r3, frame.r4].map((v) => v.toFixed(2)).join(" / ")}`);
console.log(`random line ${pick} of ${frames.length}   baseline ${frame.baseline.toFixed(2)}   ${lineUses.length} glyphs`);

// fit check from the page's own ink, no font file
let bad = 0;
for (const f of frames) {
  const o = overflow(f, rowsUses(f.baseline));
  if (!o.ok) { bad += 1; console.log(`  ! line ${f.index} ink ${o.above.toFixed(2)} above / ${o.below.toFixed(2)} below`); }
}
console.log(`fit: ${frames.length - bad}/${frames.length} lines inside the rules`);

// ---- emit --------------------------------------------------------------
fs.writeFileSync(`svgout/known/line-sample${SUFFIX}.svg`,
  lineSvg({ width: W, frame, uses: lineUses, defs, pitch, label: `page 14 line ${pick}` }));

const keep = parseLines(ONLY, frames.length);
const selected = keep ? frames.filter((f) => keep.has(f.index)) : frames;
const all = selected.map((f) => ({ frame: f, uses: rowsUses(f.baseline) }));
fs.writeFileSync(`svgout/known/frame-sheet${SUFFIX}.svg`,
  sheetSvg({ width: W, rows: all, defs, pitch }));

console.log(`-> svgout/known/line-sample${SUFFIX}.svg`);
console.log(`-> svgout/known/frame-sheet${SUFFIX}.svg`);
