import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

const skip = process.platform === "win32";

async function withFakeQpdf(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-fake-qpdf-"));
  const executable = path.join(dir, "qpdf");
  const log = path.join(dir, "args.jsonl");
  fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") process.exit(0);
fs.appendFileSync(process.env.FAKE_QPDF_LOG, JSON.stringify(args) + "\\n");
fs.copyFileSync(args.at(-2), args.at(-1));
`);
  fs.chmodSync(executable, 0o755);
  const previous = {
    binary: process.env.PRASER_QPDF_BIN,
    log: process.env.FAKE_QPDF_LOG,
    register: process.env.PRASER_REGISTER,
  };
  process.env.PRASER_QPDF_BIN = executable;
  process.env.FAKE_QPDF_LOG = log;
  process.env.PRASER_REGISTER = path.join(dir, "register");
  try {
    await run({ dir, history: () => fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) });
  } finally {
    for (const [key, value] of Object.entries({
      PRASER_QPDF_BIN: previous.binary, FAKE_QPDF_LOG: previous.log, PRASER_REGISTER: previous.register,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("file-backed PDF jobs prepare with qpdf and optimize Fast Web View", { skip }, async () => {
  await withFakeQpdf(async ({ dir, history }) => {
    const { runPdfStream } = await import("../../../B.Parser/main/parser/worker/pdf-stream.js");
    const { writeOptimizedPdf } = await import("../../../B.Parser/main/parser/write/pdf-optimize.js");
    const document = await PDFDocument.create();
    document.addPage().drawText("Qpdf file input");
    const source = path.join(dir, "source.pdf");
    fs.writeFileSync(source, await document.save({ useObjectStreams: false }));
    const result = await runPdfStream({ inPath: source, outPath: path.join(dir, "out.txt"), workDir: dir });
    assert.equal(result.pages, 1);
    const [prepare, linearize] = history();
    assert.ok(prepare.includes("--decrypt"));
    assert.ok(prepare.includes("--password="));
    assert.ok(prepare.includes("--object-streams=disable"));
    assert.ok(linearize.includes("--linearize"));

    const output = path.join(dir, "optimized.pdf");
    const optimized = await writeOptimizedPdf(output, source);
    assert.equal(optimized.linearized, true);
    assert.deepEqual(fs.readFileSync(output), fs.readFileSync(source));
    const args = history().at(-1);
    assert.ok(args.includes("--linearize"));
    assert.ok(args.includes("--object-streams=generate"));
    assert.ok(args.includes("--stream-data=compress"));
  });
});
