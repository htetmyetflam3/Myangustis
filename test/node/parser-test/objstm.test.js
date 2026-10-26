import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Object streams (/ObjStm, PDF 1.5+): parsePdfObjects cannot see objects
   compressed inside them, so the pre-processing in read/decrypt.mjs rewrites
   the file once with qpdf --object-streams=disable (the scraper repo's
   pikepdf ObjectStreamMode.disable approach — pikepdf is libqpdf) and the
   parser then reads plain objects. The fake-qpdf pattern follows
   qpdf.test.mjs: a stand-in binary records its args and copies input to
   output, so the suite needs no real qpdf anywhere. */

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
  process.env.PRASER_QPDF_BIN = executable;
  process.env.FAKE_QPDF_LOG = log;
  try {
    await run({
      called: () => fs.existsSync(log),
      lastArgs: () => JSON.parse(fs.readFileSync(log, "utf8")),
    });
  } finally {
    delete process.env.PRASER_QPDF_BIN;
    delete process.env.FAKE_QPDF_LOG;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const OBJSTM_PDF = Buffer.from(
  "%PDF-1.5\n5 0 obj<</Type/ObjStm/N 1/First 4/Length 4>>stream\nxxxx\nendstream\nendobj\n%%EOF\n",
  "latin1",
);
const PLAIN_PDF = Buffer.from("%PDF-1.4\ntrailer<</Size 1>>\n%%EOF\n", "latin1");

test("object streams are detected by marker and expanded through qpdf", { skip }, async () => {
  await withFakeQpdf(async ({ called, lastArgs }) => {
    const { hasObjectStreams, expandObjectStreams } = await import("../../../Parser/main/parser/read/decrypt.mjs");

    assert.equal(hasObjectStreams(OBJSTM_PDF), true);
    assert.equal(hasObjectStreams(PLAIN_PDF), false);

    // No marker: bytes pass through and qpdf is never invoked.
    assert.deepEqual(await expandObjectStreams(PLAIN_PDF), PLAIN_PDF);
    assert.equal(called(), false);

    const messages = [];
    assert.deepEqual(
      await expandObjectStreams(OBJSTM_PDF, (line) => messages.push(line)),
      OBJSTM_PDF, // the double copies input to output unchanged
    );
    assert.ok(lastArgs().includes("--object-streams=disable"));
    assert.ok(messages.some((line) => line.includes("object streams; expanded with qpdf")));
  });
});

test("the sync extraction path names object streams instead of failing silently", async () => {
  const { streamPdfPages } = await import("../../../Parser/extend/pipeline.mjs");
  assert.throws(
    () => streamPdfPages(OBJSTM_PDF, null, () => {}),
    /object streams \(\/ObjStm\)/,
  );
});
