import test from "node:test";
import assert from "node:assert/strict";
import {
  fixed, num, jsRound, frameOf, framesOf, pitchOf, blankOf, overflow,
  bandFor, lineSvg, sheetSvg,
} from "../../../B.Parser/core/beautify/repair/scan-frame.js";

// JS twin of make_line.py's Python partner (scan_frame.py). The parity
// contract is fixed()/num(): standard formatters disagree between the
// languages ((2.5).toFixed(0)==="3" vs f"{2.5:.0f}"==="2"), so these are
// pinned and shared by both implementations.

test("fixed: half away from zero, JS/Python byte parity", () => {
  assert.equal(fixed(2.5, 0), "3.0"); // Python fixed(2.5, 0) === "3.0"
  assert.equal(fixed(0.125), "0.13");
  assert.equal(fixed(-2.5, 0), "-3.0");
  assert.equal(fixed(0), "0.00");
  assert.equal(fixed(12.3, 3), "12.300");
  assert.equal(fixed(-0.001), "0.00");
});

test("num: integral floats drop the decimal part", () => {
  assert.equal(num(12.0), "12");
  assert.equal(num(12.5), "12.5");
  assert.equal(num(14), "14");
});

test("jsRound: halves go towards +inf, like Python's guarded driver", () => {
  assert.equal(jsRound(2.5), 3);
  assert.equal(jsRound(-2.5), -2);
  assert.equal(jsRound(16.004), 16);
});

test("frameOf: four rules at b-2E, b-E, b, b+E with E = size/2", () => {
  const f = frameOf(100, 14);
  assert.equal(f.E, 7);
  assert.deepEqual([f.r1, f.r2, f.r3, f.r4], [86, 93, 100, 107]);
  assert.equal(f.slot, 21);
});

test("framesOf + modal pitch + blank", () => {
  const frames = framesOf([
    [10, 100, 14, "a"], [10, 116, 14, "b"], [10, 132, 14, "c"], [10, 133, 14, "d"],
  ]);
  assert.equal(frames.length, 4);
  assert.equal(frames[1].index, 2);
  assert.equal(pitchOf(frames), 16);
  assert.equal(blankOf(frames[0], 16), 16 - 21);
  // a single real gap is not a pitch
  assert.equal(pitchOf(frames.slice(0, 2)), 0);
});

test("lineSvg: framed line with pinned number formatting", () => {
  const frame = { ...frameOf(100, 14), index: 3 };
  const uses = [{ href: "g1", raw: '<use xlink:href="#g1"/>', x: 0, y: 100, ink: [0, 95, 5, 101] }];
  const svg = lineSvg(612, frame, uses, { g1: "M0 0L1 1Z" });
  assert.match(svg, /data-line="3"/);
  assert.match(svg, /data-baseline="100\.00"/);
  assert.match(svg, /data-rules="86\.00,93\.00,100\.00,107\.00"/);
  assert.match(svg, /<path id="g1" d="M0 0L1 1Z"\/>/);
});

test("overflow + raised band keep ink inside the rules", () => {
  const uses = [{ ink: [0, 80, 5, 104] }]; // 20 above, 4 below a baseline at 100
  const flat = { ...frameOf(100, 14), index: 1 };
  assert.equal(overflow(flat, uses).ok, false);
  const band = bandFor(100, 14, uses);
  assert.ok(band >= 20 / (2 * 14));
  const raised = { ...frameOf(100, 14, band), index: 1 };
  assert.equal(overflow(raised, uses).ok, true);
});

test("sheetSvg: one slot per row, bands reported as a set", () => {
  const rows = [
    { frame: { ...frameOf(100, 14), index: 1 }, uses: [{ href: "g1", raw: '<use xlink:href="#g1"/>' }] },
    { frame: { ...frameOf(120, 14), index: 2 }, uses: [{ href: "g1", raw: '<use xlink:href="#g1"/>' }] },
  ];
  const svg = sheetSvg(612, rows, { g1: "M0 0L1 1Z" }, 20);
  assert.match(svg, /data-lines="2"/);
  assert.match(svg, /data-pitch="20\.00"/);
});
