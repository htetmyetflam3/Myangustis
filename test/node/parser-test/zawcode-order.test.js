import test from "node:test";
import assert from "node:assert/strict";
import { getEngineNormalize } from "../../../B.Parser/_path.js";
import { arrangeZawCodeOrder, orderZawCodePages } from "../../../B.Parser/main/parser/text/zawcode-order.js";
import { repairFromScanVerdict } from "../../../B.Parser/main/parser/text/repair.js";
import { scanText } from "../../../B.Parser/main/parser/text/scan.js";
import { finishSharedPage, markOrderAligned, normalizePageLines } from "../../../B.Parser/main/parser/text/page-decision.js";

const E = "\u1031";
const RA = "\u103C";
const YA = "\u103B";

function codePoints(text) {
  return Array.from(text).sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
}

test("the four indexed patterns preserve position zero", () => {
  for (const [input, expected] of [
    ["Xေကျ", "Xကျေ"],
    ["Xေြက", "Xကြေ"],
    ["Xြက", "Xကြ"],
    ["Xေက", "Xကေ"],
  ]) {
    assert.equal(arrangeZawCodeOrder(input), expected, input);
    assert.deepEqual(codePoints(arrangeZawCodeOrder(input)), codePoints(input));
  }
});

test("the four patterns can start at the beginning of a line", () => {
  assert.equal(arrangeZawCodeOrder("ေကျ"), "ကျေ");
  assert.equal(arrangeZawCodeOrder("ေြက"), "ကြေ");
  assert.equal(arrangeZawCodeOrder("ြက"), "ကြ");
  assert.equal(arrangeZawCodeOrder("ေက"), "ကေ");
});

test("safety pattern 01234 becomes 02134", () => {
  for (const [base1, base2] of [["က", "မ"], ["ဣ", "ဥ"], ["ဦ", "ဪ"]]) {
    const input = "X" + E + base1 + base2 + YA + "ို";
    const expected = "X" + base1 + E + base2 + YA + "ို";
    const result = arrangeZawCodeOrder(input);
    assert.equal(result, expected);
    assert.deepEqual(codePoints(result), codePoints(input));
  }
});

test("safety pattern 012345 becomes 021543", () => {
  for (const [base1, base2] of [["က", "ခ"], ["ဣ", "ဥ"], ["ဿ", "၎"]]) {
    const input = "X" + RA + base1 + E + RA + base2 + "ို";
    const expected = "X" + base1 + RA + base2 + RA + E + "ို";
    const result = arrangeZawCodeOrder(input);
    assert.equal(result, expected);
    assert.deepEqual(codePoints(result), codePoints(input));
  }
});

test("safety patterns are arranged before per-line normalize", () => {
  const inputs = [E + "က" + "မ" + YA, RA + "က" + E + RA + "ခ"];
  const expected = ["က" + E + "မ" + YA, "က" + RA + "ခ" + RA + E];
  const calls = [];
  const pages = [{ text: inputs.join("\n") }];
  const result = orderZawCodePages(pages, {}, {
    path: "zawcode", normalize: (line) => { calls.push(line); return line; },
  });
  assert.deepEqual(calls, expected);
  assert.equal(result[0].text, expected.join("\n"));
});

test("a previous e cannot be position zero for a new pattern", () => {
  assert.equal(arrangeZawCodeOrder("ေေက"), "ေေက");
  assert.equal(arrangeZawCodeOrder("ေေြက"), "ေေြက");
});

test("other characters, marks and bases are not added or converted", () => {
  const source = "+😀ေကမျို ြကိုု";
  const result = arrangeZawCodeOrder(source);
  assert.equal(result, "+😀ကေမျို ကြိုု");
  assert.deepEqual(codePoints(result), codePoints(source));
  assert.equal(result.split("\u002B").length - 1, 1);
  assert.equal(result.split(YA).length - 1, 1);
  assert.equal(arrangeZawCodeOrder("ေသမှ"), "သေမှ");
  assert.equal(arrangeZawCodeOrder("ေကမျို"), "ကေမျို");
});

test("there is no maximum counter or search across intervening marks", () => {
  const marks = "ိ".repeat(20);
  assert.equal(arrangeZawCodeOrder(`ေက${marks}ေခ`), `ကေ${marks}ခေ`);
  assert.equal(arrangeZawCodeOrder("ေကိျု"), "ကေိျု");
  assert.equal(arrangeZawCodeOrder("ေကြိုခ့"), "ကေြိုခ့");
  assert.equal(arrangeZawCodeOrder("ေကြခိ့"), "ကေခြိ့");
});

test("base matching uses the Engine MMap.Base inventory", async () => {
  const { MMap } = await import("../../../Architecture/Engine/MonoSyllabism/map/loader.js");
  const { getMasterMapData } = await import("../../../B.Parser/main/parser/text/cleanup.js");
  assert.deepEqual(getMasterMapData().MMap.Base, MMap.Base);
  assert.ok(MMap.Base.includes("ဣ"));
  for (const base of MMap.Base) {
    assert.equal(arrangeZawCodeOrder(E + base), base + E, base);
    assert.equal(arrangeZawCodeOrder(RA + base), base + RA, base);
    assert.equal(arrangeZawCodeOrder(E + RA + base), base + RA + E, base);
    assert.equal(arrangeZawCodeOrder(E + base + YA), base + YA + E, base);
  }
  for (const cp of [0x1022, 0x1024, 0x1028]) {
    const ch = String.fromCodePoint(cp);
    assert.equal(arrangeZawCodeOrder(E + ch), E + ch, `U+${cp.toString(16)}`);
  }
});

