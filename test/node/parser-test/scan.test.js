import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scanText, formatScanReport, PosScanner, scanTextWithPos, isPageNumberLine,
} from "../../../B.Parser/main/parser/text/scan.js";
import { MAX_LINE_BYTES } from "../../../Architecture/Engine/MonoSyllabism/generators/SfomatterForP.js";

test("JavaScript scanner retains the structural scan rules", () => {
  const report = scanText("ကိ ိ သွားသွားသွား");
  assert.equal(report.orphan.total, 1);
  assert.equal(report.repeat.total, 1);
  assert.ok(report.orphan.clusters[0].context.includes("ကိ"));
  assert.match(formatScanReport(report, { source: "sample.txt" }), /context:/u);
  assert.match(formatScanReport(report, { source: "sample.txt" }), /praser scan {2}sample\.txt/u);
});

test("only 1–4 digits on a line are tagged as possible page numbers", () => {
  for (const value of ["1", " 1234 ", "၁၂၃၄", "၀"]) assert.equal(isPageNumberLine(value), true, value);
  for (const value of ["", "12345", "၁၂၃၄၅", "12 34", "p1"]) assert.equal(isPageNumberLine(value), false, value);
});

test("the page writer finishes before POS tagging; only unknown contexts remain on disk", async () => {
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
    const result = await scanner.finish(path.join(dir, "document.pdf"));
    assert.equal(result.unknownCount, 3);
    assert.equal(result.contextCount, 2);
    assert.deepEqual(calls.map((call) => call.sourceText), ["ကိ", "12345", "ဃု"]);
    assert.ok(calls.every((call) => call.flag === "pos" && call.log === false));
    const report = fs.readFileSync(result.file, "utf8");
    assert.match(report, /Page 7, line 1\nOriginal: ကိ\nContext: ကောင်းကင်\{n\}  စမ်းသပ်\{v\}  ကိ\{F\}  မြန်မာ\{n\}/u);
    assert.match(report, /Page 8, line 1\nOriginal: ဃု\nContext: ဤ\{pn\}  စာ\{n,p\}  ကိ\{F\}  ဃု\{F\}  ကောင်းကင်\{n\}  မြန်မာ\{n\}/u);
    assert.doesNotMatch(report, /12345/u);
    assert.equal(fs.statSync(result.file).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(tempDir), false);
  } finally {
    await scanner.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the real hash-free Engine supplies tags, explicit markers and numeric footers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-real-test-"));
  try {
    const outputPath = path.join(dir, "document.txt");
    const explicit = await scanTextWithPos(
      "Page-12\nကောင်းကင် စမ်းသပ် ၐ မြန်မာ စာ။\n--- Page 10001 ---\nဤ စာ ၐ ၑ ကောင်းကင် မြန်မာ။",
      { outputPath },
    );
    assert.equal(explicit.unknownCount, 3);
    const report = fs.readFileSync(explicit.file, "utf8");
    assert.match(report, /Page 12, line 1\nOriginal: ကောင်းကင် စမ်းသပ် ၐ မြန်မာ စာ။/u);
    assert.match(report, /Context: ကောင်းကင်\{n\}  စမ်းသပ်\{v\}  ၐ\{F\}  မြန်မာ\{n\}/u);
    assert.match(report, /Page 10001, line 1[\s\S]*ဤ\{pn\}  စာ\{n,p\}  ၐ\{F\}  ၑ\{F\}  ကောင်းကင်\{n\}  မြန်မာ\{n\}/u);

    const fallback = await scanTextWithPos("ၐ\n၄\nၑ\n၅", { outputPath });
    const fallbackReport = fs.readFileSync(fallback.file, "utf8");
    assert.match(fallbackReport, /Page 4, line 1\nOriginal: ၐ/u);
    assert.match(fallbackReport, /Page 5, line 1\nOriginal: ၑ/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("English does not become false Burmese unknowns; the source line stays intact", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-english-"));
  try {
    const result = await scanTextWithPos("English footer\nမြန်မာ Chapter ၐ", {
      page: 1, outputPath: path.join(dir, "book.pdf"),
    });
    assert.equal(result.unknownCount, 1);
    const report = fs.readFileSync(result.file, "utf8");
    assert.match(report, /Page 1, line 2\nOriginal: မြန်မာ Chapter ၐ/u);
    assert.match(report, /Context: မြန်မာ\{n\}  ၐ\{F\}/u);
    assert.doesNotMatch(report, /English footer/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("authoritative source pages are not replaced by text markers or numeric footers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-source-page-"));
  try {
    const result = await scanTextWithPos("Page-1\nၐ\n၃", { page: 42, outputPath: path.join(dir, "book.pdf") });
    assert.match(fs.readFileSync(result.file, "utf8"), /Page 42, line 2\nOriginal: ၐ/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("failed POS tagging removes private spools and leaves an existing report untouched", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-failure-"));
  const outputPath = path.join(dir, "book.pdf");
  const report = `${outputPath}.unknown.txt`;
  fs.writeFileSync(report, "previous result", { mode: 0o600 });
  const scanner = new PosScanner({ directory: dir, bindEngine: () => (async function* () {
    throw new Error("test POS failure");
  })() });
  const tempDir = scanner.directory;
  try {
    await scanner.writePage(1, ["ကိ"]);
    await assert.rejects(scanner.finish(outputPath), /test POS failure/u);
    assert.equal(fs.existsSync(tempDir), false);
    assert.equal(fs.readFileSync(report, "utf8"), "previous result");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["book.pdf.unknown.txt"]);
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
    const result = await scanner.finish(path.join(dir, "large.txt"));
    assert.deepEqual(result.longLines, [{ page: 9, line: 2 }]);
    assert.equal(result.unknownCount, 1);
  } finally {
    await scanner.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
