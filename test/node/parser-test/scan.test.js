import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { scanText, formatScanReport, loadMap, dictionaryWords, scanBrokenSpans } from "../../../Parser/main/parser/text/scan.mjs";

test("JavaScript scanner mirrors the structural scan rules", () => {
  const report = scanText("ကိ ိ သွားသွားသွား", { dictionary: new Set(["ကိ"]) });
  assert.equal(report.orphan.total, 1);
  assert.equal(report.repeat.total, 1);
  assert.equal(report.unknown.total, 1);
  assert.ok(report.orphan.clusters[0].context.includes("ကိ"));
  assert.match(formatScanReport(report, { source: "sample.txt" }), /context:/u);
  assert.match(formatScanReport(report, { source: "sample.txt" }), /praser scan {2}sample\.txt/u);
});

test("sealed master map is loaded only by an explicit scanner dictionary request", () => {
  // Derived from this file, not the cwd: the old cwd-relative
  // "Parsed/parser/model/..." only resolved from the site repo root.
  const data = loadMap(fileURLToPath(new URL("../../../.data/master.json.enc", import.meta.url)));
  const words = dictionaryWords(data);
  assert.deepEqual(Object.keys(data), ["dictionary", "top", "resolution", "syllables", "mapData"]);
  assert.ok(words.size > 1000);
});
