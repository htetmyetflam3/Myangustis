import test from "node:test";
import assert from "node:assert/strict";
import {
  HOMOGLYPH_PAIRS, homoglyphVariants, repairToken, repairHomoglyphs,
} from "../../../B.Parser/main/parser/text/repair.js";

const words = new Set(["စဉ်", "အစဉ်", "လုံးဝ", "ဝဂ်", "ယာဉ်", "ရေ"]);

test("the three legacy homoglyph pairs are loaded", () => {
  assert.equal(HOMOGLYPH_PAIRS.length, 3);
  assert.deepEqual(HOMOGLYPH_PAIRS[0], ["\u101D", "\u1040"]);
  assert.deepEqual(HOMOGLYPH_PAIRS[1], ["\u101B", "\u1047"]);
  assert.deepEqual(HOMOGLYPH_PAIRS[2], ["\u1009", "\u1025"]);
});

test("variants swap in both directions and never include the input", () => {
  const v = homoglyphVariants("စဥ်");
  assert.ok(v.includes("စဉ်"), "ဥ -> ဉ");
  assert.ok(!v.includes("စဥ်"), "input excluded");
  assert.ok(homoglyphVariants("လုံး\u1040").includes("လုံးဝ"), "၀ -> ဝ");
  assert.ok(homoglyphVariants("လုံးဝ").includes("လုံး\u1040"), "ဝ -> ၀, reverse");
});

test("a token already in the dictionary is never touched", () => {
  assert.equal(repairToken("စဉ်", words), null);
  assert.equal(repairToken("လုံးဝ", words), null);
});

test("a single resolving variant is the repair", () => {
  assert.equal(repairToken("စဥ်", words), "စဉ်");
  assert.equal(repairToken("အစဥ်", words), "အစဉ်");
  assert.equal(repairToken("လုံး\u1040", words), "လုံးဝ");
});

test("a token with no resolving variant is left alone", () => {
  assert.equal(repairToken("ကကကက", words), null);
  assert.equal(repairToken("စဥ်ကကက", words), null);
});

test("ambiguity changes nothing", () => {

  const ambiguous = new Set(["ကဝခ", "က\u1040ခ"]);
  assert.equal(repairToken("ကဝခ", ambiguous), null);
});

test("an empty or missing dictionary is a no-op", () => {
  assert.equal(repairToken("စဥ်", new Set()), null);
  assert.equal(repairToken("စဥ်", null), null);
  assert.deepEqual(repairHomoglyphs("စဥ်", new Set()).repairs, []);
});

test("whole-text repair rewrites and tallies", () => {
  const { text, repairs } = repairHomoglyphs("အစဥ် နှင့် စဥ် နှင့် စဥ်", words);
  assert.equal(text, "အစဉ် နှင့် စဉ် နှင့် စဉ်");
  const total = repairs.reduce((n, r) => n + r.count, 0);
  assert.equal(total, 3);
  assert.equal(repairs[0].from, "စဥ်");
  assert.equal(repairs[0].to, "စဉ်");
  assert.equal(repairs[0].count, 2);
});

test("non-Myanmar text passes through untouched", () => {
  const src = "Chapter 7: hello world 2024";
  assert.equal(repairHomoglyphs(src, words).text, src);
});


import { splitGluedNumber, repairText } from "../../../B.Parser/main/parser/text/repair.js";

const toc = new Set(["သဒ္ဒါ", "ဝဂ်", "မျိုး", "စဉ်"]);

test("a trailing page number is split off a heading", () => {
  assert.deepEqual(splitGluedNumber("သဒ္ဒါ\u1041", toc), ["သဒ္ဒါ", "\u1041"]);
  assert.deepEqual(splitGluedNumber("ဝဂ်\u1043\u1048", toc), ["ဝဂ်", "\u1043\u1048"]);
});

test("a leading list marker is split off a heading", () => {
  assert.deepEqual(splitGluedNumber("\u1041\u104Bသဒ္ဒါ", toc), null, "။ is not part of the digit run");
  assert.deepEqual(splitGluedNumber("\u1041သဒ္ဒါ", toc), ["\u1041", "သဒ္ဒါ"]);
});

test("a token already in the dictionary is never split", () => {
  assert.equal(splitGluedNumber("သဒ္ဒါ", toc), null);
});

test("a split that leaves a non-word is refused", () => {
  assert.equal(splitGluedNumber("ကကက\u1041", toc), null);
  assert.equal(splitGluedNumber("\u1041\u1042\u1043", toc), null, "all digits, nothing left");
});

test("ambiguity at both ends changes nothing", () => {
  const both = new Set(["ကခ", "ဂဃ"]);
  assert.equal(splitGluedNumber("\u1041ကခ\u1042", both), null);
});

