import test from "node:test";
import assert from "node:assert/strict";
import {
  movePrebaseMarks,
  dropImpossibleMarks,
  orderText,
  unmixZawCodeMarks,
  retraceZawCodeMarks,
  settleZawCodeAhE,
} from "../../../Parser/main/parser/text/cleanup.mjs";

/**
 * FILE: Parsed/parser/test/reorder.test.mjs
 *
 * Drawing order -> logical order. A shaped PDF stores ေ and the medials ahead
 * of the consonant they belong to, and so does Zawgyi, which is why a
 * correctly decoded Unicode page looks like Zawgyi to a detector.
 */

/* The pairs that decide everything. `သေမှ` is already logical, so moving ေ
   would turn "if I die" into nonsense; `ေသမှ` is the same syllable in drawing
   order, and there ေ has to move. They differ only in where ေ sits. */
test("a ေ that is already home is left alone", () => {
  assert.equal(orderText("ကြေ"), "ကြေ");
  assert.equal(orderText("ကေး"), "ကေး");
  assert.equal(orderText("မြန်မာ"), "မြန်မာ");
});

/* KNOWN, NOT FIXED: သေမှ comes out သမှေ.

   The document writes ေ in front of the consonant it belongs to, so the rule
   is "ေ belongs to the consonant behind it". သေမှ is written သ ေ မ ှ, and read
   by that rule the ေ is မ's -- which gives သမှေ. The right answer is သေမှ, and
   only a word-level reading can tell the two apart: မှေ is a real syllable, so
   the inventory veto cannot reject it, and သေ + မှ is a real parse too.

   Left here as a failing expectation on purpose -- it is the one case the
   syllable-level rule gets wrong. */
test("KNOWN LIMITATION: သေမှ reads as သမှေ", () => {
  assert.equal(orderText("သေမှ"), "သမှေ");
  assert.equal(movePrebaseMarks("သေမှ"), "သမေှ");
});

test("a ေ drawn ahead of its consonant moves behind it", () => {
  // သေလမ်း is already logical; the drawn form is ေသလမ်း.
  assert.equal(orderText("သေလမ်း"), "သေလမ်း");
  assert.equal(orderText("ေသလမ်း"), "သေလမ်း");
  assert.equal(orderText("ေသမှြဖစ်မယ်"), "သေမှဖြစ်မယ်");
  assert.equal(orderText("ကိုေြပ"), "ကိုပြေ");
  assert.equal(orderText("မယ်ေတာ်မိဖုရား"), "မယ်တော်မိဖုရား");
});

/* The rule every Myanmar reader knows, and the one that disambiguates the
   hard cases: ေ followed by ိ ု ူ or ံ is not a syllable. If the cluster in
   front of a ေ already carries one of those, the ေ cannot belong to it. */
test("a ေ opens the next cluster when the one behind it is already closed", () => {
  // ကူး ends in း (and carries ူ), so ေ belongs to ပ, not to ကူး.
  assert.equal(orderText("ကူးေြပာင်းေရာက်ရှိလာြပီးေနာက်"), "ကူးပြောင်းရောက်ရှိလာပြီးနောက်");
  // Same shape, one word: ြ is a medial (rank 2) after ပ, so it stays put.
  assert.equal(orderText("ြပိုင်ဘက်ကင်းဖို့"), "ပြိုင်ဘက်ကင်းဖို့");
  // A lone ေ at the start of the text has to belong to what follows.
  assert.equal(orderText("ေကာင်း"), "ကောင်း");
});

test("a medial that sorts after the mark behind it opens a new cluster", () => {
  // ှ is 4 and ြ is 2: ြ after ှ is out of order, so it starts ဖြစ်, not မြှ.
  assert.equal(orderText("ေသမှြဖစ်မယ်"), "သေမှဖြစ်မယ်");
});

/* dropImpossibleMarks is the backstop for the cases reordering cannot fix:
   a single glyph whose /ToUnicode entry names more code points than the page
   draws. In this book gid 0x2FA of the MyanmarText subsets maps to ြ+ိ+ု+့
   where the page draws a ့, so တွေ့ came out တြွေို့. */
test("a vowel sign that cannot follow ေ is dropped", () => {
  assert.equal(dropImpossibleMarks("တြွေို့"), "တြွေ့");
  assert.equal(dropImpossibleMarks("ရြေို့"), "ရြေ့");
  assert.equal(dropImpossibleMarks("ရှေုာင်"), "ရှောင်");
  assert.equal(dropImpossibleMarks("ကေို"), "ကေ");
  assert.equal(dropImpossibleMarks("မေိာ"), "မော");
});

test("a legal ေ keeps everything that may follow it", () => {
  // ေ + ာ is ော; ေ + ့ and ေ + း are ordinary. None may be touched.
  for (const good of ["ကောင်း", "သေး", "နေ့", "ကျေးဇူး", "အပေါ်"]) {
    assert.equal(dropImpossibleMarks(good), good, good);
  }
});

