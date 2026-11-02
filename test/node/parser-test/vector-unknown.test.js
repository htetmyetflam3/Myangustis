import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { englishLikeness } from "../../../B.Parser/main/parser/text/mm-score.js";
import { loadDetector, streamPdfPages } from "../../../B.Parser/extend/pipeline.js";
import { prepareVectorLayout } from "../../../B.Parser/main/parser/codepage/resolve.js";

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


  assert.equal(englishLikeness("hello!").verdict, null);
  assert.equal(englishLikeness("MLC").verdict, null);
  assert.equal(englishLikeness("•").verdict, null);
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
