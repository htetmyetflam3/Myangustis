import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { englishLikeness } from "../../../B.Parser/core/decoding/judgement.js";
import { streamPdfPages, instructionLane } from "../../../B.Parser/core/decoding/source-decoding.js";
import { prepareVectorLayout } from "../../../B.Parser/extend/codepage-resolve.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(HERE, "..", "..", "..", "B.Parser/host", "Frontend", "frontend-bootstrap", "public", "samples", "sample.pdf");


async function decodeFirstPage(bytes) {
  const logs = [];
  const [, , iterator] = streamPdfPages(bytes, (l) => logs.push(String(l)));
  try {
    const first = iterator.next().value;
    assert.ok(first, "first page must decode");
    return { text: first.text, logs };
  } finally { iterator.return?.(); }
}

test("the one-sided English check separates Latin faces from layout junk", () => {


  assert.equal(
    englishLikeness("Update: 2012-12-11 02:17 AM +0630BGo1-1.htm{ mrûn-ma þûd~da}, Volume 1, "
      + "Module 1, byMyanmar Language Commission (MLC), Ministry of Education, Governme").verdict,
    "english",
  );
  assert.equal(
    englishLikeness("TILMyanmar Grammar: MLCin three volumesMyanmar Thuddar Myanmar Thuddar ").verdict,
    "english",
  );
  assert.equal(englishLikeness("Myanmar Grammar: MLC in three volumes").verdict, "english");




  assert.equal(
    englishLikeness("jrefrmo'gtwGJ (1)? tcef; (1)trSmpmjrefrmo'gukd twGJ(3) wGJcGJum jyKpkygonf/").verdict,
    "not-english",
  );
  assert.equal(englishLikeness("pneumonoultramicroscopicsilicovolcanoconiosis").verdict, "not-english");


  assert.equal(englishLikeness("A\nReference Books\n(1) ASHEAE Books\n(2)").verdict, "english");
  assert.equal(englishLikeness("hello!").verdict, null);
  assert.equal(englishLikeness("MLC").verdict, null);
  assert.equal(englishLikeness("•").verdict, null);
});

test("the lane comes from the page's font instructions, not sampled text", () => {
  const font = (baseFont, { subtype = "TrueType", toUnicode = false } = {}) =>
    ({ subtype, baseFont, toUnicode });
  // An explicit source encoding always stays on the font-cmap lane.
  assert.equal(instructionLane({ fonts: [font("WinInnwa")] }, "unicode").reason, "source-encoding");
  // A registered legacy face carrying the page: legacy lane.
  assert.deepEqual(instructionLane({ fonts: [font("W42ArtHouse")] }, "auto"),
    { parser: "legacy", reason: "legacy-font", fonts: ["W42ArtHouse"] });
  // A replayed legacy face with its own map: still the legacy lane.
  assert.equal(instructionLane({ fonts: [font("EAAAAA+WinInnwa", { toUnicode: true }), font("Helvetica", { subtype: "Type1" })] }, "auto").parser, "legacy");
  // The legacy face typesets headers while a mapped font carries the text.
  assert.equal(instructionLane({ fonts: [font("WinYadanapon"), font("Zawgyi-One", { toUnicode: true })] }, "auto").parser, "font-cmap");
  // A CID Unicode face vetoes a legacy-named resource on the same page.
  assert.deepEqual(instructionLane({ fonts: [font("WinResearcher"), font("Myanmar3", { subtype: "Type0", toUnicode: true })] }, "auto"),
    { parser: "font-cmap", reason: "unicode-font" });
  // The modern Unicode font named "Ayar" is not a registered legacy face.
  assert.equal(instructionLane({ fonts: [font("Ayar", { subtype: "Type0", toUnicode: true })] }, "auto").parser, "font-cmap");
  // A two-letter base name is not evidence, and no fonts means no lane change.
  assert.equal(instructionLane({ fonts: [font("MS")] }, "auto").parser, "font-cmap");
  assert.deepEqual(instructionLane({ fonts: [] }, "auto"), { parser: "font-cmap", reason: "no-fonts" });
});

test("a clean Zawgyi-Type0 document is never vector-mapped", async () => {




  const bytes = fs.readFileSync(SAMPLE);
  const layout = await prepareVectorLayout(bytes);
  assert.equal(layout, null, "no vector layout may be built for a Zawgyi-Type0 document");

  const { text, logs } = await decodeFirstPage(bytes);


  assert.ok(!logs.some((line) => /"vector:|Vector layout/iu.test(line)), "no vector layout machinery may engage");
  assert.ok(/[\u1000-\u109F]/u.test(text), "the Myanmar body must decode through the regular path");
  assert.ok(text.includes("God of Slaughter"), "the English lines must decode through the regular path");
});