test("patterns do not cross line breaks or invisible characters", () => {
  assert.equal(arrangeZawCodeOrder("ေ\nက"), "ေ\nက");
  assert.equal(arrangeZawCodeOrder("ေ\u200bက"), "ေ\u200bက");
  assert.equal(arrangeZawCodeOrder("\u200bေက"), "\u200bကေ");
  assert.throws(() => arrangeZawCodeOrder(null), TypeError);
});

test("scan ordering is ZawCode-only and requires a scan verdict", () => {
  const pages = [{ text: "ေသမှ" }];
  const unexpected = () => { throw new Error("normalizer should not be called"); };
  for (const path of [null, "unicode", "zawgyi-one", "wininnwa", "ayar"]) {
    assert.equal(orderZawCodePages(pages, {}, { path, normalize: unexpected }), pages);
  }
  assert.equal(orderZawCodePages(pages, null, { path: "zawcode", normalize: unexpected }), pages);
  assert.throws(() => orderZawCodePages(pages, {}, { path: "zawcode" }), TypeError);
});

test("repair ordering precedes normalize once per line", () => {
  const source = "ေသမှ\nေကျိ";
  const pages = [{ text: source, lines: [[1, 2, 10, "ေသမှ"], [3, 4, 10, "ေကျိ"]] }];
  const calls = [];
  const normalize = (line) => { calls.push(line); return `<${line}>`; };
  const result = orderZawCodePages(pages, {}, { path: "zawcode", normalize });
  assert.deepEqual(calls, ["သေမှ", "ကျေိ"]);
  assert.equal(result[0].text, "<သေမှ>\n<ကျေိ>");
  assert.deepEqual(result[0].lines, [[1, 2, 10, "<သေမှ>"], [3, 4, 10, "<ကျေိ>"]]);
  assert.equal(pages[0].text, source);
});

test("Engine normalize, not mapperNormalize, follows repair ordering", async () => {
  const normalize = await getEngineNormalize();
  const engine = await import("../../../Architecture/Engine/MonoSyllabism/map/loader.js");
  assert.equal(normalize, engine.normalize);
  assert.notEqual(normalize, engine.mapperNormalize);
  const source = "ေသမှ\nေြကိ\nေကျိ";
  const pages = [{ text: source, lines: source.split("\n").map((line) => [0, 0, 10, line]) }];
  const result = orderZawCodePages(pages, scanText(source), { path: "zawcode", normalize });
  assert.equal(result[0].text, "သေမှ\nကြေိ\nကျေိ");
  assert.deepEqual(result[0].lines.map((line) => line[3]), result[0].text.split("\n"));
  // The Engine normally removes glue; the page path must preserve it.
  assert.equal(arrangeZawCodeOrder("\u200bေက"), "\u200bကေ");
  assert.equal(orderZawCodePages([{ text: "\u200bေက" }], {}, { path: "zawcode", normalize })[0].text, "\u200bကေ");
});

test("existing scan repair still fixes tokens without an ordering pattern", async () => {
  const normalize = await getEngineNormalize();
  const source = "ေကှ သ့အား";
  const pages = [{ text: source, lines: [[0, 0, 10, source]] }];
  const report = scanText(source);
  const words = new Set(["ကှေ", "သူ့အား"]);
  const existing = repairFromScanVerdict(pages, report, words, {
    path: "zawcode", preserveZawCodeOrder: true,
  });
  assert.equal(existing[0].text, "ေကှ သူ့အား");
  const result = orderZawCodePages(existing, report, { path: "zawcode", normalize });
  assert.equal(result[0].text, "ကေှ သူ့အား");
  assert.equal(result[0].lines[0][3], result[0].text);
});

test("Unicode mark order ignores spaces and accepts canonical asat order", () => {
  assert.equal(markOrderAligned("ပြည့်"), true);
  assert.equal(markOrderAligned("ပြည့်"), true);
  assert.equal(markOrderAligned("က ျ ေ း"), true);
  assert.equal(markOrderAligned("ကိ ျ"), false);
  assert.equal(markOrderAligned("ေ က"), false);
});

test("pass-through and ZawCode normalizers preserve zero-width characters", async () => {
  const normalize = await getEngineNormalize();
  const zeroWidth = "\u200b";
  const unchanged = finishSharedPage(zeroWidth + "ြ", { normalize });
  assert.equal(unchanged.decision, "aligned");
  assert.equal(unchanged.text, zeroWidth + "ြ");
  const ordered = finishSharedPage(zeroWidth + "ြက", { normalize });
  assert.equal(ordered.decision, "zawcode");
  assert.equal(ordered.text, zeroWidth + "ကြ");
  assert.equal(finishSharedPage("#\u00a0\u200d", { normalize }).text, "#\u00a0\u200d");
});

test("normalization is a lazy generator with one Engine call per line", () => {
  const calls = [];
  const lines = normalizePageLines("one\ntwo\n", (line) => { calls.push(line); return line; });
  assert.deepEqual(calls, []);
  assert.equal(lines.next().value, "one");
  assert.deepEqual(calls, ["one"]);
  assert.deepEqual([...lines], ["two", ""]);
  assert.deepEqual(calls, ["one", "two", ""]);
});
