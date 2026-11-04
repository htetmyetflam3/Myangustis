import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";






process.env.PRASER_REGISTER = "0";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SAMPLE = path.join(REPO, "F.Site", "Frontend", "frontend-bootstrap", "public", "samples", "sample.pdf");

const { createSourceRunner } = await import("../../../B.Parser/main/parser/worker/runtime.js");
const runSource = createSourceRunner({ kind: "pdf", method: "default" });

async function run(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-scan-placement-"));
  try {
    const result = await runSource({
      filename: path.basename(file), inPath: file, outPath: path.join(dir, "out.txt"),
    });
    return {
      result,
      output: fs.readFileSync(result.file, "utf8"),
      report: fs.readFileSync(result.posScan.file, "utf8"),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertReportMatchesOutput({ result, output, report }) {
  assert.ok(output.trim(), "the parsed output must not be empty");
  assert.ok(result.posScan);
  assert.ok(Number.isSafeInteger(result.posScan.unknownCount));
  assert.ok(result.posScan.unknownCount >= result.posScan.contextCount);
  const originals = [...report.matchAll(/^Original: (.*)$/gmu)].map((match) => match[1]);
  const pages = [...report.matchAll(/^Page (?:\d+|unknown), line \d+$/gmu)];
  const contexts = [...report.matchAll(/^Context: (.*)$/gmu)].map((match) => match[1]);
  const lines = new Set(output.split("\n"));
  assert.equal(originals.length, result.posScan.contextCount);
  assert.equal(pages.length, originals.length);
  assert.equal(contexts.length, originals.length);
  assert.ok(originals.every((line) => lines.has(line)));
  assert.ok(contexts.every((context) => context.includes("{F}")));
}

test("the shipped Zawgyi book receives a POS report for the final output", async () => {
  const actual = await run(SAMPLE);
  assert.equal(actual.result.encodingPath, "zawgyi-one");
  assert.ok(actual.result.posScan.contextCount > 0);
  assertReportMatchesOutput(actual);
});
