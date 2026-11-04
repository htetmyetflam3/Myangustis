import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getEngineNormalize } from "../../../B.Parser/_path.js";
import { arrangeZawCodeOrder, orderZawCodePages } from "../../../B.Parser/main/parser/text/zawcode-order.js";
import { repairFromScanVerdict } from "../../../B.Parser/main/parser/text/repair.js";
import { scanText } from "../../../B.Parser/main/parser/text/scan.js";
import { choosePageParser, markOrderAligned, normalizePageLines } from "../../../B.Parser/main/parser/text/page-decision.js";
import { normalizeOutputText, protectedCharacters } from "../../../B.Parser/main/parser/text/preserved-transform.js";
import {
  convertFinalizedPageText, finishPageToFile, normalizePageToFile,
} from "../../../B.Parser/main/parser/text/page-file-decision.js";
import { Rabbit } from "../../../B.Parser/main/parser/text/rabbit.js";

const E = "\u1031";
const RA = "\u103C";
const YA = "\u103B";

function codePoints(text) {
  return Array.from(text).sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
}

test("the four indexed patterns preserve position zero", () => {
  for (const [input, expected] of [
    ["Xေကာ", "Xကာေ"],
    ["Xေြက", "Xကြေ"],
    ["Xြက", "Xကြ"],
    ["Xေက", "Xကေ"],
  ]) {
    assert.equal(arrangeZawCodeOrder(input), expected, input);
    assert.deepEqual(codePoints(arrangeZawCodeOrder(input)), codePoints(input));
  }
});

test("the four patterns can start at the beginning of a line", () => {
  assert.equal(arrangeZawCodeOrder("ေကာ"), "ကာေ");
  assert.equal(arrangeZawCodeOrder("ေြက"), "ကြေ");
  assert.equal(arrangeZawCodeOrder("ြက"), "ကြ");
  assert.equal(arrangeZawCodeOrder("ေက"), "ကေ");
});

test("the eight supplied indexed swaps produce the stated sequences", () => {
  const prefix = "X";
  const aa = "\u102c";
  for (const [base, secondBase] of [["\u1000", "\u1001"], ["\u1000", "\u1000"]]) {
    const patterns = [
      [E + base + aa, base + aa + E],
      [E + RA + base, base + RA + E],
      [RA + base, base + RA],
      [E + base, base + E],
      [E + RA + base + E + secondBase, base + RA + E + secondBase + E],
      [E + base + secondBase + aa, base + E + secondBase + aa],
      [base + aa + RA + secondBase, base + aa + secondBase + RA],
      [RA + base + E + RA + secondBase, base + RA + secondBase + RA + E],
    ];
    for (const [input, expected] of patterns) {
      const result = arrangeZawCodeOrder(prefix + input);
      assert.equal(result, prefix + expected);
      assert.deepEqual(codePoints(result), codePoints(prefix + input));
      const chars = Array.from(prefix + input);
      for (let i = 0; i <= chars.length; i += 1) {
        const withZeroWidth = [...chars.slice(0, i), "\u200b", ...chars.slice(i)].join("");
        assert.equal(arrangeZawCodeOrder(withZeroWidth), prefix + expected, `zero width at ${i}`);
      }
      assert.equal(arrangeZawCodeOrder(chars.join("\u200b\u200b")), prefix + expected);
    }
  }
});

test("rule 4 leaves characters outside its pattern in place", () => {
  for (const suffix of [YA, "\u103a\u1037", "\u103a\u1038", RA + "\u102c"]) {
    const input = "X" + E + "\u1000" + suffix;
    const expected = "X" + "\u1000" + E + suffix;
    const result = arrangeZawCodeOrder(input);
    assert.equal(result, expected);
    assert.deepEqual(codePoints(result), codePoints(input));
  }
});

