// convert-index-horizontal-to-vertical.js
//
// Converts an index SVG from "3 A4 panels side by side horizontally"
// (canvas 1785.83 × 841.89) into "3 vertical A4 pages stacked"
// (canvas 595.28 × 2525.67), preserving ALL structure:
//   - shared <defs> block (unchanged)
//   - <g id="lines"> grid rectangles (rebased per page)
//   - entry <g> groups with <use> (rebased per page)
//   - <g id="bounded"> rule lines (rebased per page)
//   - <g id="baselinegroup"> baseline lines (rebased per page)
//   - title, metadata, all data-* attributes (updated)
//
// Usage:
//   node B.Parser/main/parser/svg/convert-index-horizontal-to-vertical.js <input.svg> [--out <output.svg>]

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let input = null;
let out = null;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--out") out = args[++i];
  else if (!input) input = a;
  else throw new Error("usage: node convert-index-horizontal-to-vertical.js <input.svg> [--out <output.svg>]");
}
if (!input) throw new Error("input svg required");
if (!out) out = input; // overwrite in place by default

const A4_W = 595.28;
const A4_H = 841.89;
const PAGES = 3;
const CANVAS_W = A4_W;
const CANVAS_H = A4_H * PAGES;

// Panel x-offsets, read from the <g id="lines"> first rect of each panel.
// Panel 1 starts at x=0, panel 2 at x=595.28, panel 3 at x=1190.55.
const PANEL_X_OFFSETS = [0, A4_W, 1190.55];

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fixed = (v) => Math.round(v * 100) / 100;

const svg = fs.readFileSync(input, "utf8");

// ------------------------------------------------------------------
// Determine which panel an x-coordinate belongs to.
// ------------------------------------------------------------------
function panelFor(x) {
  if (x < PANEL_X_OFFSETS[1]) return 0;        // [0, 595.28)
  if (x < PANEL_X_OFFSETS[2]) return 1;        // [595.28, 1190.55)
  return 2;                                     // [1190.55, 1785.83]
}

// ------------------------------------------------------------------
// Rebase a single numeric coordinate: x -> x - panelOffset, y -> y + page * A4_H
// ------------------------------------------------------------------
function rebaseX(x, panel) {
  return fixed(x - PANEL_X_OFFSETS[panel]);
}
function rebaseY(y, panel) {
  return fixed(y + panel * A4_H);
}

// ------------------------------------------------------------------
// Rebase all x/y attributes within a block of SVG text for a given panel.
// Handles: x=".." y=".." x1=".." y1=".." x2=".." y2=".." data-x=".." data-baseline=".."
// ------------------------------------------------------------------
function rebaseBlock(block, panel) {
  return block.replace(
    /\b(x|y|x1|y1|x2|y2|data-x|data-baseline)="(-?\d+(?:\.\d+)?)"/g,
    (_, attr, val) => {
      const n = Number(val);
      let rebased;
      if (attr === "data-baseline" || attr === "y" || attr === "y1" || attr === "y2") {
        rebased = rebaseY(n, panel);
      } else {
        rebased = rebaseX(n, panel);
      }
      return `${attr}="${rebased}"`;
    }
  );
}

// ------------------------------------------------------------------
// Split the SVG into its top-level sections.
// ------------------------------------------------------------------

// Opening <svg> tag
const svgOpenMatch = svg.match(/<svg\b[^>]*>/);
if (!svgOpenMatch) throw new Error("no <svg> opening tag found");
const svgOpen = svgOpenMatch[0];

// Extract defs block
const defsStart = svg.indexOf("<defs>");
const defsEnd = svg.indexOf("</defs>");
if (defsStart === -1 || defsEnd === -1) throw new Error("no <defs> block found");
const defsBlock = svg.slice(defsStart, defsEnd + 7); // include </defs>

// Extract <g id="lines">...</g>
const linesStart = svg.indexOf('<g id="lines"');
const linesEnd = svg.indexOf("</g>", linesStart);
if (linesStart === -1 || linesEnd === -1) throw new Error("no <g id=\"lines\"> block found");
const linesBlock = svg.slice(linesStart, linesEnd + 4);

// Extract entry groups: everything between </defs> and <g id="bounded">
// Entry groups look like: <g id="..." data-kind="..." ...><use .../></g>
const boundedStart = svg.indexOf('<g id="bounded"');
const baselineStart = svg.indexOf('<g id="baselinegroup"');
if (boundedStart === -1 || baselineStart === -1) {
  throw new Error("no <g id=\"bounded\"> or <g id=\"baselinegroup\"> block found");
}
const entriesBlock = svg.slice(defsEnd + 7, boundedStart);

// Extract <g id="bounded">...</g>
const boundedEnd = svg.indexOf("</g>", boundedStart);
const boundedBlock = svg.slice(boundedStart, boundedEnd + 4);

// Extract <g id="baselinegroup">...</g>
const baselineEnd = svg.indexOf("</g>", baselineStart);
const baselineBlock = svg.slice(baselineStart, baselineEnd + 4);

// Closing tag
const closeMatch = svg.match(/<\/svg>\s*$/);
const svgClose = closeMatch ? closeMatch[0] : "</svg>";