test("repairText applies swaps and splits together", () => {
  const words = new Set(["စဉ်", "သဒ္ဒါ"]);
  const { text, repairs, splits } = repairText("စဥ် သဒ္ဒါ\u1041", words);
  assert.equal(text, "စဉ် သဒ္ဒါ \u1041");
  assert.equal(repairs.reduce((n, r) => n + r.count, 0), 1);
  assert.equal(splits.reduce((n, r) => n + r.count, 0), 1);
});

test("repairText is a no-op without a dictionary", () => {
  assert.equal(repairText("သဒ္ဒါ\u1041", new Set()).text, "သဒ္ဒါ\u1041");
});




test("zawcode mend rewrites scan-flagged spans and nothing else", async () => {
  const { mendZawCodeText, mendZawCodeTextWithPos } = await import("../../../B.Parser/main/parser/text/repair.js");

  const line = "မြေတော်တွင် ကြေနပ်စွာ \u1014\u103C\u1031\u1015\u102E ကြေးဇူးပါ";
  const { text, repairs } = await mendZawCodeTextWithPos(line);
  assert.equal(text, "မြေတော်တွင် ကြေနပ်စွာ နေပြီ ကြေးဇူးပါ");
  assert.deepEqual(repairs, [{ from: "\u1014\u103C\u1031\u1015\u102E", to: "နေပြီ", count: 1 }]);


  assert.equal(mendZawCodeText(line, new Set()).text, line);
});

test("zawcode guard splits stored order by readable result, not font name", async () => {
  const { zawCodeGuard, zawCodeGuardWithPos } = await import("../../../B.Parser/main/parser/text/repair.js");

  const stored = Array(30).fill("\u1014\u103C\u1031\u1015\u102E").join(" ");
  const guard = await zawCodeGuardWithPos(stored);
  assert.equal(guard.zawcode, true, JSON.stringify(guard));
  assert.ok(guard.pureScore >= 0.99);
  assert.ok(guard.gain >= 2);

  const finished = Array(30).fill("နေပြီ").join(" ");
  assert.equal((await zawCodeGuardWithPos(finished)).zawcode, false);
  assert.equal(zawCodeGuard(stored, new Set()).zawcode, false);
});




test("zawcode insertion variants offer the dropped glyphs", async () => {
  const { zawCodeInsertionVariants, zawCodeSpuriousIVariants } = await import("../../../B.Parser/main/parser/text/repair.js");

  assert.ok(zawCodeInsertionVariants("\u1000\u1031\u102C\u1004\u103A\u1037")
    .includes("\u1000\u103C\u1031\u102C\u1004\u103A\u1037"));

  assert.ok(zawCodeInsertionVariants("\u1000\u103B\u102D\u1038")
    .includes("\u1000\u103B\u102D\u102F\u1038"));

  assert.ok(zawCodeInsertionVariants("အနတရာယ်").includes("အန္တရာယ်"));



  assert.ok(zawCodeInsertionVariants("\u101E\u1010\u102D\u102F\u1037")
    .includes("\u101E\u1030\u1010\u102D\u102F\u1037"));
  assert.ok(!zawCodeInsertionVariants("\u1001\u103C\u1031\u101E\u1037\u101B\u102F\u1015\u103A")
    .includes("\u1001\u103C\u1031\u101E\u1030\u1037\u101B\u102F\u1015\u103A"));

  assert.deepEqual(zawCodeSpuriousIVariants("\u101B\u102D\u102F\u1010\u103A\u1010\u101B\u1000\u103A"),
    ["\u101B\u102F\u1010\u103A\u1010\u101B\u1000\u103A"]);
  assert.equal(zawCodeSpuriousIVariants("ဂိုဏ်သတင်းကို").length, 2);
});

test("zawcode mend retraces misnamed and dropped glyphs at scan coordinates", async () => {
  const { mendZawCodeTextWithPos } = await import("../../../B.Parser/main/parser/text/repair.js");



  const damaged = "\u1004\u1019\u103D\u102D\u1032\u1037\u1010\u1031\u102C\u103A"
    + " \u101B\u102D\u102F\u1010\u103A\u1010\u101B\u1000\u103A"
    + " \u1011\u102D\u102F\u1037\u1000\u1031\u102C\u1004\u103A\u1037";
  const mended = "\u1019\u103C\u102D\u102F\u1037\u1010\u1031\u102C\u103A"
    + " \u101B\u102F\u1010\u103A\u1010\u101B\u1000\u103A"
    + " \u1011\u102D\u102F\u1037\u1000\u103C\u1031\u102C\u1004\u103A\u1037";
  const { text, repairs } = await mendZawCodeTextWithPos(damaged);
  // The POS tree still marks the historical third replacement unknown. Keep
  // that source token instead of treating an unconfirmed candidate as valid.
  const expected = mended.split(" ");
  expected[2] = damaged.split(" ")[2];
  assert.equal(text, expected.join(" "));
  assert.equal(repairs.length, 2);


  assert.equal(
    (await mendZawCodeTextWithPos("\u1021\u1031\u1010\u103D\u1037")).text,
    "\u1021\u1010\u103D\u1031\u1037",
  );




  const healthy = "မြေတော်တွင် ကြေနပ်စွာ ကြေးဇူးပါ အယူအဆကို တန်ခိုး"
    + " \u1001\u103C\u1031\u101E\u1037\u101B\u102F\u1015\u103A\u1019\u103B\u102C\u1038"
    + " \u1000\u101E\u100A\u103A";
  const untouched = await mendZawCodeTextWithPos(healthy);
  assert.equal(untouched.text, healthy);
  assert.deepEqual(untouched.repairs, []);
});