test("rule 4 leaves a following base and 3B outside its pattern", () => {
  for (const [base1, base2] of [["က", "မ"], ["ဣ", "ဥ"], ["ဦ", "ဪ"]]) {
    const input = "X" + E + base1 + base2 + YA + "ို";
    const expected = "X" + base1 + E + base2 + YA + "ို";
    const result = arrangeZawCodeOrder(input);
    assert.equal(result, expected);
    assert.deepEqual(codePoints(result), codePoints(input));
  }
});

test("the eighth supplied pattern becomes 021543", () => {
  for (const [base1, base2] of [["က", "ခ"], ["ဣ", "ဥ"], ["ဿ", "၎"]]) {
    const input = "X" + RA + base1 + E + RA + base2 + "ို";
    const expected = "X" + base1 + RA + base2 + RA + E + "ို";
    const result = arrangeZawCodeOrder(input);
    assert.equal(result, expected);
    assert.deepEqual(codePoints(result), codePoints(input));
  }
});

test("supplied patterns are arranged before per-line normalize", () => {
  const inputs = [E + "က" + "မ" + YA, RA + "က" + E + RA + "ခ"];
  const expected = ["က" + E + "မ" + YA, "က" + RA + "ခ" + RA + E];
  const calls = [];
  const pages = [{ text: inputs.join("\n") }];
  const result = orderZawCodePages(pages, {}, { path: "zawcode" });
  assert.equal(result[0].text, expected.join("\n"));
  const output = normalizeOutputText(result[0].text, (line) => { calls.push(line); return line; });
  assert.deepEqual(calls, expected);
  assert.equal(output, expected.join("\n"));
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
    assert.equal(arrangeZawCodeOrder(E + base + "\u102c"), base + "\u102c" + E, base);
    assert.equal(arrangeZawCodeOrder(E + base + YA), base + E + YA, base);
    for (const tone of ["\u1037", "\u1038"]) {
      assert.equal(arrangeZawCodeOrder(E + base + "\u103a" + tone), base + E + "\u103a" + tone, base);
    }
  }
  for (const cp of [0x1022, 0x1024, 0x1028]) {
    const ch = String.fromCodePoint(cp);
    assert.equal(arrangeZawCodeOrder(E + ch), E + ch, `U+${cp.toString(16)}`);
  }
});

test("ZawCode swaps trim U+200B but do not cross lines or other characters", () => {
  assert.equal(arrangeZawCodeOrder("ေ\nက"), "ေ\nက");
  assert.equal(arrangeZawCodeOrder("ေ\u200bက"), "ကေ");
  assert.equal(arrangeZawCodeOrder("\u200bေက\u200b"), "ကေ");
  assert.equal(arrangeZawCodeOrder("ေ\u200bေက"), "ေေက");
  assert.equal(arrangeZawCodeOrder("ေ\u200cက"), "ေ\u200cက");
  assert.throws(() => arrangeZawCodeOrder(null), TypeError);
});

test("the checkpoint chooses a lane using a zero-width-free comparison", () => {
  for (const sample of ["", "Page-1", "English text", "jrefrmo'gtwGJ (1)? tcef; (1)trSmpmjrefrmo'gukd", "ေက"]) {
    const withZeroWidth = `\u200b${Array.from(sample).join("\u200b")}\u200b`;
    const probe = { shared: withZeroWidth };
    assert.deepEqual(choosePageParser(probe), choosePageParser({ shared: sample }), sample);
    assert.equal(probe.shared, withZeroWidth);
  }
});

test("scan ordering is ZawCode-only and requires a scan verdict", () => {
  const pages = [{ text: "ေသမှ" }];
  for (const path of [null, "unicode", "zawgyi-one", "wininnwa", "ayar"]) {
    assert.equal(orderZawCodePages(pages, {}, { path }), pages);
  }
  assert.equal(orderZawCodePages(pages, null, { path: "zawcode" }), pages);
  assert.throws(() => normalizeOutputText(pages[0].text, null), TypeError);
});

