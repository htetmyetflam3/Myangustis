import test from "node:test";
import assert from "node:assert/strict";
import {
  HOMOGLYPH_PAIRS, homoglyphVariants, repairToken, repairHomoglyphs,
} from "../../../Parser/main/parser/text/repair.mjs";

const words = new Set(["စဉ်", "အစဉ်", "လုံးဝ", "ဝဂ်", "ယာဉ်", "ရေ"]);

test("the three legacy homoglyph pairs are loaded", () => {
  assert.equal(HOMOGLYPH_PAIRS.length, 3);
  assert.deepEqual(HOMOGLYPH_PAIRS[0], ["\u101D", "\u1040"]); // ဝ / ၀
  assert.deepEqual(HOMOGLYPH_PAIRS[1], ["\u101B", "\u1047"]); // ရ / ၇
  assert.deepEqual(HOMOGLYPH_PAIRS[2], ["\u1009", "\u1025"]); // ဉ / ဥ
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
  // both swaps land on a word, so neither may be chosen
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

// ---------------------------------------------------------------- glued numbers
import { splitGluedNumber, repairText } from "../../../Parser/main/parser/text/repair.mjs";

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

/* ZawCode mend: the pure unmix rule applied only at scan coordinates.
   Real sealed dictionary, like scan.test.mjs — with a toy word set every
   token flags unknown and the gate cannot be exercised. */
test("zawcode mend rewrites scan-flagged spans and nothing else", async () => {
  const { fileURLToPath } = await import("node:url");
  const { loadMap, dictionaryWords } = await import("../../../Parser/main/parser/text/scan.mjs");
  const { mendZawCodeText } = await import("../../../Parser/main/parser/text/repair.mjs");
  const data = loadMap(fileURLToPath(new URL("../../../.data/master.json.enc", import.meta.url)));
  const dict = dictionaryWords(data);
  const standalone = data?.mapData?.newClause?.standalone || [];

  const line = "မြေတော်တွင် ကြေနပ်စွာ \u1014\u103C\u1031\u1015\u102E ကြေးဇူးပါ";
  const { text, repairs } = mendZawCodeText(line, dict, standalone);
  assert.equal(text, "မြေတော်တွင် ကြေနပ်စွာ နေပြီ ကြေးဇူးပါ");
  assert.deepEqual(repairs, [{ from: "\u1014\u103C\u1031\u1015\u102E", to: "နေပြီ", count: 1 }]);

  // no dictionary -> no scan -> no mend (abstain)
  assert.equal(mendZawCodeText(line, new Set()).text, line);
});

test("zawcode guard splits stored order by readable result, not font name", async () => {
  const { fileURLToPath } = await import("node:url");
  const { loadMap, dictionaryWords } = await import("../../../Parser/main/parser/text/scan.mjs");
  const { zawCodeGuard } = await import("../../../Parser/main/parser/text/repair.mjs");
  const data = loadMap(fileURLToPath(new URL("../../../.data/master.json.enc", import.meta.url)));
  const dict = dictionaryWords(data);
  const standalone = data?.mapData?.newClause?.standalone || [];

  const stored = Array(30).fill("\u1014\u103C\u1031\u1015\u102E").join(" "); // နြေပီ
  const guard = zawCodeGuard(stored, dict, standalone);
  assert.equal(guard.zawcode, true, JSON.stringify(guard));
  assert.ok(guard.pureScore >= 0.99);
  assert.ok(guard.gain >= 2);

  const finished = Array(30).fill("နေပြီ").join(" ");
  assert.equal(zawCodeGuard(finished, dict, standalone).zawcode, false);
  assert.equal(zawCodeGuard(stored, new Set(), standalone).zawcode, false);
});

/* The ZawCode variant sets: one dropped character inserted, or one
   phantom ိ dropped, per variant. The mend arbitrates over these the
   way repairToken arbitrates over homoglyphVariants. */
test("zawcode insertion variants offer the dropped glyphs", async () => {
  const { zawCodeInsertionVariants, zawCodeSpuriousIVariants } = await import("../../../Parser/main/parser/text/repair.mjs");
  // gid 429's dropped ြ: ကောင့် is one insertion from ကြောင့်.
  assert.ok(zawCodeInsertionVariants("\u1000\u1031\u102C\u1004\u103A\u1037")
    .includes("\u1000\u103C\u1031\u102C\u1004\u103A\u1037"));
  // gid 511's dropped ု behind a real ိ: ကျိး -> ကျိုး.
  assert.ok(zawCodeInsertionVariants("\u1000\u103B\u102D\u1038")
    .includes("\u1000\u103B\u102D\u102F\u1038"));
  // The stacked second's lost virama: အနတရာယ် -> အန္တရာယ်.
  assert.ok(zawCodeInsertionVariants("အနတရာယ်").includes("အန္တရာယ်"));
  // gid 510's dropped ူ — but never into the lion's shape: ခြေသ့ရုပ်
  // (ခြင်္သေ့ရုပ် with the င်္ conjunct glyph dropped) must not grow a
  // pronoun. The သ there is preceded by its own ေ, and that vetoes it.
  assert.ok(zawCodeInsertionVariants("\u101E\u1010\u102D\u102F\u1037")
    .includes("\u101E\u1030\u1010\u102D\u102F\u1037")); // သတို့ -> သူတို့ offered
  assert.ok(!zawCodeInsertionVariants("\u1001\u103C\u1031\u101E\u1037\u101B\u102F\u1015\u103A")
    .includes("\u1001\u103C\u1031\u101E\u1030\u1037\u101B\u102F\u1015\u103A")); // ခြေသူ့ရုပ် NOT offered
  // gid 509: each ို read back as ု on its own, never all at once.
  assert.deepEqual(zawCodeSpuriousIVariants("\u101B\u102D\u102F\u1010\u103A\u1010\u101B\u1000\u103A"),
    ["\u101B\u102F\u1010\u103A\u1010\u101B\u1000\u103A"]); // ရိုတ်တရက် -> ရုတ်တရက်
  assert.equal(zawCodeSpuriousIVariants("ဂိုဏ်သတင်းကို").length, 2);
});

test("zawcode mend retraces misnamed and dropped glyphs at scan coordinates", async () => {
  const { fileURLToPath } = await import("node:url");
  const { loadMap, dictionaryWords } = await import("../../../Parser/main/parser/text/scan.mjs");
  const { mendZawCodeText } = await import("../../../Parser/main/parser/text/repair.mjs");
  const data = loadMap(fileURLToPath(new URL("../../../.data/master.json.enc", import.meta.url)));
  const dict = dictionaryWords(data);
  const standalone = data?.mapData?.newClause?.standalone || [];

  // ငမွိဲ့တော် (မြို့တော်: ြ misnamed င, ု dropped, ့ lying as ွဲ့),
  // ရိုတ်တရက် (ရုတ်တရက်), ထို့ကောင့် (ထို့ကြောင့်: ြ dropped).
  const damaged = "\u1004\u1019\u103D\u102D\u1032\u1037\u1010\u1031\u102C\u103A"
    + " \u101B\u102D\u102F\u1010\u103A\u1010\u101B\u1000\u103A"
    + " \u1011\u102D\u102F\u1037\u1000\u1031\u102C\u1004\u103A\u1037";
  const mended = "\u1019\u103C\u102D\u102F\u1037\u1010\u1031\u102C\u103A"
    + " \u101B\u102F\u1010\u103A\u1010\u101B\u1000\u103A"
    + " \u1011\u102D\u102F\u1037\u1000\u103C\u1031\u102C\u1004\u103A\u1037";
  const { text, repairs } = mendZawCodeText(damaged, dict, standalone);
  assert.equal(text, mended);
  assert.equal(repairs.length, 3);

  // A flagged အေတွ့ settles behind the carrier.
  assert.equal(
    mendZawCodeText("\u1021\u1031\u1010\u103D\u1037", dict, standalone).text,
    "\u1021\u1010\u103D\u1031\u1037",
  );

  // Finished text is byte-identical and repair-free: the pure
  // candidates are destructive ungated (အဆကို -> အကြို), so this is the
  // load-bearing property — clean tokens never reach a candidate.
  const healthy = "မြေတော်တွင် ကြေနပ်စွာ ကြေးဇူးပါ အယူအဆကို တန်ခိုး"
    + " \u1001\u103C\u1031\u101E\u1037\u101B\u102F\u1015\u103A\u1019\u103B\u102C\u1038" // ခြေသ့ရုပ်များ
    + " \u1000\u101E\u100A\u103A"; // ကသည် — a word, even where ကြသည် was meant
  const untouched = mendZawCodeText(healthy, dict, standalone);
  assert.equal(untouched.text, healthy);
  assert.deepEqual(untouched.repairs, []);
});

test("zawcode mend frames cover the damage that still segments", async () => {
  const { fileURLToPath } = await import("node:url");
  const { loadMap, dictionaryWords } = await import("../../../Parser/main/parser/text/scan.mjs");
  const { mendZawCodeText } = await import("../../../Parser/main/parser/text/repair.mjs");
  const data = loadMap(fileURLToPath(new URL("../../../.data/master.json.enc", import.meta.url)));
  const dict = dictionaryWords(data);
  const standalone = data?.mapData?.newClause?.standalone || [];

  // None of these flag: သတို့သည် segments as သ+တို့+သည်, သ့အား carries
  // the dictionary word သ့, အေရး segments as အေ+ရး. The frames are
  // token-initial, require a fully clean rescan, and nothing else.
  const damaged = "\u101E\u1010\u102D\u102F\u1037\u101E\u100A\u103A" // သတို့သည်
    + " \u101E\u1037\u1021\u102C\u1038" // သ့အား
    + " \u1021\u1031\u101B\u1031\u1038"; // အေရး
  const mended = "\u101E\u1030\u1010\u102D\u102F\u1037\u101E\u100A\u103A" // သူတို့သည်
    + " \u101E\u1030\u1037\u1021\u102C\u1038" // သူ့အား
    + " \u1021\u101B\u1031\u1038"; // အရေး
  assert.equal(mendZawCodeText(damaged, dict, standalone).text, mended);

  // The fence: a bare သ့ token is left (it is a word), the lion's
  // mid-token သ့ is left, and a lone ေ behind သ never relocates on the
  // frame's or the mend's say-so (သေတာ်… stays, wrong or not).
  assert.equal(mendZawCodeText("\u101E\u1037", dict, standalone).text, "\u101E\u1037");
  const lion = "\u1001\u103C\u1031\u101E\u1037\u101B\u102F\u1015\u103A\u1019\u103B\u102C\u1038";
  assert.equal(mendZawCodeText(lion, dict, standalone).text, lion);
  const stranded = "\u101E\u1031\u1010\u102C\u103A\u1005\u1004\u103A\u101C\u1019\u103A\u1038\u1005\u1009\u103A";
  assert.equal(mendZawCodeText(stranded, dict, standalone).text, stranded); // သေတာ်စင်လမ်းစဉ်
});

test("repairFromScanVerdict mends only the zawcode path, text and lines together", async () => {
  const { fileURLToPath } = await import("node:url");
  const { loadMap, dictionaryWords } = await import("../../../Parser/main/parser/text/scan.mjs");
  const { repairFromScanVerdict } = await import("../../../Parser/main/parser/text/repair.mjs");
  const data = loadMap(fileURLToPath(new URL("../../../.data/master.json.enc", import.meta.url)));
  const dict = dictionaryWords(data);
  const standalone = data?.mapData?.newClause?.standalone || [];
  const line = "မြေတော်တွင် \u1014\u103C\u1031\u1015\u102E ကြေးဇူးပါ";
  const pages = [{ text: line, lines: [[0, 0, 10, line]], wh: [1, 1] }];

  // Every other verdict path keeps the historical pass-through.
  assert.equal(repairFromScanVerdict(pages, {}, dict, { path: "wininnwa", standalone }), pages);
  assert.equal(repairFromScanVerdict(pages, {}, dict, { path: "unicode", standalone }), pages);

  const mended = repairFromScanVerdict(pages, { unknown: { total: 1 } }, dict, { path: "zawcode", standalone });
  assert.equal(mended[0].text, "မြေတော်တွင် နေပြီ ကြေးဇူးပါ");
  assert.equal(mended[0].lines[0][3], mended[0].text);

  // When the page token does not survive verbatim into the layout lines
  // (separate assembly), the lines are mended on their own coordinates.
  const split = [{
    text: "ကြည့်\u1014\u103C\u1031ကသည်",
    lines: [[0, 0, 10, "ကြည့် \u1014\u103C\u1031ကသည်"]],
  }];
  const splitMended = repairFromScanVerdict(split, { unknown: { total: 1 } }, dict, { path: "zawcode", standalone });
  assert.equal(splitMended[0].text, "ကြည့်နေကြသည်");
  assert.equal(splitMended[0].lines[0][3], "ကြည့် နေကြသည်");
});
