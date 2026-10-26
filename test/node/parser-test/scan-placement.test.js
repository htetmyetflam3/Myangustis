import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* Scan placement: the verdict runs after parsing on the chosen byte-table
   paths (wininnwa / ayar / vector auto-build) and nowhere else — never on
   zawgyi, never on pure unicode. Placement after the choice (not
   per-candidate) was measured with .bin/node/path-scan.mjs. */

process.env.PRASER_REGISTER = "0";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const book = (name) => path.join(HERE, "..", "..", "..", "Parser", "main", "File", "upload", "pdf", name);

const { createSourceRunner } = await import("../../../Parser/main/parser/worker/runtime.mjs");
const runSource = createSourceRunner({ kind: "pdf", method: "default" });

async function run(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-scan-placement-"));
  try {
    return await runSource({
      filename: name,
      inPath: book(name),
      outPath: path.join(dir, "out.txt"),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("a legacy-table book carries the scan verdict of its path", async () => {
  const result = await run("bg-mlc-1-1.pdf");
  assert.ok(Array.isArray(result.scanSummary), "scanSummary must be present");
  assert.ok(result.scanSummary.length > 0, "the grammar book has scan findings");
});

test("a unicode-path book is never scanned", async () => {
  const result = await run("sample.pdf");
  assert.equal(result.scanSummary, undefined);
});