test("repair ordering precedes normalize once per line", () => {
  const source = "ေသမှ\nေကျိ";
  const pages = [{ text: source, lines: [[1, 2, 10, "ေသမှ"], [3, 4, 10, "ေကျိ"]] }];
  const calls = [];
  const normalize = (line) => { calls.push(line); return `<${line}>`; };
  const result = orderZawCodePages(pages, {}, { path: "zawcode" });
  assert.deepEqual(calls, []);
  assert.equal(result[0].text, "သေမှ\nကေျိ");
  assert.deepEqual(result[0].lines, [[1, 2, 10, "သေမှ"], [3, 4, 10, "ကေျိ"]]);
  assert.equal(normalizeOutputText(result[0].text, normalize), "<သေမှ>\n<ကေျိ>");
  assert.deepEqual(calls, ["သေမှ", "ကေျိ"]);
  assert.equal(pages[0].text, source);
});

test("Engine normalize, not mapperNormalize, follows repair ordering", async () => {
  const normalize = await getEngineNormalize();
  const engine = await import("../../../Architecture/Engine/MonoSyllabism/map/loader.js");
  assert.equal(normalize, engine.normalize);
  assert.notEqual(normalize, engine.mapperNormalize);
  const source = "ေသမှ\nေြကိ\nေကျိ";
  const pages = [{ text: source, lines: source.split("\n").map((line) => [0, 0, 10, line]) }];
  const result = orderZawCodePages(pages, scanText(source), { path: "zawcode" });
  assert.equal(result[0].text, "သေမှ\nကြေိ\nကေျိ");
  assert.equal(normalizeOutputText(result[0].text, normalize), "သေမှ\nကြေိ\nကေျိ");
  assert.deepEqual(result[0].lines.map((line) => line[3]), result[0].text.split("\n"));
  // Only the chosen ZawCode swap trims U+200B; normalization stays separate.
  assert.equal(arrangeZawCodeOrder("\u200bေက"), "ကေ");
  const ordered = orderZawCodePages([{ text: "\u200bေက" }], {}, { path: "zawcode" });
  assert.equal(ordered[0].text, "ကေ");
  assert.equal(normalizeOutputText(ordered[0].text, normalize), normalize(ordered[0].text));
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
  const result = orderZawCodePages(existing, report, { path: "zawcode" });
  assert.equal(normalizeOutputText(result[0].text, normalize), "ကေှ သူ့အား");
  assert.equal(result[0].lines[0][3], result[0].text);
});

test("Unicode mark order ignores spaces and accepts canonical asat order", () => {
  assert.equal(markOrderAligned("ပြည့်"), true);
  assert.equal(markOrderAligned("ပြည့်"), true);
  assert.equal(markOrderAligned("က ျ ေ း"), true);
  assert.equal(markOrderAligned("ကိ ျ"), false);
  assert.equal(markOrderAligned("ေ က"), false);
});

