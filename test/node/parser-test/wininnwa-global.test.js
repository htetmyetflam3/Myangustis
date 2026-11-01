import test from "node:test";
import assert from "node:assert/strict";

import {
  AYAR_LEGACY_CODE_PAGE,
  WININNWA_LEGACY_CODE_PAGE,
  WININNWA_UNRESOLVED_SLOTS,
} from "../../../B.Parser/main/parser/codepage/registry.js";
import { DocumentDecoding, FontDecoder } from "../../../B.Parser/main/parser/read/pdf-fonts.js";
import { legacyAyarToUnicode } from "../../../B.Parser/main/parser/read/pdf-extract.js";

const doc = new DocumentDecoding("legacy", new Map(), WININNWA_LEGACY_CODE_PAGE);
const font = new FontDecoder("F", { baseFont: "WinInnwa", doc });
const convert = (slots) => legacyAyarToUnicode(font.decode(slots));

test("WinInnwa stack slots preserve the actual upper consonant", () => {
  // The two lower-တ glyphs occur after both upper တ and upper န in the books.
  for (const [slots, expected] of [
    ["uwÅm;", "ကတ္တား"], ["uwåm;", "ကတ္တား"],
    ["rEÅav;", "မန္တလေး"], ["rEåav;", "မန္တလေး"],
    ["arwåm", "မေတ္တာ"], ["o'´g", "သဒ္ဒါ"],
    ["orÁE¨", "သမ္ဗန္ဓ"], ["tu©&m", "အက္ခရာ"],
    ["vdr®m", "လိမ္မာ"], ["ypönf;", "ပစ္စည်း"],
    ["yk*¾dKvf", "ပုဂ္ဂိုလ်"], ["u+u=uú", "က+က=က္က"],
  ]) assert.equal(convert(slots), expected, slots);
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xc5), "္တ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xe5), "္တ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xfa), "္က");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xb4), "္ဒ");
  // Independent keyboard and converter evidence also supports these forms.
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xa6), "္ထ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xc9), "္တွ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0x57), "ျွှ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xbf), "?");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xe7), ",");
  assert.ok(![...WININNWA_LEGACY_CODE_PAGE.values()].includes("္"));
  // These identical numeric slots have different meanings in Ayar.
  assert.notEqual(AYAR_LEGACY_CODE_PAGE.get(0xc5), WININNWA_LEGACY_CODE_PAGE.get(0xc5));
});

test("the earlier single-entry ဏ္ဏ rule is retained separately from space", () => {
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(32), " ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(80), "ဏ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(192), "ဏ္ဏ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(197), "္တ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(214), "္ဏ");
  assert.equal(WININNWA_UNRESOLVED_SLOTS.has(192), false);
  assert.equal(WININNWA_LEGACY_CODE_PAGE.has(37), false);
  assert.equal(WININNWA_UNRESOLVED_SLOTS.has(37), true);
  assert.equal(font.decode("%"), "%");
  assert.equal(convert("À"), "ဏ္ဏ");
  assert.equal(convert("PÖ"), "ဏ္ဏ");
  assert.equal(convert("P À"), "ဏ ဏ္ဏ");

  const f = new FontDecoder("F", {
    baseFont: "WinInnwa", doc, toUnicode: new Map([[0x30, "À"]]),
  });
  assert.equal(f.decode(String.fromCharCode(0x30)), "ဏ္ဏ");
});

test("visual-order and vowel variants retain the user's forms", () => {
  for (const [slots, expected] of [
    ["jyKpk", "ပြုစု"], ["'ku©", "ဒုက္ခ"], ["jiK", "ငြု"],
    ["acG;", "ခွေး"], ["a>rBuD;", "မြွေကြီး"],
    ["ausmif;", "ကျောင်း"], ["aMumif", "ကြောင်"],
    ["*g", "ဂါ"], ["*sg", "ဂျာ"], ["OD;", "ဦး"],
    ["ÓPf&nf", "ဉာဏ်ရည်"],
  ]) assert.equal(convert(slots), expected, slots);
  assert.equal(font.decode("kK"), "ုု");
  assert.equal(font.decode("lL"), "ူူ");
  assert.equal(convert("wð"), "တိံ");
  assert.equal(convert("wdH"), "တိံ");
  assert.equal(legacyAyarToUnicode("တိံ"), "တိံ");
  assert.equal(convert("0"), "၀");
  assert.equal(convert("0gp*F"), "ဝါစင်္ဂ");
  assert.equal(convert("*"), "ဂ");
  assert.equal(convert("8"), "၈");
  assert.equal(convert("&"), "ရ");
  assert.equal(convert("7"), "၇");
});

test("combined and plain kinzi do not lose their vowels or add joiners", () => {
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xd0), "င်္ီ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xd8), "င်္ိ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xf8), "င်္ံ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0x46), "င်္");
  assert.equal(convert("od*Ð"), "သိင်္ဂီ");
  assert.equal(convert("0gp*F"), "ဝါစင်္ဂ");
});

test("a wide legacy slot is read through the font's own ToUnicode", () => {
  const f = new FontDecoder("F", {
    baseFont: "WinInnwa", doc, toUnicode: new Map([[0x68, "’"]]),
  });
  assert.equal(f.decode(String.fromCharCode(0x68)), "္လ");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0x2019), "္လ");
});

test("ambiguous or conflicting, unobserved slots are not given guessed readings", () => {
  for (const slot of [0x24, 0x25, 0x7c, 0xb5, 0xea]) {
    assert.equal(WININNWA_LEGACY_CODE_PAGE.has(slot), false);
    assert.equal(WININNWA_UNRESOLVED_SLOTS.has(slot), true);
    assert.equal(font.decode(String.fromCodePoint(slot)), String.fromCodePoint(slot));
  }
  const f = new FontDecoder("F", {
    baseFont: "WinInnwa", doc, toUnicode: new Map([[0x30, "|"]]),
  });
  assert.equal(f.decode(String.fromCharCode(0x30)), "|");
});
