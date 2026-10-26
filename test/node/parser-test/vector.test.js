import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LEGACY_CODE_PAGES } from "../../../Parser/main/parser/codepage/registry.mjs";
import { matchImageToVector, matchPdfRegionToVector, repairTextRegionWithVector } from "../../../Parser/main/parser/codepage/vote.mjs";
import { loadVectorIndex, matchRasterMask, vectorSheetFiles } from "../../../Parser/main/parser/shape/match.mjs";
import {
  loadDetector,
  streamPdfPages,
} from "../../../Parser/extend/pipeline.mjs";
import { prepareVectorLayout } from "../../../Parser/main/parser/codepage/resolve.mjs";

// working-branch mapping: Parsed/fixtures/ exists on no branch; the same
// book is tracked here as an upload fixture.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "..", "..", "..", "Parser", "main", "File", "upload", "pdf", "bg-mlc-1-1.pdf");
const OCR_CROP = path.join(HERE, "..", "..", "..", "Parser", "main", "File", "upload", "ocr-marked", "zoom-kyone.png");
const OCR_LINE = path.join(HERE, "..", "..", "..", "Parser", "main", "File", "upload", "ocr-marked", "zoom-line9.png");
let index;
const vectorIndex = () => (index ||= loadVectorIndex());

test("the default SVG map is shaped and includes legacy layout components", () => {
  const files = vectorSheetFiles();
  assert.ok(files.length >= 1);
  assert.ok(files.every((file) => fs.readFileSync(file, "utf8").includes('data-shaped="harfbuzz"')));
  const loaded = vectorIndex();
  assert.ok(loaded.entries.length >= 2500);
  assert.equal(loaded.byText.get("္ဒ")?.codepoints, "U+1039 U+1012");
  assert.equal(loaded.byText.get("ကြုံ")?.codepoints, "U+1000 U+103C U+102F U+1036");
});

test("SVG matching abstains/ranks by labelled code point, without opening a font", () => {
  const loaded = vectorIndex();
  const stack = loaded.byText.get("္ဒ");
  const match = matchRasterMask(stack.mask, stack.size, stack.size, {
    index: loaded,
    candidates: ["ဲ", "္ဒ"],
  });
  assert.equal(match.accepted, true);
  assert.equal(match.text, "္ဒ");
  assert.equal(match.codepoints, "U+1039 U+1012");
});

// The render lane needs the optional heavy deps pdfjs-dist + @napi-rs/canvas.
// Probe both once; a sandbox without them skips instead of failing the suite.
let renderLanePromise;
function renderLaneAvailable() {
  if (!renderLanePromise) {
    renderLanePromise = Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("@napi-rs/canvas"),
    ]).then(
      () => true,
      () => false,
    );
  }
  return renderLanePromise;
}

test("a real bg-mlc unknown glyph is cropped to raw pixels and resolved against SVG", async (t) => {
  if (!(await renderLaneAvailable())) {
    return t.skip("render lane needs optional pdfjs-dist + @napi-rs/canvas");
  }
  const match = await matchPdfRegionToVector(
    fs.readFileSync(FIXTURE),
    1,
    // U+00B4 in the source ToUnicode. Its character quad is nearly zero
    // width, but the rendered ink is WinInnwa's stacked-da form.
    { x0: 332.7341, y0: 402.2960, x1: 332.9141, y1: 421.2140 },
    { candidates: ["ဲ", "္ဒ"], scale: 5 },
  );
  // The crop is pixels, not a file: no encode to undo, so the ink measured is
  // exactly what PDF.js drew.
  assert.ok(match.crop.width > 8 && match.crop.height > 8);
  assert.equal(match.accepted, true);
  assert.equal(match.text, "္ဒ");
  assert.equal(match.codepoints, "U+1039 U+1012");
  assert.ok(match.margin > 0.04);
});