test("the lane decision ignores U+200B without trimming non-ZawCode text", async () => {
  const normalize = await getEngineNormalize();
  const zeroWidth = "\u200b";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zawcode-page-test-"));
  const finish = (input, options = {}) => {
    const store = { *lines() { yield [0, 0, 10, input]; } };
    const result = finishPageToFile(store, { directory: dir, parsingPath: "zawgyi-one", ...options });
    let output;
    try {
      const parsed = [...result.text.chunks()].join("");
      output = normalizePageToFile(result.text.chunks(), { directory: dir, normalize });
      return { decision: result.decision, parsed, text: [...output.chunks()].join("") };
    } finally { output?.close(); result.text.close(); }
  };
  try {
    const unchanged = finish(zeroWidth + "ြ");
    assert.equal(unchanged.decision, "aligned");
    assert.equal(unchanged.parsed, zeroWidth + "ြ");
    assert.equal(unchanged.text, normalize(unchanged.parsed));
    const ordered = finish(zeroWidth + "ြ" + zeroWidth + "က");
    assert.equal(ordered.decision, "zawcode");
    assert.equal(ordered.parsed, "ကြ");
    assert.equal(ordered.text, normalize(ordered.parsed));
    const otherFormats = "\u200c\u200d\u034f";
    const mixed = finish(zeroWidth + otherFormats + "ြက");
    assert.equal(mixed.decision, "zawcode");
    assert.equal(mixed.parsed, otherFormats + "ကြ");
    assert.equal(mixed.text, normalize(mixed.parsed));
    const unaligned = "ေ" + zeroWidth + "ကိျု";
    const unknown = finish(unaligned);
    assert.equal(unknown.decision, "unaligned-unknown");
    assert.equal(unknown.parsed, unaligned);
    const unicode = finish(unaligned, { fontKinds: new Set(["UNICODE"]) });
    assert.equal(unicode.decision, "unaligned-unicode");
    assert.equal(unicode.parsed, unaligned);
    const rabbit = finish(unaligned, { fontKinds: new Set(["ZAWGYI"]) });
    assert.equal(rabbit.decision, "rabbit");
    assert.equal(rabbit.parsed, Rabbit.zg2uni(unaligned, { preserveSpaces: true }));
    const glue = finish("#\u00a0\u200d");
    assert.equal(glue.parsed, "#\u00a0\u200d");
    assert.equal(glue.text, normalize(glue.parsed));
    const combiningJoiner = finish("\u034fစဥ်");
    assert.equal(combiningJoiner.text, normalize(combiningJoiner.parsed));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("finalized Unicode pages get Parser ordering without reopening the lane decision", () => {
  const unicode = { decision: "unaligned-unicode", category: "UNICODE" };
  assert.equal(convertFinalizedPageText("ေနွး", unicode, false), "နွေး");
  assert.equal(
    convertFinalizedPageText(" \u103C\u103D\u1001\u102D", unicode, false),
    " \u1001\u103C\u103D\u102D",
  );
  assert.equal(
    convertFinalizedPageText("ေနွး", { decision: "unaligned-unknown", category: "UNKNOWN" }, true),
    "ေနွး",
  );
  assert.equal(
    convertFinalizedPageText("ေနွး", { decision: "rabbit", category: "ZAWGYI" }, true),
    "နွေး",
  );
});

test("the PDF Rabbit lane uses Rabbit's own U+200B handling", async () => {
  const normalize = await getEngineNormalize();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rabbit-zero-width-test-"));
  try {
    assert.equal(protectedCharacters(" \u200b\u200c\u200d\u034f"), " \u200c\u200d\u034f");
    for (const source of [
      "\u200bျဖစ္သြားတယ္",
      "ျဖစ္သ\u200bြားတယ္ တူပါရဲ ႔၊",
      "\u200b\u200c\u200d\u034fျဖစ္သြားတယ္",
    ]) {
      const store = { *lines() { yield [0, 0, 10, source]; } };
      const result = finishPageToFile(store, {
        directory: dir, parsingPath: "zawgyi-one", sourceEncoding: "zawgyi-one", fontKinds: new Set(["ZAWGYI"]),
      });
      let output;
      try {
        const parsed = [...result.text.chunks()].join("");
        assert.equal(result.decision, "rabbit");
        assert.equal(parsed, Rabbit.zg2uni(source, { preserveSpaces: true }));
        assert.equal(parsed.includes("\u200b"), false);
        assert.equal((parsed.match(/ /gu) || []).length, (source.match(/ /gu) || []).length);
        output = normalizePageToFile(result.text.chunks(), { directory: dir, normalize });
        const finalText = [...output.chunks()].join("");
        assert.equal(finalText, normalize(parsed));
      } finally { output?.close(); result.text.close(); }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("final normalization passes each line to the normalizer and keeps its result", () => {
  const lines = ["\u200b\u200cက", "\u200d\u034fခ"];
  const source = lines.join("\n");
  const expected = "က\nခ\u200b";
  const calls = [];
  const normalize = (line) => {
    calls.push(line);
    return line === lines[0] ? "က" : "ခ\u200b";
  };
  assert.equal(normalizeOutputText(source, normalize), expected);
  assert.deepEqual(calls, lines);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-result-test-"));
  let output;
  try {
    calls.length = 0;
    output = normalizePageToFile([source.slice(0, 2), source.slice(2)], { directory, normalize });
    assert.equal([...output.chunks()].join(""), expected);
    assert.deepEqual(calls, lines);
  } finally { output?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("final Engine normalization keeps evidenced Pali and distinct glyph forms", async () => {
  const normalize = await getEngineNormalize();
  const source = ["ဥက္ကဋ္ဌ", "ပါဠိ", "သဒ္ဒါ", "တိံ", "သိင်္ဂီ", "ဝါစင်္ဂ", "ဦး", "ဉာဏ်ရည်", "၀", "၈", "၇"].join("\n");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pali-final-normalize-"));
  let output;
  try {
    output = normalizePageToFile([source], { directory, normalize });
    assert.equal([...output.chunks()].join(""), source);
  } finally { output?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("Rabbit conversion retains source spaces before a dot-below mark", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zawgyi-space-test-"));
  const source = "နားရြက္ေတြ တူပါရဲ ႔၊";
  const store = { *lines() { yield [0, 0, 10, source]; } };
  let result;
  try {
    result = finishPageToFile(store, { directory, parsingPath: "zawgyi-one", fontKinds: new Set(["ZAWGYI"]) });
    const text = [...result.text.chunks()].join("");
    assert.equal(result.decision, "rabbit");
    assert.equal(text, "နားရွက်တွေ တူပါရဲ ့၊");
    assert.equal((text.match(/ /gu) || []).length, (source.match(/ /gu) || []).length);
  } finally { result?.text.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("all PDF page decisions normalize only after the parsing decision", async () => {
  const normalize = await getEngineNormalize();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "final-page-normalize-"));
  const cases = [
    ["စဥ်", { parsingPath: "legacy" }, "legacy"],
    ["စဥ်", { parsingPath: "zawgyi-one" }, "aligned"],
    ["ေက", { parsingPath: "zawgyi-one" }, "zawcode"],
    ["ကိ ျ", { parsingPath: "zawgyi-one", fontKinds: new Set(["UNICODE"]) }, "unaligned-unicode"],
    ["ကိ ျ", { parsingPath: "zawgyi-one" }, "unaligned-unknown"],
    ["ကိ ျ", { parsingPath: "zawgyi-one", sourceEncoding: "zawgyi-one", fontKinds: new Set(["ZAWGYI"]) }, "rabbit"],
  ];
  try {
    for (const [source, options, decision] of cases) {
      const store = { *lines() { yield [0, 0, 10, source]; } };
      const page = finishPageToFile(store, { directory: dir, ...options });
      let output;
      try {
        assert.equal(page.decision, decision);
        const parsed = [...page.text.chunks()].join("");
        if (source === "စဥ်") assert.equal(parsed, source);
        const calls = [];
        output = normalizePageToFile(page.text.chunks(), {
          directory: dir, normalize: (line) => { calls.push(line); return normalize(line); },
        });
        assert.deepEqual(calls, [parsed]);
        assert.equal([...output.chunks()].join(""), normalize(parsed));
        if (source === "စဥ်") assert.equal([...output.chunks()].join(""), "စဉ်");
      } finally { output?.close(); page.text.close(); }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("final spacing follows the Engine normalize result", async () => {
  const normalize = await getEngineNormalize();
  for (const input of ["က ိ", "က  ခ"]) {
    assert.equal(normalizeOutputText(input, normalize), normalize(input));
  }
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
