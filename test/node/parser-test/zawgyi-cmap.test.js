import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDetector, processPageRecord, streamPdfPages } from "../../../Parser/extend/pipeline.mjs";

/* The cmap fork (processPageRecord): a page decoded from the font's own
   cmap/ToUnicode that the detector calls Zawgyi is either a Unicode page in
   drawing order ("unicode" path) or a Zawgyi font whose own table names
   Zawgyi slots ("zawgyi-cmap" path, sample.pdf's class). The two readings
   are structurally scored and Rabbit must win clearly to rewrite.
   The detector is stubbed to always say ZAWGYI so the fork itself -- not
   the model -- is what is under test. */

const detector = { detect: () => ["ZAWGYI", 1] };

const ZAWGYI_LINE = "သူ႔တစ္ကိုယ္လုံးနာက်င္နေသည္ကို ရွီယန္သတိထားမိလိုက္သည္။ ";
const UNICODE_LINE = "သူ့တစ်ကိုယ်လုံးနာကျင်နေသည်ကို ရှီယန်သတိထားမိလိုက်သည်။ ";

test("zawgyi-cmap: a Zawgyi font's own cmap still goes to Rabbit", () => {
  // The real thing: sample.pdf page 1 raw from the extractor. (A typed
  // Zawgyi-looking line is not the same evidence -- PDF raw is glyph order.)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bytes = fs.readFileSync(path.join(here, "..", "..", "..", "Parser", "main", "File", "upload", "pdf", "sample.pdf"));
  const det = loadDetector();
  const [, , pages] = streamPdfPages(bytes, det, () => {});
  const pg = pages.next().value;
  assert.equal(pg.decodeKind, "cmap");

  const logs = [];
  const rep = processPageRecord(pg, det, false, (l) => logs.push(String(l)));
  assert.equal(rep.category, "ZAWGYI");
  assert.ok(logs.some((l) => l.includes("zawgyi-cmap path")), logs.join("\n"));
  assert.ok(rep.text.includes("သတ်ဖြတ်သူ သွေးနတ်ဘုရား"), "text must come out as real Unicode");
});

test("unicode: a page that reads as itself is never rewritten", () => {
  const logs = [];
  const rep = processPageRecord(
    { idx: 0, text: UNICODE_LINE.repeat(6), decodeKind: "tounicode" },
    detector, false, (l) => logs.push(String(l)),
  );
  assert.equal(rep.category, "UNICODE");
  assert.ok(logs.some((l) => l.includes("unicode path")), logs.join("\n"));
  assert.ok(rep.text.includes("ရှီယန်သတိထားမိလိုက်သည်"));
});

test("the fork needs evidence: a mark-thin page stays on the unicode path", () => {
  const rep = processPageRecord(
    { idx: 0, text: ZAWGYI_LINE, decodeKind: "cmap" },
    detector, false, () => {},
  );
  assert.equal(rep.category, "UNICODE");
});
