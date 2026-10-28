import test from "node:test";
import assert from "node:assert/strict";
import {
  movePrebaseMarks,
  dropImpossibleMarks,
  orderText,
  unmixZawCodeMarks,
  retraceZawCodeMarks,
  settleZawCodeAhE,
} from "../../../B.Parser/main/parser/text/cleanup.js";












test("a ေ that is already home is left alone", () => {
  assert.equal(orderText("ကြေ"), "ကြေ");
  assert.equal(orderText("ကေး"), "ကေး");
  assert.equal(orderText("မြန်မာ"), "မြန်မာ");
});











test("KNOWN LIMITATION: သေမှ reads as သမှေ", () => {
  assert.equal(orderText("သေမှ"), "သမှေ");
  assert.equal(movePrebaseMarks("သေမှ"), "သမေှ");
});

test("a ေ drawn ahead of its consonant moves behind it", () => {

  assert.equal(orderText("သေလမ်း"), "သေလမ်း");
  assert.equal(orderText("ေသလမ်း"), "သေလမ်း");
  assert.equal(orderText("ေသမှြဖစ်မယ်"), "သေမှဖြစ်မယ်");
  assert.equal(orderText("ကိုေြပ"), "ကိုပြေ");
  assert.equal(orderText("မယ်ေတာ်မိဖုရား"), "မယ်တော်မိဖုရား");
});




test("a ေ opens the next cluster when the one behind it is already closed", () => {

  assert.equal(orderText("ကူးေြပာင်းေရာက်ရှိလာြပီးေနာက်"), "ကူးပြောင်းရောက်ရှိလာပြီးနောက်");

  assert.equal(orderText("ြပိုင်ဘက်ကင်းဖို့"), "ပြိုင်ဘက်ကင်းဖို့");

  assert.equal(orderText("ေကာင်း"), "ကောင်း");
});

test("a medial that sorts after the mark behind it opens a new cluster", () => {

  assert.equal(orderText("ေသမှြဖစ်မယ်"), "သေမှဖြစ်မယ်");
});





test("a vowel sign that cannot follow ေ is dropped", () => {
  assert.equal(dropImpossibleMarks("တြွေို့"), "တြွေ့");
  assert.equal(dropImpossibleMarks("ရြေို့"), "ရြေ့");
  assert.equal(dropImpossibleMarks("ရှေုာင်"), "ရှောင်");
  assert.equal(dropImpossibleMarks("ကေို"), "ကေ");
  assert.equal(dropImpossibleMarks("မေိာ"), "မော");
});

