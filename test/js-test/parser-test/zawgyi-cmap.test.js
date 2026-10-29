import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDetector, processPageRecord, streamPdfPages } from "../../../B.Parser/extend/pipeline.js";









const detector = { detect: () => ["ZAWGYI", 1] };

const ZAWGYI_LINE = "သူ႔တစ္ကိုယ္လုံးနာက်င္နေသည္ကို ရွီယန္သတိထားမိလိုက္သည္။ ";
const UNICODE_LINE = "သူ့တစ်ကိုယ်လုံးနာကျင်နေသည်ကို ရှီယန်သတိထားမိလိုက်သည်။ ";

test("zawgyi-cmap: a Zawgyi font's own cmap still goes to Rabbit", () => {


  const here = path.dirname(fileURLToPath(import.meta.url));
  const bytes = fs.readFileSync(path.join(here, "..", "..", "..", "Junk", "Parser", "upload", "pdf", "sample.pdf"));
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
