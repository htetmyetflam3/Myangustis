import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runStagedParse } from "../../../B.Parser/samples/staged-font-context.mjs";

// Staged shape under test:
//   phase 1 parses only object dictionaries (page tree, MediaBox, font
//   chains) -- no stream is decompressed;
//   phase 2 decompresses per page, but a font context's tables are built
//   once and reused by every later page with the same fingerprint, and
//   the vector-repair stage is armed at most once per font context.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(HERE, "..", "..", "..", "F.Site", "Frontend", "frontend-bootstrap", "public", "samples", "sample.pdf");

test("outside plan: page refs, interned MediaBox, font chains per page", () => {
  const { plan } = runStagedParse(SAMPLE, { maxPages: 0 });
  assert.equal(plan.pageCount, 100);
  assert.equal(plan.pages[0].ref, "4,0");
  assert.equal(plan.pages[0].contentsRef, "106,0");
  assert.equal(plan.pages[99].ref, "103,0");

  // All 100 pages share one MediaBox value -> one canonical entry.
  assert.equal(plan.boxes.length, 1);
  assert.equal(plan.boxes[0].pages, 100);

  // Two font tables (F1 Type0 + F2 TrueType), one combined page context.
  assert.equal(plan.fontTables.length, 2);
  const f1 = plan.fontTables.find((t) => t.subtype === "Type0");
  const f2 = plan.fontTables.find((t) => t.subtype === "TrueType");
  assert.equal(f1.fontRef, "104,0");
  assert.equal(f1.toUnicodeRef, "208,0");
  assert.equal(f1.fontFileRef, "212,0");
  assert.equal(f2.fontRef, "105,0");
  assert.equal(f2.toUnicodeRef, null);
  assert.equal(f2.fontFileRef, "212,0");
  assert.equal(plan.pageContexts, 1);
});

test("decompress stage: tables built once, reused on the next pages", () => {
  const repairCalls = [];
  const { stats } = runStagedParse(SAMPLE, {
    repairStage: (page) => {
      repairCalls.push(page.page);
      return { byGid: new Map() };
    },
  });

  assert.equal(stats.contentStreamsOpened, 100); // every page decompressed
  assert.equal(stats.contextBuilds, 1);          // ...but tables built once
  assert.equal(stats.toUnicodeDecompressed, 1);  // ToUnicode opened once
  assert.equal(stats.pagesReusingContext, 99);   // not rebuilt per page
  assert.ok(stats.glyphCodes > 10_000);
  assert.ok(stats.myanmarChars > 0);

  // The ToUnicode here is mostly space-mapped, so blind GIDs exist; the
  // vector-repair stage fires once for the single font context, not
  // once per page and not once per blind glyph.
  assert.ok(stats.blindGids > 0);
  assert.equal(repairCalls.length, 1);
  assert.equal(stats.vectorRepairCalls, 1);
});
