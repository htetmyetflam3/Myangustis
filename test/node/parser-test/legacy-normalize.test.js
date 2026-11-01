import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFinalPages, processPdfBytes, streamPdfPages } from "../../../B.Parser/extend/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const refs = path.resolve(here, "../../../Junk/Parser/upload/pdf");
const bg1 = path.join(refs, "bg-mlc-1-1.pdf");
const grammar = path.join(refs, "mm-grammar.pdf");

function pageAt(bytes, number) {
  const [, , pages] = streamPdfPages(bytes);
  for (const page of pages) if (page.idx + 1 === number) return page;
  throw new Error(`Missing page ${number}`);
}

test("legacy text is normalized after confirmed repairs, with synchronized layout", {
  skip: !fs.existsSync(bg1) && "real BG1 PDF is unavailable",
}, () => {
  const bytes = fs.readFileSync(bg1);
  const page = pageAt(bytes, 2);
  assert.equal(page.parsingPath, "legacy");
  assert.ok(page.confirmedRepair?.changedLines > 0);
  assert.ok(page.text.includes("ဒ္ဒ"));
  assert.ok(page.text.includes("နှင့် လုိက်အောင်"));
  assert.ok(!page.text.includes("နှင့် လုိက်အောင်"));
  assert.equal(page.lines.map((line) => line[3]).join("\n"), page.text);

  const job = processPdfBytes(bytes, null, "bg-mlc-1-1.pdf");
  for (const cleanup of [true, false]) {
    const output = buildFinalPages(job, cleanup)[1];
    assert.equal(output.text, page.text);
    assert.equal(output.lines.map((line) => line[3]).join("\n"), output.text);
  }
});

test("Ayar legacy resources use the same Engine normalization", {
  skip: !fs.existsSync(grammar) && "real Myanmar grammar PDF is unavailable",
}, () => {
  const page = pageAt(fs.readFileSync(grammar), 150);
  assert.equal(page.parsingPath, "legacy");
  assert.ok(page.text.includes("နှင့် အောင်"));
  assert.ok(!page.text.includes("နှင့် အောင်"));
  assert.equal(page.lines.map((line) => line[3]).join("\n"), page.text);
});
