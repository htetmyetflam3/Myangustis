import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ZAWCODE_LEGACY_CODE_PAGE, ZAWCODE_INPUT_CMAP_INVENTORY, buildZawCodeCodePage,
} from "../../../Parser/main/parser/codepage/zawcode-layout.mjs";
import { LEGACY_CODE_PAGES, UNICODE_PATH, ZawCODE_PATH } from "../../../Parser/main/parser/codepage/registry.mjs";
import { unmixZawCodeMarks } from "../../../Parser/main/parser/text/cleanup.mjs";

/**
 * FILE: Parsed/parser/test/zawcode-layout.test.mjs
 *
 * The ZawCode Keymagic layout (codepage/zawcode.kms) built into a code
 * page against the INPUT cmap of the 4,414-page merged source book
 * (Myanmar3/MyanmarText subsets, codepage/zawcode-cmap.json). These
 * pin the layout artifact and the cmap integration rule -- the writer font of the output PDF
 * (MyanmarSagar) is not involved anywhere here.
 */

const kms = fs.readFileSync(new URL("../../../Parser/main/parser/codepage/zawcode.kms", import.meta.url), "utf8");
const decodeSlots = (s) => [...s].map((c) => ZAWCODE_LEGACY_CODE_PAGE.get(c.codePointAt(0)) ?? "?").join("");

test("the Keymagic layout ships in-repo, bound to the input font", () => {
  assert.match(kms, /@FONTFAMILY = "Myanmar3"/u);
  // the three keys the whole layout turns on: ေ and ြ are typed BEFORE
  // their consonant (placeholder-led), ျ after it
  assert.match(kms, /<VK_KEY_A> => \$nbsp \+ U1031/u);
  assert.match(kms, /<VK_KEY_J> => \$nbsp \+ U103C/u);
  assert.match(kms, /<VK_KEY_S> => U103B/u);
  assert.match(kms, /\$nbsp \+ U1031 \+ \$consU\[\*\] => \$consU\[\$3\] \+ \$2/u);
});

test("slot table decodes ZawCode keying, placeholder stripped", () => {
  assert.equal(ZAWCODE_LEGACY_CODE_PAGE.size, 92);
  // မြေ is keyed a-j-r (ေ, ြ, မ): the table yields typed order...
  assert.equal(decodeSlots("ajr"), "\u1031\u103C\u1019");
  // ...and the stored-order rule turns it into Unicode order
  assert.equal(unmixZawCodeMarks(decodeSlots("ajr")), "\u1019\u103C\u1031");
  // ကျေ is keyed a-u-s (ေ, က, ျ)
  assert.equal(unmixZawCodeMarks(decodeSlots("aus")), "\u1000\u103B\u1031");
  // no composition placeholder survives into document text
  for (const text of ZAWCODE_LEGACY_CODE_PAGE.values()) assert.ok(!text.includes("\u200A"));
});

test("every Myanmar code point the layout emits is named by the input cmap", () => {
  for (const text of ZAWCODE_LEGACY_CODE_PAGE.values()) {
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x1000 && cp <= 0x109F) assert.ok(ZAWCODE_INPUT_CMAP_INVENTORY.has(cp), `U+${cp.toString(16)}`);
    }
  }
  // against an empty inventory only pure-Latin slots survive the filter
  const none = buildZawCodeCodePage(new Set());
  assert.equal(none.get(32), " ");
  assert.equal(none.get(97), undefined);
  assert.ok(none.size < ZAWCODE_LEGACY_CODE_PAGE.size);
});

test("zawcode is a separate Unicode-family path, never a blanket table", () => {
  // ungated the slot table out-scores wininnwa on a WinInnwa book (0.979
  // vs 0.978, bg-mlc-1-1), and a font-name gate would trust names that
  // lie -- so the table competes nowhere. The path is the cmap/Unicode
  // win relabelled by the readable-result guard instead.
  assert.deepEqual([...LEGACY_CODE_PAGES.keys()], ["ayar", "wininnwa"]);
  assert.equal(UNICODE_PATH, "unicode");
  assert.equal(ZawCODE_PATH, "zawcode");
  assert.notEqual(ZawCODE_PATH, UNICODE_PATH);
});
