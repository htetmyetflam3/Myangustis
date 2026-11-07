import test from "node:test";
import assert from "node:assert/strict";

import {
  AYAR_LEGACY_CODE_PAGE,
  WININNWA_LEGACY_CODE_PAGE,
} from "../../../B.Parser/main/parser/codepage/registry.js";
import { legacyAyarToUnicode } from "../../../B.Parser/main/parser/read/pdf-extract.js";
import { DocumentDecoding, FontDecoder } from "../../../B.Parser/main/parser/read/pdf-fonts.js";

const bytes = (...codes) => String.fromCharCode(...codes);

function decoder(font, page, toUnicode) {
  const doc = new DocumentDecoding("legacy", new Map(), page);
  return new FontDecoder("F", { baseFont: font, toUnicode: new Map(toUnicode), doc, fontLegacyCodePage: page });
}

test("the Ayar combined kinzi keeps ီ in the grammar's actual shirt and name", () => {
  // Grammar p235 /TT41: 23 42 88 2F -> A k Ç ¥, with Ç a combined glyph.
  const f = decoder("Arlarwade", AYAR_LEGACY_CODE_PAGE, [
    [0x23, "A"], [0x42, "k"], [0x88, "Ç"], [0x2f, "¥"],
    [0x3e, "q"], [0x3c, "i"], [0x64, "g"],
  ]);
  assert.equal(AYAR_LEGACY_CODE_PAGE.get(0xc7), "င်္ီ");
  assert.equal(AYAR_LEGACY_CODE_PAGE.get(0xe7), "င်္");
  assert.equal(legacyAyarToUnicode(f.decode(bytes(0x23, 0x42, 0x88, 0x2f))), "အင်္ကျီ");
  // Grammar p261 /TT41: q i g Ç -> သိင်္ဂီ.
  assert.equal(legacyAyarToUnicode(f.decode(bytes(0x3e, 0x3c, 0x64, 0x88))), "သိင်္ဂီ");
});

test("the WinInnwa combined kinzi is a different slot, not an Ayar byte", () => {
  // BG 2-6 pp56-57: 0A 23 7A 2A -> t u Ð s.
  const f = decoder("WinInnwa", WININNWA_LEGACY_CODE_PAGE, [
    [0x0a, "t"], [0x23, "u"], [0x7a, "Ð"], [0x2a, "s"],
  ]);
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(0xd0), "င်္ီ");
  assert.equal(legacyAyarToUnicode(f.decode(bytes(0x0a, 0x23, 0x7a, 0x2a))), "အင်္ကျီ");
});

test("plain kinzi, already ordered Unicode, and zero-width text survive", () => {
  assert.equal(legacyAyarToUnicode("သချင်္ာ"), "သင်္ချာ");
  assert.equal(legacyAyarToUnicode("ဝါစင်္ဂ"), "ဝါစင်္ဂ");
  assert.equal(legacyAyarToUnicode("အင်္ကျီ"), "အင်္ကျီ");
  assert.equal(legacyAyarToUnicode("သချင်္ာ\u200b"), "သင်္ချာ\u200b");
});
