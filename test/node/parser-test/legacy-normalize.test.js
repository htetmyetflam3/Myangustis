import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFinalPages, collectPdfResult, processPageRecord, streamPdfPages } from "../../../B.Parser/extend/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const refs = process.env.PARSER_TEST_PDF_DIR
  ? path.resolve(process.env.PARSER_TEST_PDF_DIR)
  : path.resolve(here, "../../../Junk/Parser/upload/pdf");
const bg1 = path.join(refs, "bg-mlc-1-1.pdf");
const grammar = path.join(refs, "mm-grammar.pdf");

function pageAt(bytes, number) {
  const [, , pages] = streamPdfPages(bytes);
  for (const page of pages) if (page.idx + 1 === number) return page;
  throw new Error(`Missing page ${number}`);
}

test("legacy text remains normalized with synchronized layout", {
  skip: !fs.existsSync(bg1) && "real BG1 PDF is unavailable",
}, () => {
  const bytes = fs.readFileSync(bg1);
  const page = pageAt(bytes, 2);
  assert.equal(page.parsingPath, "legacy");
  // The global slot map may decode this correctly without a profile repair.
  assert.ok(page.text.includes("ဒ္ဒ"));
  assert.ok(page.text.includes("နှင့် လုိက်အောင်"));
  assert.ok(!page.text.includes("နှင့် လုိက်အောင်"));
  assert.equal(page.lines.map((line) => line[3]).join("\n"), page.text);

  const [, count, pages] = streamPdfPages(bytes);
  const reports = (function* () {
    for (const item of pages) yield processPageRecord(item, null, false, () => {}, true);
  })();
  const job = collectPdfResult(reports, count, "bg-mlc-1-1.pdf");
  for (const cleanup of [true, false]) {
    const output = buildFinalPages(job, cleanup)[1];
    assert.equal(output.text, page.text);
    assert.equal(output.lines.map((line) => line[3]).join("\n"), output.text);
  }
});

test("Ayar legacy resources retain combined kinzi vowels on real pages", {
  skip: !fs.existsSync(grammar) && "real Myanmar grammar PDF is unavailable",
}, () => {
  const targets = new Map([
    [150, "အင်္ကျီ"], [235, "အင်္ကျီ"], [261, "သိင်္ဂီ"],
    [300, "သိင်္ဂီ"], [328, "အင်္ကျီ"], [329, "အင်္ကျီ"],
  ]);
  const [, , pages] = streamPdfPages(fs.readFileSync(grammar));
  for (const page of pages) {
    const number = page.idx + 1;
    const term = targets.get(number);
    if (!term) continue;
    assert.equal(page.parsingPath, "legacy");
    assert.ok(page.text.includes(term), `page ${number}: ${term}`);
    assert.equal(page.lines.map((line) => line[3]).join("\n"), page.text);
    if (number === 150) {
      assert.ok(page.text.includes("နှင့် အောင်"));
      assert.ok(!page.text.includes("နှင့် အောင်"));
    }
    targets.delete(number);
    if (!targets.size) break;
  }
  assert.equal(targets.size, 0);
});

test("both observed lower-တ variants work on real WinInnwa pages", {
  skip: !fs.existsSync(bg1) && "real BG1 PDF is unavailable",
}, () => {
  const targets = new Set([6, 22]);
  const [, , pages] = streamPdfPages(fs.readFileSync(bg1));
  for (const page of pages) {
    const number = page.idx + 1;
    if (!targets.has(number)) continue;
    assert.equal(page.parsingPath, "legacy");
    assert.ok(page.text.includes("ကတ္တား"), `page ${number}`);
    targets.delete(number);
    if (!targets.size) break;
  }
  assert.equal(targets.size, 0);
});

// Optional real editions can be supplied outside the repository without
// restoring the user's deleted fixtures.
for (const [name, entries] of [
  ["bg-mlc-1-1.pdf", [[2, ["ပစ္စည်း", "သဒ္ဒါ"]], [6, ["ကတ္တား"]], [22, ["ကတ္တား", "မန္တလေး"]], [31, ["မြွေကြီး"]]]],
  ["bg-mlc-2-5.pdf", [[2, ["ဥက္ကဋ္ဌ", "သဒ္ဒါ"]], [6, ["ပါဠိ"]], [40, ["မန္တလေး"]], [59, ["သိင်္ဂီ"]]]],
  ["bg-mlc-2-6.pdf", [[15, ["မေတ္တာ", "ဝိဇ္ဇာ", "ဒုက္ခ", "ကိစ္စ"]], [20, ["သိင်္ဂီ"]], [56, ["အင်္ကျီ"]], [57, ["အင်္ကျီ"]]]],
  ["bg-mlc-3.pdf", [[7, ["မန္တလေး"]], [42, ["ကတ္တား"]]]],
  ["bg-mlc-4.pdf", [[6, ["ဒုက္ခ"]], [12, ["မန္တလေး"]]]],
]) {
  const file = path.join(refs, name);
  test(`observed words and bounded page decisions in ${name}`, {
    skip: !fs.existsSync(file) && "real PDF is unavailable",
  }, () => {
    const targets = new Map(entries);
    let prefixes = 0;
    const [, , pages] = streamPdfPages(fs.readFileSync(file), null, () => {}, {
      onPagePrefix: (_index, prefix) => {
        prefixes += 1;
        assert.ok(prefix.length <= 2048);
      },
    });
    for (const page of pages) {
      const number = page.idx + 1;
      const words = targets.get(number);
      if (!words) continue;
      assert.equal(page.parsingPath, "legacy", `page ${number}`);
      for (const word of words) assert.ok(page.text.includes(word), `page ${number}: ${word}`);
      assert.equal(page.lines.map((line) => line[3]).join("\n"), page.text);
      targets.delete(number);
      if (!targets.size) break;
    }
    assert.equal(targets.size, 0);
    assert.ok(prefixes > 0);
  });
}
