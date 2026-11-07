import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { processPageRecord, streamPdfPages } from "../../../B.Parser/core/decoding/source-decoding.js";










const ZAWGYI_LINE = "သူ႔တစ္ကိုယ္လုံးနာက်င္နေသည္ကို ရွီယန္သတိထားမိလိုက္သည္။ ";
const UNICODE_LINE = "သူ့တစ်ကိုယ်လုံးနာကျင်နေသည်ကို ရှီယန်သတိထားမိလိုက်သည်။ ";

test("the shipped Zawgyi-One PDF routes its first page through Rabbit", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sample = path.join(here, "..", "..", "..", "B.Parser/host", "Frontend", "frontend-bootstrap", "public", "samples", "sample.pdf");
    const [, , pages] = streamPdfPages(fs.readFileSync(sample), () => {});
  try {
    const pg = pages.next().value;
    assert.equal(pg.parsingPath, "font-cmap");
    assert.equal(pg.decision, "rabbit");
    assert.deepEqual([...pg.fontKinds], ["ZAWGYI"]);
    const rep = processPageRecord(pg, false);
    assert.equal(rep.category, "ZAWGYI");
    assert.equal(rep.pageFinalized, true);
    assert.ok(rep.text.includes("သတ်ဖြတ်သူ သွေးနတ်ဘုရား"), "text must come out as real Unicode");
  } finally { pages.return?.(); }
});

test("zawgyi-cmap: a Zawgyi-One font's own cmap still goes to Rabbit", () => {
  const logs = [];
  const rep = processPageRecord({
    idx: 0, category: "ZAWGYI", text: ZAWGYI_LINE.repeat(6), decodeKind: "cmap", fontNames: new Set(["Zawgyi-One"]),
  }, false, (line) => logs.push(String(line)));
  assert.equal(rep.category, "ZAWGYI");
  assert.ok(logs.some((line) => line.includes("zawgyi-cmap path")), logs.join("\n"));
  assert.ok(rep.text.includes("ရှီယန်သတိထားမိလိုက်သည်"));
});

test("buffered Zawgyi conversion uses Rabbit's normal U+200B handling", () => {
  const source = "ျဖစ္သ\u200bြားတယ္";
  const rep = processPageRecord({
    idx: 0, category: "ZAWGYI", text: source, decodeKind: "cmap", fontNames: new Set(["Zawgyi-One"]),
  }, false, () => {}, false, "zawgyi-one");
  assert.equal(rep.category, "ZAWGYI");
  assert.equal(rep.text.includes("\u200b"), false);
  assert.ok(rep.text.includes("ဖြစ်သွားတယ်"), rep.text);
});

test("unicode: a page that reads as itself is never rewritten", () => {
  const logs = [];
  const rep = processPageRecord(
    { idx: 0, category: "ZAWGYI", text: UNICODE_LINE.repeat(6), decodeKind: "tounicode" },
     false, (l) => logs.push(String(l)),
  );
  assert.equal(rep.category, "UNICODE");
  assert.ok(logs.some((l) => l.includes("unicode path")), logs.join("\n"));
  assert.ok(rep.text.includes("ရှီယန်သတိထားမိလိုက်သည်"));
});

test("the fork needs evidence: a mark-thin page stays on the unicode path", () => {
  const rep = processPageRecord(
    { idx: 0, category: "ZAWGYI", text: ZAWGYI_LINE, decodeKind: "cmap" },
     false, () => {},
  );
  assert.equal(rep.category, "UNICODE");
});
