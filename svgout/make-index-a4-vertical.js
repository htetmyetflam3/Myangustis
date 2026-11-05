// make-index-a4-vertical.js — convert your horizontal 3×A4 index sheet into
// ONE SVG with 3 vertical A4 pages stacked (canvas 595.28 × 2525.67 pt),
// NOT side by side.
//
// Each horizontal page strip (595.28 wide × 841.89 tall) becomes one vertical
// page: x re-based to 0–595.28, y offset by page index × 841.89.
// One shared <defs> block; bg (Padauk) uses drawn before overlay (Pyidaungsu)
// uses within each page to preserve layering.
//
//   node svgout/make-index-a4-vertical.js \
//     B.Parser/main/parser/jason-map/vector/index-font11-burmese-pali-compare-pyidaungsu-padauk.svg \
//     --out svgout/original/index-font11-burmese-pali-compare-a4-vertical-3page.svg

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let input = null;
let out = "svgout/original/index-font11-burmese-pali-compare-a4-vertical-3page.svg";
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--out") out = args[++i];
  else if (!input) input = a;
  else throw new Error("usage: node make-index-a4-vertical.js <index.svg> [--out <out.svg>]");
}

const A4_W = 595.28;
const A4_H = 841.89;
const PAGES = 3;
const CANVAS_W = A4_W;
const CANVAS_H = A4_H * PAGES;

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fixed = (v) => Math.round(v * 100) / 100;

const svg = fs.readFileSync(input, "utf8");

// --- parse defs ---
const defs = new Map();
for (const m of svg.matchAll(/<path\s+id="([^"]+)"\s+d="([^"]+)"\s*\/?>/g)) {
  defs.set(m[1], m[2]);
}

// --- parse ALL uses from the whole SVG (order-independent attributes) ---
const useRe = /<use\s+([^>]*?)\s*\/?>/g;
const attrRe = /(href|x|y)="([^"]*)"/g;
const allUses = [];
for (const m of svg.matchAll(useRe)) {
  const attrs = m[1];
  const found = {};
  let am;
  while ((am = attrRe.exec(attrs)) !== null) {
    found[am[1]] = am[2];
  }
  if (!found.href || found.x === undefined || found.y === undefined) continue;
  allUses.push({
    href: found.href,
    x: Number(found.x),
    y: Number(found.y),
    isBg: String(found.href).startsWith("bg-"),
  });
}

// --- assign each use to a horizontal page by x, convert to vertical ---
// page p: x in [p*A4_W, (p+1)*A4_W) -> vertical: x'=x-p*A4_W, y'=y+p*A4_H
const pages = [[], [], []];
for (const u of allUses) {
  let p = Math.floor(u.x / A4_W);
  if (p < 0) p = 0;
  if (p >= PAGES) p = PAGES - 1;
  const lo = p * A4_W;
  const hi = (p + 1) * A4_W;
  if (u.x < lo || u.x >= hi) continue;
  pages[p].push({
    x: u.x - lo,
    y: u.y + p * A4_H,
    href: u.href,
    isBg: u.isBg,
  });
}

// within each page: bg uses first, then overlay uses, then sort by y then x
for (const pg of pages) {
  pg.sort((a, b) => {
    if (a.isBg !== b.isBg) return a.isBg ? -1 : 1;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
}

const counts = pages.map((pg) => pg.length);
console.log(`defs: ${defs.size}; total uses: ${allUses.length}`);
console.log(`uses per page (vertical): page1=${counts[0]} page2=${counts[1]} page3=${counts[2]} total=${counts.reduce((a, b) => a + b, 0)}`);

// --- emit one SVG, 3 vertical A4 pages stacked ---
const defsXml = [...defs.entries()]
  .map(([id, d]) => `<path id="${esc(id)}" d="${esc(d)}"/>`)
  .join("");

const pageBlocks = [];
for (let p = 0; p < PAGES; p += 1) {
  const py = p * A4_H;
  pageBlocks.push(
    `<rect x="${fixed(1)}" y="${fixed(py + 1)}" width="${fixed(A4_W - 2)}" height="${fixed(A4_H - 2)}" fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4,4"/>`
  );
  pageBlocks.push(
    `<text x="${fixed(10)}" y="${fixed(py + 16)}" font-size="10" font-family="sans-serif" fill="#64748b">A4 page ${p + 1} · ${fixed(A4_W)} × ${fixed(A4_H)} pt · stacked vertically</text>`
  );
  for (const u of pages[p]) {
    pageBlocks.push(
      `<use href="${esc(u.href)}" x="${fixed(u.x)}" y="${fixed(u.y)}"/>`
    );
  }
}

const svgOut = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${fixed(CANVAS_W)}" height="${fixed(CANVAS_H)}"
     viewBox="0 0 ${fixed(CANVAS_W)} ${fixed(CANVAS_H)}"
     data-layout="vertical-a4-pages" data-pages="${PAGES}" data-page-width="${fixed(A4_W)}" data-page-height="${fixed(A4_H)}">
  <rect width="${fixed(CANVAS_W)}" height="${fixed(CANVAS_H)}" fill="#ffffff"/>
  <text x="10" y="18" font-size="13" font-family="sans-serif" fill="#111827">Your index sheet — 3 vertical A4 pages stacked (not side by side)</text>
  <text x="10" y="34" font-size="9" font-family="sans-serif" fill="#475569">source: ${esc(path.basename(input))} · 254 shared defs · Padauk bg drawn before Pyidaungsu overlay per page</text>
  <defs>${defsXml}</defs>
  ${pageBlocks.join("")}
</svg>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, svgOut);
console.log(`wrote ${out}`);
console.log(`canvas ${fixed(CANVAS_W)} × ${fixed(CANVAS_H)} pt (3 × A4 stacked vertically)`);
