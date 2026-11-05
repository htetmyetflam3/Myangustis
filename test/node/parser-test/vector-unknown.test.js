import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { englishLikeness } from "../../../B.Parser/main/parser/text/myanmar-score.js";
import { choosePageParser } from "../../../B.Parser/main/parser/text/page-decision.js";
import { loadDetector, streamPdfPages } from "../../../B.Parser/extend/pipeline.js";
import { prepareVectorLayout } from "../../../B.Parser/main/parser/codepage/resolve.js";
import { probePagePrefix } from "../../../B.Parser/main/parser/read/pdf-extract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(HERE, "..", "..", "..", "F.Site", "Frontend", "frontend-bootstrap", "public", "samples", "sample.pdf");


async function decodeFirstPage(bytes) {
  const logs = [];
  const [, , iterator] = streamPdfPages(bytes, loadDetector(), (l) => logs.push(String(l)));
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

test("checkpoint text returns to the font saved before q", () => {
  const fonts = new Map([
    ["A", { decode: (text) => `A${text}` }],
    ["B", { decode: (text) => `B${text}` }],
  ]);
  const prefix = Buffer.from("BT /A 12 Tf (x) Tj ET q BT /B 18 Tf (y) Tj ET Q BT (z) Tj ET", "latin1");
  const probe = probePagePrefix(prefix, fonts, fonts);
  assert.equal(probe.sharedByFont.get("A"), "AxAz");
  assert.equal(probe.sharedByFont.get("B"), "By");
});

test("page numbers do not turn an inconclusive checkpoint into a legacy page", () => {
  for (const sample of ["1", "2024", "Page-1", "Page | 12", "Page 19Page 18", "  5 \n 6  "]) {
    assert.deepEqual(choosePageParser({ shared: sample }), {
      parser: "zawgyi-one", reason: "page-number-only",
    }, sample);
  }
  assert.equal(choosePageParser({ shared: "12345" }).parser, "legacy");
  assert.equal(choosePageParser({ shared: "4/\n5/\n6/\n7/" }).parser, "legacy");
  assert.equal(choosePageParser({ shared: "jrefrmo'gtwGJ (1)? tcef; (1)trSmpmjrefrmo'gukd" }).parser, "legacy");
  assert.equal(choosePageParser({ shared: "2" }, { sourceEncoding: "unicode" }).reason, "source-encoding");
});

test("isolated page headers are not treated as legacy body text", () => {
  for (const sample of [
    "example.com 3 | Page 129", "Page | 15 https://example.com Life Keyboard",
    "example.com t t y y p p i i n n g g", "June 9,\n2011", "Typing\n-\nlucky82\n22“",
  ]) {
    assert.deepEqual(choosePageParser({ shared: sample }), {
      parser: "zawgyi-one", reason: "non-body-header",
    }, sample);
  }
  assert.equal(choosePageParser({ shared: "example.com 4/5" }).parser, "legacy");
  assert.equal(choosePageParser({ shared: "example.com tcsdefudk tusKd;&Sd&Sd pDrHtkyfcsKyfenf;" }).parser, "legacy");
  assert.equal(choosePageParser({ shared: "example.com 12345" }).parser, "legacy");
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
