import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

import { validatePdf } from "../../B.Parser/architecture/@entry/helper/validator.js";
import { qpdfRunner, runQpdfFile } from "../../B.Parser/architecture/@init/pdf/helper/decrypt.js";

// pdf-lib's default save writes object streams, which the reader refuses
// until the file is prepared - exactly the shape qpdf handles.

async function objectStreamPdf() {
  const document = await PDFDocument.create();
  document.addPage().drawText("Hello from page one");
  document.addPage().drawText("Hello from page two");
  return Buffer.from(await document.save());
}

test("an object-stream PDF is detected and prepared into a readable file", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-prepare-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "streams.pdf");
  fs.writeFileSync(input, await objectStreamPdf());
  assert.equal(validatePdf(input).objectStreams, true);

  const output = path.join(dir, "prepared.pdf");
  await runQpdfFile(input, output, ["--decrypt", "--object-streams=disable", "--qdf"]);
  assert.ok(fs.statSync(output).size > 0);

  const prepared = validatePdf(output);
  assert.equal(prepared.objectStreams, false, "object streams must be gone");
  const bytes = fs.readFileSync(output);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
});

test("the Parser prepares an object-stream PDF through the resolved runner", async () => {
  const { InitInput, parseDecoding } = await import("../../B.Parser/index.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-prepare-door-"));
  try {
    const input = path.join(dir, "streams.pdf");
    fs.writeFileSync(input, await objectStreamPdf());
    assert.equal(validatePdf(input).objectStreams, true);
    const prepared = await InitInput({ path: input }, "owner");
    assert.equal(prepared.kind, "pdf");
    assert.equal(prepared.prepared, true, "the input stage must run qpdf here");
    const parsed = await parseDecoding({ kind: "pdf", source: prepared.path, filename: "streams.pdf" });
    assert.equal(parsed.pages.length, 2);
    assert.match(parsed.pages.join("\n"), /Hello from page one/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the qpdf runner resolves to an executable command in this repository", () => {
  const runner = qpdfRunner();
  assert.equal(typeof runner.bin, "string");
  assert.ok(Array.isArray(runner.args));
  // The real binary is preferred, otherwise the bundled JS/WASM CLI is used.
  assert.ok(runner.bin === "qpdf" || runner.bin === "qpdf-wasm" || process.env.PRASER_QPDF_BIN);
});