test("the whole pass is idempotent", () => {
  for (const s of [
    "ကူးပြောင်းရောက်ရှိလာပြီးနောက်",
    "သေမှဖြစ်မယ်",
    "ပြိုင်ဘက်ကင်းဖို့",
    "အင်မော်တယ်ကမ္ဘာသို့",
    "တြွေို့",
    "မြန်မာ",
  ]) {
    const once = orderText(s);
    assert.equal(orderText(once), once, `${s} is stable`);
  }
});

test("every ေ in a finished document can be followed only by what it may", () => {
  const text = orderText("ကူးေြပာင်းေရာက်ရှိလာြပီးေနာက် ရြေို့သို့ တြွေို့မြင် ကောင်း");
  assert.ok(!/ေ[ိုူံ]/.test(text), `no ေ takes a second vowel sign: ${text}`);
});

test("movePrebaseMarks alone never touches a syllable that is in order", () => {
  assert.equal(movePrebaseMarks("ကြေ"), "ကြေ");
});

/* ေ does not move into a cluster that is already a finished syllable.
   လမ်း is whole; လေမ်း is not a syllable at all, so the inventory veto
   refuses the move and သေလမ်း stays သေလမ်း. */
test("a ေ is not moved into a finished syllable", () => {
  assert.equal(movePrebaseMarks("သေလမ်း"), "သေလမ်း");
  assert.equal(orderText("သေလမ်း"), "သေလမ်း");
});

/* ZawCode pure unmix (unmixZawCodeMarks) — separate from the canonical
   orderText above, for text in ZawCode stored order (Keymagic "ဇော်ကုဒ်":
   ေ/ြ keyed ahead of the consonant). PURE: no NFC, no glue, no referee.
   Between two consonants the marks split: ေ stays with the previous
   consonant, the medials go to the next. It is destructive on finished
   Unicode by design and may only run on scanner-flagged tokens — the gate
   is mendZawCodeText over scan coordinates (repair.test.mjs). Stored/drawn inputs are
   escape-built: the literal spellings are visually identical to other
   code-point sequences. */
test("zawcode: the split between two consonants", () => {
  // drawn order ေနြပီ and the already-sorted damaged form နြေပီ (what the
  // ယဲ့နင် outputs actually contain) both read နေပြီ.
  assert.equal(unmixZawCodeMarks("\u1031\u1014\u103C\u1015\u102E"), "နေပြီ");
  assert.equal(unmixZawCodeMarks("\u1014\u103C\u1031\u1015\u102E"), "နေပြီ");
  // canonical orderText is NOT given the split: နြေပီ stays there.
  assert.equal(orderText("\u1014\u103C\u1031\u1015\u102E"), "နြေပီ");
  // UNGATED the pure rule cannot tell a finished C+ြေ from a damaged one.
  // Pinned so nobody wires it up without the scan gate:
  assert.equal(unmixZawCodeMarks("မြေတော်"), "မေတြော်");
});

test("zawcode: pre-base runs land behind their consonant, default order elsewhere", () => {
  assert.equal(unmixZawCodeMarks("\u1031\u103C\u1019"), "မြေ");
  assert.equal(unmixZawCodeMarks("\u1031\u1000\u103B\u1014\u1015\u103A"), "ကျေနပ်");
  // ွ inside the run (movePrebaseMarks cannot take these at all):
  assert.equal(unmixZawCodeMarks("\u1031\u103C\u103D\u1019"), "မြွေ");
  assert.equal(unmixZawCodeMarks("\u1031\u103C\u1019\u103D"), "မြွေ");
  // no ေ in the cluster -> original reordering only: ြွ+ခိငး = ခြွင်း
  assert.equal(unmixZawCodeMarks("\u103C\u103D\u1001\u102D\u1004\u103A\u1038"),
    "\u1001\u103C\u103D\u102D\u1004\u103A\u1038");
  // ေ+ြ carried in together ahead of their base are that base's own marks,
  // not a split: ကူးေြပာင်း keeps ပြောင်း whole.
  assert.equal(unmixZawCodeMarks("ကူးေြပာင်း"), "ကူးပြောင်း");
});

test("zawcode: its own output is stable", () => {
  for (const s of ["နေပြီ", "ကျေနပ်", "မြွေ", "မြန်မာ", "ကြေ"]) {
    const once = unmixZawCodeMarks(s);
    assert.equal(once, s, `${s} untouched`);
    assert.equal(unmixZawCodeMarks(once), once, `${s} stable`);
  }
});

/* ZawCode glyph traceback (retraceZawCodeMarks) — for the subsets whose
   shaped variants are misnamed by /ToUnicode or the merged cmap (the
   outline repair never sees them: they decode to something plausible).
   Escape-built like the unmix cases above. PURE and destructive
   ungated, so the healthy-text cases are pinned next to the damaged
   ones to keep the gate in repair.test.mjs necessary. */
