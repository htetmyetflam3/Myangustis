import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";









const skip = process.platform === "win32";

async function withFakeQpdf(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-fake-qpdf-"));
  const executable = path.join(dir, "qpdf");
  const log = path.join(dir, "args.json");
  fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") process.exit(0);
fs.writeFileSync(process.env.FAKE_QPDF_LOG, JSON.stringify(args));
fs.copyFileSync(args.at(-2), args.at(-1));
`);
  fs.chmodSync(executable, 0o755);
  const previousBin = process.env.PRASER_QPDF_BIN;
  const previousLog = process.env.FAKE_QPDF_LOG;
  process.env.PRASER_QPDF_BIN = executable;
  process.env.FAKE_QPDF_LOG = log;
  try {
    await run({
      dir,
      called: () => fs.existsSync(log),
      lastArgs: () => JSON.parse(fs.readFileSync(log, "utf8")),
    });
  } finally {
    if (previousBin === undefined) delete process.env.PRASER_QPDF_BIN;
    else process.env.PRASER_QPDF_BIN = previousBin;
    if (previousLog === undefined) delete process.env.FAKE_QPDF_LOG;
    else process.env.FAKE_QPDF_LOG = previousLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const OBJSTM_PDF = Buffer.from(
  "%PDF-1.5\n5 0 obj<</Type/ObjStm/N 1/First 4/Length 4>>stream\nxxxx\nendstream\nendobj\n%%EOF\n",
  "latin1",
);
const PLAIN_PDF = Buffer.from("%PDF-1.4\ntrailer<</Size 1>>\n%%EOF\n", "latin1");

test("object streams are detected on disk and prepared through file-backed qpdf", { skip }, async () => {
  await withFakeQpdf(async ({ dir, called, lastArgs }) => {
    const { hasObjectStreams, scanPdfFileMarkers } = await import("../../../B.Parser/prised/@core/pdf/method/pdfencoding/decoding.js");
    const { runQpdfFile } = await import("../../../B.Parser/@init/pdf/helper/decrypt.js");
    const input = path.join(dir, "objects.pdf");
    const output = path.join(dir, "expanded.pdf");
    fs.writeFileSync(input, OBJSTM_PDF);
    assert.equal(hasObjectStreams(OBJSTM_PDF), true);
    assert.equal(hasObjectStreams(PLAIN_PDF), false);
    assert.equal(scanPdfFileMarkers(input).objectStreams, true);
    assert.equal(called(), false);
    await runQpdfFile(input, output, ["--object-streams=disable"]);
    assert.deepEqual(fs.readFileSync(output), OBJSTM_PDF);
    assert.ok(lastArgs().includes("--object-streams=disable"));
  });
});

test("the sync extraction path names object streams instead of failing silently", async () => {
  const { streamPdfPages } = await import("../../../B.Parser/prised/@core/runtime/source.js");
  assert.throws(
    () => streamPdfPages(OBJSTM_PDF, () => {}),
    /object streams \(\/ObjStm\)/,
  );
});