test("a legal ေ keeps everything that may follow it", () => {

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




test("a ေ is not moved into a finished syllable", () => {
  assert.equal(movePrebaseMarks("သေလမ်း"), "သေလမ်း");
  assert.equal(orderText("သေလမ်း"), "သေလမ်း");
});










test("zawcode: the split between two consonants", () => {


  assert.equal(unmixZawCodeMarks("\u1031\u1014\u103C\u1015\u102E"), "နေပြီ");
  assert.equal(unmixZawCodeMarks("\u1014\u103C\u1031\u1015\u102E"), "နေပြီ");

  assert.equal(orderText("\u1014\u103C\u1031\u1015\u102E"), "နြေပီ");


  assert.equal(unmixZawCodeMarks("မြေတော်"), "မေတြော်");
});

test("zawcode: pre-base runs land behind their consonant, default order elsewhere", () => {
  assert.equal(unmixZawCodeMarks("\u1031\u103C\u1019"), "မြေ");
  assert.equal(unmixZawCodeMarks("\u1031\u1000\u103B\u1014\u1015\u103A"), "ကျေနပ်");

  assert.equal(unmixZawCodeMarks("\u1031\u103C\u103D\u1019"), "မြွေ");
  assert.equal(unmixZawCodeMarks("\u1031\u103C\u1019\u103D"), "မြွေ");

  assert.equal(unmixZawCodeMarks("\u103C\u103D\u1001\u102D\u1004\u103A\u1038"),
    "\u1001\u103C\u103D\u102D\u1004\u103A\u1038");


  assert.equal(unmixZawCodeMarks("ကူးေြပာင်း"), "ကူးပြောင်း");
});

test("zawcode: its own output is stable", () => {
  for (const s of ["နေပြီ", "ကျေနပ်", "မြွေ", "မြန်မာ", "ကြေ"]) {
    const once = unmixZawCodeMarks(s);
    assert.equal(once, s, `${s} untouched`);
    assert.equal(unmixZawCodeMarks(once), once, `${s} stable`);
  }
});







test("zawcode retrace: the u-sign ligature keeps only the u before ံ", () => {


  assert.equal(retraceZawCodeMarks("\u1015\u102D\u102F\u1036"), "ပုံ");
  assert.equal(retraceZawCodeMarks("\u101B\u102D\u102F\u1036\u1038"), "ရုံး");

  assert.equal(retraceZawCodeMarks("တန်ခိုး"), "တန်ခိုး");
});

test("zawcode retrace: a consonant standing where ြ belongs carries over", () => {


  assert.equal(retraceZawCodeMarks("\u1004\u1000\u102E\u1038"), "ကြီး");
  assert.equal(retraceZawCodeMarks("\u1006\u1000\u102E\u1038"), "ကြီး");
  assert.equal(retraceZawCodeMarks("အကကီး"), "အကြီး");
  assert.equal(retraceZawCodeMarks("\u1004\u1015\u102E\u1038"), "ပြီး");


  assert.equal(retraceZawCodeMarks("\u1004\u1000\u103C\u1031\u102C\u1000\u103A"), "ငကြောက်");
  assert.equal(retraceZawCodeMarks("ဆက်လုပ်နေသည်"), "ဆက်လုပ်နေသည်");



  assert.equal(retraceZawCodeMarks("အဆကို"), "အကြို");
});

test("zawcode retrace: the ေ/ြ pair moves behind together, a lone ေ never", () => {


  assert.equal(
    retraceZawCodeMarks("\u1012\u1031\u102B\u101E\u1031\u1000\u103C\u102C\u1004\u103A\u1037"),
    "\u1012\u1031\u102B\u101E\u1000\u103C\u1031\u102C\u1004\u103A\u1037",
  );

  assert.equal(retraceZawCodeMarks("ကြေ"), "ကြေ");
  assert.equal(retraceZawCodeMarks("မြေတော်"), "မြေတော်");
});

test("zawcode retrace: the spread ့ ligature sheds its phantom ွ and ဲ", () => {




  assert.equal(retraceZawCodeMarks("\u1004\u1019\u103D\u102D\u1032\u1037"), "\u1019\u103C\u102D\u1037");

  assert.equal(retraceZawCodeMarks("တပ်ဖွဲ့"), "တပ်ဖွဲ့");
});

test("zawcode settle: only the ေ stranded behind the carrier အ moves", () => {
  assert.equal(settleZawCodeAhE("အေတွ့"), "အတွေ့");
  assert.equal(settleZawCodeAhE("\u1021\u1031\u101B\u1031\u1038"), "အရေး");
  assert.equal(settleZawCodeAhE("အေငွေကြေး"), "အငွေကြေး");

  assert.equal(settleZawCodeAhE("အေးချမ်း"), "အေးချမ်း");




  assert.equal(settleZawCodeAhE("သေမှ"), "သေမှ");
  assert.equal(settleZawCodeAhE("မေတာ်တဆ"), "မေတာ်တဆ");
});

test("zawcode retrace and settle are idempotent", () => {
  for (const s of ["ပုံ", "ကြီး", "ပြီး", "အတွေ့", "အရေး", "မြေတော်", "ကြေ"]) {
    assert.equal(retraceZawCodeMarks(retraceZawCodeMarks(s)), retraceZawCodeMarks(s), `${s} retrace stable`);
    assert.equal(settleZawCodeAhE(settleZawCodeAhE(s)), settleZawCodeAhE(s), `${s} settle stable`);
  }
});
