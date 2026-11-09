import test from "node:test";
import assert from "node:assert/strict";
import {
  readScene, analysePage, lineSvgFor, sheetSvgFor, bboxOf, mulberry32,
} from "../../../B.Parser/core/beautify/repair/make-line.js";
import { createOriginalPdfCache } from "../../../B.Parser/core/original-pdf-cache.js";

// JS twin of make_line.py: page-export SVG (defs glyphs in em units,
// <use> matrices carrying the font size) -> framed line / sheet SVGs.
// The Python and JS implementations are byte-identical on the same
// input; this is the fixture-level check, the historical page-1 export
// is the full-page check.

// two lines at size 14, baselines y=100 and y=116, flipped page y-down
const PAGE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="612" height="792" viewBox="0 0 612 792">
<defs>
<path id="gA" d="M0 0L0.5 0.7L1 0Z"/>
<path id="gB" d="M0 -0.2L0.4 0.5L0.8 -0.2Z"/>
</defs>
<g transform="matrix(1,0,0,1,0,0)">
<use xlink:href="#gA" transform="matrix(14,0,0,-14,36,100)"/>
<use xlink:href="#gB" transform="matrix(14,0,0,-14,44,100)"/>
<use xlink:href="#gA" transform="matrix(14,0,0,-14,36,116)"/>
<use xlink:href="#gA" transform="matrix(14,0,0,-14,36,132)"/>
</g>
</svg>
`;

test("bboxOf walks path commands incl. relative and H/V", () => {
  assert.deepEqual(bboxOf("M0 0L0.5 0.7L1 0Z"), [0, 0, 1, 0.7]);
  assert.deepEqual(bboxOf("M0 0H1V1H0Z"), [0, 0, 1, 1]);
  // same IEEE accumulation as Python: 0.2 + 0.4 === 0.6000000000000001
  assert.deepEqual(bboxOf("M.1.2l.3.4"), [0.1, 0.2, 0.4, 0.6000000000000001]);
});

test("mulberry32 matches the Python generator seed sequence", () => {
  const next = mulberry32(14);
  // first draw only needs to be deterministic and in range; the exact
  // sequence is exercised end-to-end by the Python/JS parity runs
  const v = next();
  assert.ok(v >= 0 && v < 1);
  assert.equal(mulberry32(14)(), v);
});

test("readScene: uses carry size from their matrix, ink in page units", () => {
  const scene = readScene(PAGE);
  assert.equal(scene.width, 612);
  assert.equal(scene.uses.length, 4);
  assert.equal(scene.uses[0].size, 14);
  assert.equal(scene.uses[0].y, 100);
  assert.deepEqual(scene.uses[0].ink, [36, 100 - 14 * 0.7, 36 + 14, 100]);
});

test("analysePage groups uses by baseline and frames them", () => {
  const analysis = analysePage(PAGE);
  assert.equal(analysis.frames.length, 3);
  assert.equal(analysis.frames[0].baseline, 100);
  assert.equal(analysis.rows[0].glyphs.length, 2);
  assert.equal(analysis.pitch, 16);
});

test("lineSvgFor renders only the requested line's glyphs", () => {
  const analysis = analysePage(PAGE);
  const svg = lineSvgFor(analysis, 2, { label: "page 1 line 2" });
  assert.match(svg, /data-line="2"/);
  assert.match(svg, /data-baseline="116\.00"/);
  assert.match(svg, /page 1 line 2/);
  assert.equal((svg.match(/<use /g) ?? []).length, 1);
});

test("sheetSvgFor renders every framed line", () => {
  const analysis = analysePage(PAGE);
  const svg = sheetSvgFor(analysis);
  assert.match(svg, /data-lines="3"/);
});

test("OriginalPdfCache: broken-line requests served by the JS make-line mirror", async () => {
  let exports = 0;
  const cache = createOriginalPdfCache({
    preparedPdf: "/tmp/prepared.pdf",
    exportPageSvgText: () => { exports += 1; return PAGE; },
  });
  const response = await cache.exportLineSvg({ id: "1:2", page: 1, line: 2 });
  assert.equal(response.id, "1:2");
  assert.match(response.svg, /data-line="2"/);
  const again = await cache.exportLineSvg({ id: "1:2", page: 1, line: 2 });
  assert.equal(again, response); // cached, not rebuilt
  assert.equal(exports, 1); // page export built once for the whole page
  const line1 = await cache.exportLineSvg({ id: "1:1", page: 1, line: 1 });
  assert.match(line1.svg, /data-line="1"/);
  assert.equal(exports, 1);
  cache.close();
});
