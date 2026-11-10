import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { matchImageToVector, repairTextRegionWithVector } from "../../../B.Parser/core/@postprocess/repair/vote.js";
import { loadVectorIndex, matchRasterMask, vectorSheetFiles } from "../../../B.Parser/core/@postprocess/repair/match.js";



const HERE = path.dirname(fileURLToPath(import.meta.url));
const OCR_CROP = path.join(HERE, "..", "..", "..", "B.Parser", "main", "File", "upload", "ocr-marked", "zoom-kyone.png");
const OCR_LINE = path.join(HERE, "..", "..", "..", "B.Parser", "main", "File", "upload", "ocr-marked", "zoom-line9.png");
let index;
const vectorIndex = () => (index ||= loadVectorIndex());

test("the default SVG map is shaped and includes legacy layout components", () => {
  const files = vectorSheetFiles();
  assert.ok(files.length >= 1);
  assert.ok(files.every((file) => fs.readFileSync(file, "utf8").includes('data-shaped="harfbuzz"')));
  const loaded = vectorIndex();
  // The surviving sheet is the font-11 Burmese+Pali index: 2460 entries.
  // (The lost PYIDAUNGSU sheets held ~2598 and the bare fragment below.)
  assert.ok(loaded.entries.length >= 2400);
  assert.equal(loaded.byText.get("တ္ထ")?.codepoints, "U+1010 U+1039 U+1011");
  assert.equal(loaded.byText.get("ကြုံ")?.codepoints, "U+1000 U+103C U+102F U+1036");
});

test("SVG matching abstains/ranks by labelled code point, without opening a font", () => {
  const loaded = vectorIndex();
  const stack = loaded.byText.get("တ္ထ");
  const match = matchRasterMask(stack.mask, stack.size, stack.size, {
    index: loaded,
    candidates: ["ဲ", "တ္ထ"],
  });
  assert.equal(match.accepted, true);
  assert.equal(match.text, "တ္ထ");
  assert.equal(match.codepoints, "U+1010 U+1039 U+1011");
});



test("the OCR dropped-mark site is a raster-to-SVG U+1036 recovery", async (t) => {
  if (!fs.existsSync(OCR_CROP) || !fs.existsSync(OCR_LINE)) {
    return t.skip("ocr-marked PNG fixtures exist on no branch of this repo");
  }


  const crop = fs.readFileSync(OCR_CROP);
  assert.equal(crop.subarray(1, 4).toString("ascii"), "PNG");
  const match = await matchImageToVector(crop, {


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



  const unsafe = await repairTextRegionWithVector("ကြုခဲ့ရသည်", {
    start: 0,
    end: "ကြု".length,
    image: fs.readFileSync(OCR_LINE),
    candidates: ["ကြုံ"],
  });
  assert.equal(unsafe.changed, false);
  assert.equal(unsafe.text, "ကြုခဲ့ရသည်");
});




test("a claim is refused when the witness crowd cannot place the pair", async () => {
  const { matchRasterMask, getDefaultVectorIndex, isCrossFontAlias } = await import("../../../B.Parser/core/@postprocess/repair/match.js");
  const alias = JSON.parse(fs.readFileSync(new URL("../../../B.Parser/core/@postprocess/repair/shape-alias.json", import.meta.url), "utf8"));
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
