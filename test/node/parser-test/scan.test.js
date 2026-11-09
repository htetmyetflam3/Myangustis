import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scanText, formatScanReport, PosScanner, scanTextWithPos, isPageNumberLine,
} from "../../../B.Parser/core/beautify/scan.js";
import { MAX_LINE_BYTES } from "../../../B.Parser/extend/bind-engine.js";

test("JavaScript scanner retains the structural scan rules", () => {
  const report = scanText("ကိ ိ သွားသွားသွား");
  assert.equal(report.orphan.total, 1);
  assert.equal(report.repeat.total, 1);
  assert.ok(report.orphan.clusters[0].context.includes("ကိ"));
  assert.match(formatScanReport(report, { source: "sample.txt" }), /context:/u);
  assert.match(formatScanReport(report, { source: "sample.txt" }), /parser scan {2}sample\.txt/u);
});

test("only 1–4 digits on a line are tagged as possible page numbers", () => {
  for (const value of ["1", " 1234 ", "၁၂၃၄", "၀"]) assert.equal(isPageNumberLine(value), true, value);
  for (const value of ["", "12345", "၁၂၃၄၅", "12 34", "p1"]) assert.equal(isPageNumberLine(value), false, value);
});

test("the page writer finishes before POS tagging; only broken contexts remain in scan memory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-scan-test-"));
  const calls = [];
  const outputs = new Map([
    ["ကိ", "ကောင်းကင်{n}  စမ်းသပ်{v}  ကိ{F}  မြန်မာ{n}  စာ{n,p}"],
    ["ဃု", "ဤ{pn}  စာ{n,p}  ကိ{F}  ဃု{F}  ကောင်းကင်{n}  မြန်မာ{n}"],
    ["12345", "၁{count}  ၂{count}  ၃{count}  ၄{count}  ၅{count}"],
  ]);
  const bind = ({ sourceText, flag, log }) => {
    calls.push({ sourceText, flag, log });
    return (async function* () { yield { rawPos: outputs.get(sourceText) || "" }; })();
  };
  const scanner = new PosScanner({ directory: dir, bindEngine: bind });
  try {
    const tempDir = scanner.directory;
    await scanner.writePage(7, ["ကိ\n", "1234\n12345"]);
    await scanner.writePage(8, ["ဃု"]);
    assert.equal(calls.length, 0, "tagging begins only after the source writer is finished");
    assert.equal(fs.statSync(scanner.file).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(scanner.file, "utf8"), /--- Page 7 ---/u);
    const result = await scanner.finish();
    assert.equal(result.unknownCount, 3);
    assert.equal(result.contextCount, 2);
    assert.equal(result.memory, scanner.memory);
    assert.deepEqual(result.memory.map(({ page, line }) => ({ page, line })), [
      { page: 7, line: 1 },
      { page: 8, line: 1 },
    ]);
    assert.deepEqual(calls.map((call) => call.sourceText), ["ကိ", "12345", "ဃု"]);
    assert.ok(calls.every((call) => call.flag === "pos" && call.log === false));
    assert.match(result.memory[0].context, /ကောင်းကင်\{n\}  စမ်းသပ်\{v\}  ကိ\{F\}  မြန်မာ\{n\}/u);
    assert.match(result.memory[1].context, /ဤ\{pn\}  စာ\{n,p\}  ကိ\{F\}  ဃု\{F\}  ကောင်းကင်\{n\}  မြန်မာ\{n\}/u);
    assert.ok(result.memory.every((entry) => !("source" in entry) && !("rawPos" in entry)));
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal(fs.existsSync(tempDir), false);
  } finally {
    await scanner.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the real hash-free Engine supplies tags, explicit markers and numeric footers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-real-test-"));
  try {
    const explicit = await scanTextWithPos(
      "Page-12\nကောင်းကင် စမ်းသပ် ၐ မြန်မာ စာ။\n--- Page 10001 ---\nဤ စာ ၐ ၑ ကောင်းကင် မြန်မာ။",
    );
    assert.equal(explicit.unknownCount, 3);
    assert.deepEqual(explicit.memory.map(({ page, line }) => ({ page, line })), [
      { page: 12, line: 1 },
      { page: 10001, line: 1 },
    ]);
    assert.match(explicit.memory[0].context, /ကောင်းကင်\{n\}  စမ်းသပ်\{v\}  ၐ\{F\}  မြန်မာ\{n\}/u);
    assert.match(explicit.memory[1].context, /ဤ\{pn\}  စာ\{n,p\}  ၐ\{F\}  ၑ\{F\}  ကောင်းကင်\{n\}  မြန်မာ\{n\}/u);

    const fallback = await scanTextWithPos("ၐ\n၄\nၑ\n၅");
    assert.deepEqual(fallback.memory.map(({ page, line }) => ({ page, line })), [
      { page: 4, line: 1 },
      { page: 5, line: 1 },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("English does not become false Burmese unknowns; the source line stays intact", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-english-"));
  try {
    const result = await scanTextWithPos("English footer\nမြန်မာ Chapter ၐ", { page: 1 });
    assert.equal(result.unknownCount, 1);
    assert.deepEqual(result.memory.map(({ page, line }) => ({ page, line })), [
      { page: 1, line: 2 },
    ]);
    assert.match(result.memory[0].context, /မြန်မာ\{n\}  ၐ\{F\}/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("authoritative source pages are not replaced by text markers or numeric footers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-source-page-"));
  try {
    const result = await scanTextWithPos("Page-1\nၐ\n၃", { page: 42 });
    assert.deepEqual(result.memory.map(({ page, line }) => ({ page, line })), [
      { page: 42, line: 2 },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("failed POS tagging removes the private spool and writes no scan file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-failure-"));
  const scanner = new PosScanner({ directory: dir, bindEngine: () => (async function* () {
    throw new Error("test POS failure");
  })() });
  const tempDir = scanner.directory;
  try {
    await scanner.writePage(1, ["ကိ"]);
    await assert.rejects(scanner.finish(), /test POS failure/u);
    assert.equal(fs.existsSync(tempDir), false);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    await scanner.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("long POS lines are reported with their source location", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-long-line-"));
  const bind = () => (async function* () { yield { rawPos: "ကိ{F}" }; })();
  const scanner = new PosScanner({ directory: dir, bindEngine: bind });
  try {
    const long = "က".repeat(Math.floor(MAX_LINE_BYTES / 3) + 1);
    await scanner.writePage(9, ["short\n", long]);
    const result = await scanner.finish();
    assert.deepEqual(result.longLines, [{ page: 9, line: 2 }]);
    assert.equal(result.unknownCount, 1);
  } finally {
    await scanner.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
