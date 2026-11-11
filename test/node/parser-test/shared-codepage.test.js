import test from "node:test";
import assert from "node:assert/strict";
import {
  AYAR_LEGACY_CODE_PAGE,
  SHARED_LEGACY_CODE_PAGE,
  WININNWA_LEGACY_CODE_PAGE,
  lookupLegacyCode,
} from "../../../B.Parser/prised/@core/pdf/method/legacy/codepage-registry.js";

test("shared legacy entries are exactly the equal keys and values in both original tables", () => {
  assert.deepEqual([...SHARED_LEGACY_CODE_PAGE], [
    [32, " "], [40, "("], [41, ")"], [43, "+"], [45, "—"],
    [48, "၀"], [49, "၁"], [50, "၂"], [51, "၃"], [52, "၄"],
    [53, "၅"], [54, "၆"], [56, "၈"], [57, "၉"], [59, "း"],
    [61, "="], [125, "’"],
  ]);
  const keys = new Set([...AYAR_LEGACY_CODE_PAGE.keys(), ...WININNWA_LEGACY_CODE_PAGE.keys()]);
  for (const code of keys) {
    const agrees = AYAR_LEGACY_CODE_PAGE.has(code)
      && WININNWA_LEGACY_CODE_PAGE.has(code)
      && AYAR_LEGACY_CODE_PAGE.get(code) === WININNWA_LEGACY_CODE_PAGE.get(code);
    assert.equal(SHARED_LEGACY_CODE_PAGE.has(code), agrees, `entry ${code}`);
    if (agrees) assert.equal(SHARED_LEGACY_CODE_PAGE.get(code), AYAR_LEGACY_CODE_PAGE.get(code));
  }
});

test("the original tables retain their distinct entries for က", () => {
  assert.equal(AYAR_LEGACY_CODE_PAGE.get(107), "က");
  assert.equal(WININNWA_LEGACY_CODE_PAGE.get(117), "က");
  assert.equal(SHARED_LEGACY_CODE_PAGE.get(107), undefined);
  assert.equal(SHARED_LEGACY_CODE_PAGE.get(117), undefined);
});

test("shared lookup preserves each table's conflicts, wide keys and empty values", () => {
  for (const [code, value] of SHARED_LEGACY_CODE_PAGE) {
    assert.equal(lookupLegacyCode(code, AYAR_LEGACY_CODE_PAGE), value);
    assert.equal(lookupLegacyCode(code, WININNWA_LEGACY_CODE_PAGE), value);
  }
  assert.equal(lookupLegacyCode(107, AYAR_LEGACY_CODE_PAGE), "က");
  assert.equal(lookupLegacyCode(107, WININNWA_LEGACY_CODE_PAGE), "ု");
  assert.equal(lookupLegacyCode(402, AYAR_LEGACY_CODE_PAGE), "္ခ");
  assert.equal(lookupLegacyCode(95, AYAR_LEGACY_CODE_PAGE), "");
  assert.equal(lookupLegacyCode(40, new Map([[40, "custom"]])), "custom");
});
