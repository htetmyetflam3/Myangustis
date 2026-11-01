import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ZAWCODE_LEGACY_CODE_PAGE, ZAWCODE_INPUT_CMAP_INVENTORY, buildZawCodeCodePage,
} from "../../../B.Parser/main/parser/codepage/zawcode-layout.js";
import { LEGACY_CODE_PAGES, UNICODE_PATH, ZawCODE_PATH } from "../../../B.Parser/main/parser/codepage/registry.js";
import { unmixZawCodeMarks } from "../../../B.Parser/main/parser/text/cleanup.js";











const kms = fs.readFileSync(new URL("../../../B.Parser/main/parser/codepage/zawcode.kms", import.meta.url), "utf8");
const decodeSlots = (s) => [...s].map((c) => ZAWCODE_LEGACY_CODE_PAGE.get(c.codePointAt(0)) ?? "?").join("");

test("the Keymagic layout ships in-repo, bound to the input font", () => {
  assert.match(kms, /@FONTFAMILY = "Myanmar3"/u);


  assert.match(kms, /<VK_KEY_A> => \$nbsp \+ U1031/u);
  assert.match(kms, /<VK_KEY_J> => \$nbsp \+ U103C/u);
  assert.match(kms, /<VK_KEY_S> => U103B/u);
  assert.match(kms, /\$nbsp \+ U1031 \+ \$consU\[\*\] => \$consU\[\$3\] \+ \$2/u);
});

test("slot table decodes ZawCode keying, placeholder stripped", () => {
  assert.equal(ZAWCODE_LEGACY_CODE_PAGE.size, 92);

  assert.equal(decodeSlots("ajr"), "\u1031\u103C\u1019");

  assert.equal(unmixZawCodeMarks(decodeSlots("ajr")), "\u1019\u103C\u1031");

  assert.equal(unmixZawCodeMarks(decodeSlots("aus")), "\u1000\u103B\u1031");

  for (const text of ZAWCODE_LEGACY_CODE_PAGE.values()) assert.ok(!text.includes("\u200A"));
});

test("every Myanmar code point the layout emits is named by the input cmap", () => {
  for (const text of ZAWCODE_LEGACY_CODE_PAGE.values()) {
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x1000 && cp <= 0x109F) assert.ok(ZAWCODE_INPUT_CMAP_INVENTORY.has(cp), `U+${cp.toString(16)}`);
    }
  }

  const none = buildZawCodeCodePage(new Set());
  assert.equal(none.get(32), " ");
  assert.equal(none.get(97), undefined);
  assert.ok(none.size < ZAWCODE_LEGACY_CODE_PAGE.size);
});

test("zawcode is a separate Unicode-family path, never a blanket table", () => {




  assert.deepEqual([...LEGACY_CODE_PAGES.keys()], ["ayar", "wininnwa"]);
  assert.equal(UNICODE_PATH, "unicode");
  assert.equal(ZawCODE_PATH, "zawcode");
  assert.notEqual(ZawCODE_PATH, UNICODE_PATH);
});
