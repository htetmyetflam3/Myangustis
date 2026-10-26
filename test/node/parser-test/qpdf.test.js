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
  process.env.PRASER_QPDF_BIN = executable;
  process.env.FAKE_QPDF_LOG = log;
  try {
    await run(() => JSON.parse(fs.readFileSync(log, "utf8")));
  } finally {
    delete process.env.PRASER_QPDF_BIN;
    delete process.env.FAKE_QPDF_LOG;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("qpdf is the decrypt and Fast Web View second pass", { skip }, async () => {
  await withFakeQpdf(async (lastArgs) => {
    const { decryptPdf } = await import("../../../Parser/main/parser/read/decrypt.mjs");
    const { optimizePdfBytes } = await import("../../../Parser/main/parser/write/pdf-optimize.mjs");

    const encrypted = Buffer.from("%PDF-1.7\n/Encrypt 1 0 R\n%%EOF\n");
    const messages = [];
    assert.deepEqual(await decryptPdf(encrypted, (line) => messages.push(line)), encrypted);
    assert.ok(lastArgs().includes("--decrypt"));
    assert.ok(lastArgs().includes("--password="));
    assert.ok(messages.some((line) => line.includes("decrypted with qpdf")));

    const result = await optimizePdfBytes(encrypted);
    assert.equal(result.linearized, true);
    assert.deepEqual(result.bytes, encrypted);
    assert.ok(lastArgs().includes("--linearize"));
    assert.ok(lastArgs().includes("--object-streams=generate"));
    assert.ok(lastArgs().includes("--stream-data=compress"));
  });
});
