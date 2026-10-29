import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { scanText, formatScanReport, loadMap, dictionaryWords } from "../../../B.Parser/main/parser/text/scan.js";

test("JavaScript scanner mirrors the structural scan rules", () => {
  const report = scanText("ကိ ိ သွားသွားသွား", { dictionary: new Set(["ကိ"]) });
  assert.equal(report.orphan.total, 1);
  assert.equal(report.repeat.total, 1);
  assert.equal(report.unknown.total, 1);
  assert.ok(report.orphan.clusters[0].context.includes("ကိ"));
  assert.match(formatScanReport(report, { source: "sample.txt" }), /context:/u);
  assert.match(formatScanReport(report, { source: "sample.txt" }), /praser scan {2}sample\.txt/u);
});

test("sealed master map is loaded only by an explicit scanner dictionary request", { skip: process.env.MASTER_JSON_KEY ? false : "MASTER_JSON_KEY required for sealed dictionary" }, () => {


  const data = loadMap(fileURLToPath(new URL("../../../Architecture/Engine/.data/master.json.enc", import.meta.url)));
  const words = dictionaryWords(data);
  assert.deepEqual(Object.keys(data), ["dictionary", "top", "resolution", "syllables", "mapData"]);
  assert.ok(words.size > 1000);
});