// ------------------------------------------------------------------
// Process each section: split by panel and rebase coordinates.
// ------------------------------------------------------------------

function splitAndRebaseByPanel(block) {
  // For lines/entries/rules/baselines, we need to split elements by panel.
  // Each panel's elements have x coordinates in that panel's range.
  // We process each element individually.
  
  const panels = [[], [], []];
  
  // Split into individual elements. Elements can be:
  //   <rect .../>  (self-closing, in lines)
  //   <line .../>  (self-closing, in rules/baselines)
  //   <g ...><use .../></g>  (entry groups, may span multiple lines but on one line here)
  //   <g ...>...</g>  (multi-line entry groups? unlikely in this format)
  
  // For <rect> and <line> elements (self-closing):
  const selfClosingRe = /<(rect|line)\b[^>]*\/>/g;
  let m;
  while ((m = selfClosingRe.exec(block)) !== null) {
    const el = m[0];
    // Find x or x1 attribute to determine panel
    const xMatch = el.match(/\b(x|x1|data-x)="(-?\d+(?:\.\d+)?)"/);
    const x = xMatch ? Number(xMatch[2]) : 0;
    const panel = panelFor(x);
    const rebased = rebaseBlock(el, panel);
    panels[panel].push(rebased);
  }
  
  // For <g>...</g> entry groups (may contain <use>):
  const groupRe = /<g\b[^>]*>(?:<use\b[^>]*\/>)<\/g>/g;
  while ((m = groupRe.exec(block)) !== null) {
    const el = m[0];
    // Use the use element's x attribute, or the group's data-x
    const useMatch = el.match(/\buse[^>]*?\bx="(-?\d+(?:\.\d+)?)"/);
    const groupXMatch = el.match(/\bdata-x="(-?\d+(?:\.\d+)?)"/);
    const x = useMatch ? Number(useMatch[1]) : (groupXMatch ? Number(groupXMatch[1]) : 0);
    const panel = panelFor(x);
    const rebased = rebaseBlock(el, panel);
    panels[panel].push(rebased);
  }
  
  return panels.map((p) => p.join(""));
}

// Process each block
const linesPanels = splitAndRebaseByPanel(linesBlock);
const entriesPanels = splitAndRebaseByPanel(entriesBlock);
const boundedPanels = splitAndRebaseByPanel(boundedBlock);
const baselinePanels = splitAndRebaseByPanel(baselineBlock);

// Count uses preserved
const useCount = (entriesBlock.match(/<use\b/g) || []).length;
console.log(`uses in entries block: ${useCount}`);

// ------------------------------------------------------------------
// Update the opening <svg> tag attributes.
// ------------------------------------------------------------------
let newSvgOpen = svgOpen
  .replace(/width="[\d.]+"/, `width="${fixed(CANVAS_W)}"`)
  .replace(/height="[\d.]+"/, `height="${fixed(CANVAS_H)}"`)
  .replace(/viewBox="[\d. ]+"/, `viewBox="0 0 ${fixed(CANVAS_W)} ${fixed(CANVAS_H)}"`)
  .replace(/data-layout="[^"]*"/, `data-layout="vertical-a4-pages"`)
  .replace(/data-panels="[^"]*"/, `data-panels="${PAGES}"`)
  .replace(/data-pages="[^"]*"/, `data-pages="${PAGES}"`)
  .replace(/data-panel-width="[^"]*"/, `data-panel-width="${fixed(A4_W)}"`)
  .replace(/data-panel-height="[^"]*"/, `data-panel-height="${fixed(A4_H)}"`);

// If data-panel-height doesn't exist, add it
if (!/data-panel-height=/.test(newSvgOpen)) {
  newSvgOpen = newSvgOpen.replace(/ data-pages="\d+"/, `$& data-panel-height="${fixed(A4_H)}"`);
}

// ------------------------------------------------------------------
// Reassemble the SVG.
// ------------------------------------------------------------------
const newSvg = [
  newSvgOpen,
  // title and metadata: extract from original between </svg-open> and <g id="lines">
  svg.slice(svgOpen.length, linesStart),
  "<g id=\"lines\">\n",
  linesPanels.map((p, i) => `  <!-- page ${i + 1} -->\n${p}`).join(""),
  "</g>\n",
  defsBlock,
  "\n",
  entriesPanels.map((p, i) => `  <!-- page ${i + 1} entries -->\n${p}`).join(""),
  "\n",
  "<g id=\"bounded\">\n",
  boundedPanels.map((p, i) => `  <!-- page ${i + 1} -->\n${p}`).join(""),
  "</g>\n",
  "<g id=\"baselinegroup\">\n",
  baselinePanels.map((p, i) => `  <!-- page ${i + 1} -->\n${p}`).join(""),
  "</g>\n",
  svgClose,
  "\n",
].join("");

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, newSvg);
console.log(`wrote ${out}`);
console.log(`canvas ${fixed(CANVAS_W)} × ${fixed(CANVAS_H)} pt (3 × A4 stacked vertically)`);
console.log(`uses preserved: ${useCount}`);