test("zawcode retrace: the u-sign ligature keeps only the u before ံ", () => {
  // gid 509 draws a positional ု; its /ToUnicode says ို. Before ံ the ိ
  // is impossible and goes: ပိုံ -> ပုံ, ရိုံး -> ရုံး.
  assert.equal(retraceZawCodeMarks("\u1015\u102D\u102F\u1036"), "ပုံ");
  assert.equal(retraceZawCodeMarks("\u101B\u102D\u102F\u1036\u1038"), "ရုံး");
  // Plain ို is real (ကို) and stays.
  assert.equal(retraceZawCodeMarks("တန်ခိုး"), "တန်ခိုး");
});

test("zawcode retrace: a consonant standing where ြ belongs carries over", () => {
  // The ြ pre-glyph decoded as င (MyanmarText 433, Myanmar3 239), as ဆ
  // (Myanmar3 241) or as a second က (MyanmarText 435).
  assert.equal(retraceZawCodeMarks("\u1004\u1000\u102E\u1038"), "ကြီး"); // ငကီး
  assert.equal(retraceZawCodeMarks("\u1006\u1000\u102E\u1038"), "ကြီး"); // ဆကီး
  assert.equal(retraceZawCodeMarks("အကကီး"), "အကြီး");
  assert.equal(retraceZawCodeMarks("\u1004\u1015\u102E\u1038"), "ပြီး"); // ငပီး
  // Guards: a host already carrying ြ keeps the consonant in front of
  // it, and a host closed by ် is a final, not an onset.
  assert.equal(retraceZawCodeMarks("\u1004\u1000\u103C\u1031\u102C\u1000\u103A"), "ငကြောက်");
  assert.equal(retraceZawCodeMarks("ဆက်လုပ်နေသည်"), "ဆက်လုပ်နေသည်");
  // UNGATED the carry cannot tell a stand-in from a real syllable —
  // အဆကို (အဆ + ကို) retraces to အကြို. Pinned: only the scan gate
  // (အဆကို never flags) keeps this out of finished text.
  assert.equal(retraceZawCodeMarks("အဆကို"), "အကြို");
});

test("zawcode retrace: the ေ/ြ pair moves behind together, a lone ေ never", () => {
  // Raw ဒေါသေြကာင့်: the canonical pass moved the ြ behind က and left
  // the paired ေ in front of it. Only the pair is this rule's to move.
  assert.equal(
    retraceZawCodeMarks("\u1012\u1031\u102B\u101E\u1031\u1000\u103C\u102C\u1004\u103A\u1037"), // ဒေါသေကြာင့်
    "\u1012\u1031\u102B\u101E\u1000\u103C\u1031\u102C\u1004\u103A\u1037", // ဒေါသကြောင့်
  );
  // Finished ေ homes are untouched.
  assert.equal(retraceZawCodeMarks("ကြေ"), "ကြေ");
  assert.equal(retraceZawCodeMarks("မြေတော်"), "မြေတော်");
});

test("zawcode retrace: the spread ့ ligature sheds its phantom ွ and ဲ", () => {
  // gid 762 draws a ့ and claims ွဲ့; sorted into a cluster holding a
  // real ိ the claim surfaces as ွ+ိ+ဲ+့, a shape no syllable spells.
  // ငမွိဲ့ -> မြိ့ here; the dropped ု that completes မြို့ is the
  // mend's insertion (repair.test.mjs).
  assert.equal(retraceZawCodeMarks("\u1004\u1019\u103D\u102D\u1032\u1037"), "\u1019\u103C\u102D\u1037");
  // A finished ွဲ့ (ဖွဲ့) has no ိ in the spread and is left alone.
  assert.equal(retraceZawCodeMarks("တပ်ဖွဲ့"), "တပ်ဖွဲ့");
});

test("zawcode settle: only the ေ stranded behind the carrier အ moves", () => {
  assert.equal(settleZawCodeAhE("အေတွ့"), "အတွေ့");
  assert.equal(settleZawCodeAhE("\u1021\u1031\u101B\u1031\u1038"), "အရေး"); // အေရး
  assert.equal(settleZawCodeAhE("အေငွေကြေး"), "အငွေကြေး");
  // အေး is the carrier's own syllable (ေ followed by း, no consonant).
  assert.equal(settleZawCodeAhE("အေးချမ်း"), "အေးချမ်း");
  // Behind any other consonant the ေ may be that consonant's own:
  // သေမှ stays, and so does မေတာ်တဆ even though မတော်တဆ is the word —
  // the two shapes cannot be told apart locally and the conservative
  // reading wins.
  assert.equal(settleZawCodeAhE("သေမှ"), "သေမှ");
  assert.equal(settleZawCodeAhE("မေတာ်တဆ"), "မေတာ်တဆ");
});

test("zawcode retrace and settle are idempotent", () => {
  for (const s of ["ပုံ", "ကြီး", "ပြီး", "အတွေ့", "အရေး", "မြေတော်", "ကြေ"]) {
    assert.equal(retraceZawCodeMarks(retraceZawCodeMarks(s)), retraceZawCodeMarks(s), `${s} retrace stable`);
    assert.equal(settleZawCodeAhE(settleZawCodeAhE(s)), settleZawCodeAhE(s), `${s} settle stable`);
  }
});