test("the OCR dropped-mark site is a raster-to-SVG U+1036 recovery", async (t) => {
  if (!fs.existsSync(OCR_CROP) || !fs.existsSync(OCR_LINE)) {
    return t.skip("ocr-marked PNG fixtures exist on no branch of this repo");
  }
  // A scanner crop arrives as the PNG it already is; it is decoded once, to
  // be measured, and never re-encoded.
  const crop = fs.readFileSync(OCR_CROP);
  assert.equal(crop.subarray(1, 4).toString("ascii"), "PNG");
  const match = await matchImageToVector(crop, {
    // The scanner/dictionary supplies plausible replacements for the unknown
    // OCR token; pixels choose among them and may abstain.
    candidates: ["ကြုံ"],
  });
  assert.equal(match.accepted, true);
  assert.equal(match.text, "ကြုံ");
  assert.equal(match.codepoints, "U+1000 U+103C U+102F U+1036");
  assert.ok(match.distance < 0.08);

  const repaired = await repairTextRegionWithVector("ကြုခဲ့ရသည်", {
    start: 0,
    end: "ကြု".length,
    image: crop,
    candidates: ["ကြုံ"],
  });
  assert.equal(repaired.changed, true);
  assert.equal(repaired.text, "ကြုံခဲ့ရသည်");

  // A whole-line crop contains too much context and must not be forced into a
  // syllable label.
  const unsafe = await repairTextRegionWithVector("ကြုခဲ့ရသည်", {
    start: 0,
    end: "ကြု".length,
    image: fs.readFileSync(OCR_LINE),
    candidates: ["ကြုံ"],
  });
  assert.equal(unsafe.changed, false);
  assert.equal(unsafe.text, "ကြုခဲ့ရသည်");
});

test("runtime outline layout selects only WinInnwa and preserves Latin resources", async () => {
  const bytes = fs.readFileSync(FIXTURE);
  const buildLog = [];
  const vectorLayout = await prepareVectorLayout(bytes, (line) => buildLog.push(String(line)));
  assert.ok(vectorLayout);
  assert.equal(vectorLayout.baseLayout, "wininnwa");
  assert.match(vectorLayout.name, /^vector:WinInnwa$/u);
  /* The pixel builder this replaces decided 23 slots from rendered crops
     (16 more refused by the cross-font alias veto). The outline build
     decides every disputed seat the subset carries -- 61 here -- from the
     font program itself, and lands on the same base, the same /BaseFont
     and the same chosen score. */
  assert.ok(vectorLayout.matched >= 20, `outline vote count ${vectorLayout.matched}`);
  assert.equal(vectorLayout.table.get(0xb4), "္ဒ");
  assert.equal(vectorLayout.table.get(0x4d), "ြ");
  assert.notEqual(vectorLayout.table, LEGACY_CODE_PAGES.get("wininnwa"));

  const decodeLog = [];
  const [, , iterator] = streamPdfPages(bytes, loadDetector(), (line) => decodeLog.push(String(line)), { vectorLayout });
  const first = iterator.next().value;
  assert.ok(first.text.startsWith("Update: 2012-12-11"));
  assert.ok(first.text.includes("Myanmar Grammar: MLC"));
  assert.ok(first.text.includes("မြန်မာသဒ္ဒါ"));
  assert.ok(decodeLog.some((line) => /text path "vector:WinInnwa": 0\.9\d\d\s+<- chosen/u.test(line)));
  assert.ok(decodeLog.includes('[+] Decoding via "vector:WinInnwa" character map'));
});

/* The alias veto is a refusal, so its test is a refusal: a shape the crowd can
   place with one candidate must NOT be placed once its alias partner is in the
   running. Nothing here renders a page or opens a font. */
test("a claim is refused when the witness crowd cannot place the pair", async () => {
  const { matchRasterMask, getDefaultVectorIndex, isCrossFontAlias } = await import("../../../Parser/main/parser/shape/match.mjs");
  const alias = JSON.parse(fs.readFileSync(new URL("../../../Parser/main/parser/jason-map/vector/shape-alias.json", import.meta.url), "utf8"));
  assert.ok(alias.pairs.length > 0, "the generator produced a veto list");
  assert.ok(alias.pairs.every(([a, b]) => a !== b));

  const index = getDefaultVectorIndex();
  const sameKind = alias.detail.filter((row) => {
    const [a, b] = row.pair;
    return index.byText.get(a)?.kind === index.byText.get(b)?.kind;
  });
  assert.ok(sameKind.length > 0, "at least one vetoed pair is letter/letter");
  const [a, b] = sameKind[0].pair;
  assert.ok(isCrossFontAlias(a, b), `${a}/${b} is on the veto list`);
  assert.ok(sameKind[0].dissent >= 2, "the veto rests on more than one dissenting face");

  const query = index.byText.get(b);
  const split = matchRasterMask(query.mask, query.size, query.size, { candidates: [a, b] });
  assert.equal(split.accepted, false, "the aliased pair is refused");
  assert.match(String(split.reason), /cross-font alias/u);
  const alone = matchRasterMask(query.mask, query.size, query.size, { candidates: [b] });
  assert.equal(alone.accepted, true, "the same shape is accepted with no alias rival offered");
  assert.equal(alone.text, b);
});