test("zawcode mend frames cover the damage that still segments", async () => {
  const { mendZawCodeTextWithPos } = await import("../../../B.Parser/main/parser/text/repair.js");




  const damaged = "\u101E\u1010\u102D\u102F\u1037\u101E\u100A\u103A"
    + " \u101E\u1037\u1021\u102C\u1038"
    + " \u1021\u1031\u101B\u1031\u1038";
  const mended = "\u101E\u1030\u1010\u102D\u102F\u1037\u101E\u100A\u103A"
    + " \u101E\u1030\u1037\u1021\u102C\u1038"
    + " \u1021\u101B\u1031\u1038";
  assert.equal((await mendZawCodeTextWithPos(damaged)).text, mended);




  assert.equal((await mendZawCodeTextWithPos("\u101E\u1037")).text, "\u101E\u1037");
  const lion = "\u1001\u103C\u1031\u101E\u1037\u101B\u102F\u1015\u103A\u1019\u103B\u102C\u1038";
  assert.equal((await mendZawCodeTextWithPos(lion)).text, lion);
  const stranded = "\u101E\u1031\u1010\u102C\u103A\u1005\u1004\u103A\u101C\u1019\u103A\u1038\u1005\u1009\u103A";
  assert.equal((await mendZawCodeTextWithPos(stranded)).text, stranded);
});

test("repairFromScanVerdict mends only the zawcode path, text and lines together", async () => {
  const { repairFromPosVerdict } = await import("../../../B.Parser/main/parser/text/repair.js");
  const line = "မြေတော်တွင် \u1014\u103C\u1031\u1015\u102E ကြေးဇူးပါ";
  const pages = [{ text: line, lines: [[0, 0, 10, line]], wh: [1, 1] }];


  assert.equal(await repairFromPosVerdict(pages, { path: "wininnwa" }), pages);
  assert.equal(await repairFromPosVerdict(pages, { path: "unicode" }), pages);

  const mended = await repairFromPosVerdict(pages, { path: "zawcode" });
  assert.equal(mended[0].text, "မြေတော်တွင် နေပြီ ကြေးဇူးပါ");
  assert.equal(mended[0].lines[0][3], mended[0].text);



  const split = [{
    text: "ကြည့်\u1014\u103C\u1031ကသည်",
    lines: [[0, 0, 10, "ကြည့် \u1014\u103C\u1031ကသည်"]],
  }];
  const splitMended = await repairFromPosVerdict(split, { path: "zawcode" });
  // The prefix is still {?} to POS, so do not certify or rewrite this span.
  assert.equal(splitMended[0].text, split[0].text);
  assert.equal(splitMended[0].lines[0][3], split[0].lines[0][3]);
});

test("production repair uses POS-confirmed candidates without changing standalone Myanmar digits", async () => {
  const { repairTextWithPos } = await import("../../../B.Parser/main/parser/text/repair.js");
  const result = await repairTextWithPos("စဥ် သဒ္ဒါ၁ လုံး၀ ၀ ၇ ဝ ရ");
  assert.equal(result.text, "စဉ် သဒ္ဒါ ၁ လုံးဝ ၀ ၇ ဝ ရ");
  assert.deepEqual(result.splits, [{ from: "သဒ္ဒါ၁", count: 1 }]);
  assert.equal(result.repairs.reduce((total, item) => total + item.count, 0), 2);
});

test("OCR repair locates POS unknowns using source spans and validates candidates through Engine", async () => {
  const { scanBrokenSpansWithPos, inspectPosCandidate } = await import("../../../B.Parser/main/parser/text/repair.js");
  const source = "ကောင်းကင် ဃက် မြန်မာ";
  const spans = await scanBrokenSpansWithPos(source);
  const target = spans.find((span) => span.token === "ဃက်");
  assert.ok(target);
  assert.equal(source.slice(target.start, target.end), "ဃက်");
  assert.ok(target.rules.includes("unknown"));
  assert.equal((await inspectPosCandidate("ကောင်းကင်")).singleWord, true);
  assert.equal((await inspectPosCandidate("ဃက်")).singleWord, false);
});
