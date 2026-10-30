import { AYAR_LEGACY_CODE_PAGE, WININNWA_LEGACY_CODE_PAGE } from "./registry.js";

// These are the original simple-font resources, not keyboard layouts or
// family-wide PDF-byte maps. A program hash alone is insufficient: a PDF can
// reuse the same font with a different encoding or ToUnicode bridge.
const PROFILES = new Map([
  ["9b3622c34d21de53fb2a6dacd19e698f05dc46e2d32091ddefe42e23ab7916f2", {
    baseFont: "wininnwa",
    toUnicodeSha256: "fcc371c79280827bc1ef9ab5f9f8f0b4fb6913055cd80e208067b2ccd94950d1",
    firstChar: 0,
    lastChar: 105,
    codePage: WININNWA_LEGACY_CODE_PAGE,
    // Book 1's source dictionary and the repeated-consonant context were
    // checked independently. A bare 25 remains unresolved outside 17 25.
    rawRuns: {
      bytes: new Map([[0x0e, " "], [0x17, "က"]]),
      runs: [
        { bytes: [0x17, 0x25], text: "က္က" },
        { bytes: [0x07, 0x08], text: "ဒ္ဒ" },
        { bytes: [0x0B, 0x5C], text: "တ္တ" },
        { bytes: [0x2B, 0x5F], text: "န္တ" },
      ],
      unresolved: new Set([0x08, 0x25, 0x5C, 0x5F]),
    },
  }],
  ["3da8a08e4a4bf0a6629f4efa1e5c0af7ce1d1349edf6580e2c74a33b56eea0ec", {
    baseFont: "arlarwade",
    toUnicodeSha256: "59ec84bfabcd4c3db31921b81e989e54587a3357d426c8e97a313fda29c9ebf3",
    firstChar: 33,
    lastChar: 146,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
]);

export function subsetFontBridge({ fontSha256, toUnicodeSha256, baseFont, firstChar, lastChar, hasEncoding }) {
  const profile = PROFILES.get(fontSha256);
  if (!profile || hasEncoding || profile.toUnicodeSha256 !== toUnicodeSha256
      || profile.baseFont !== baseFont || profile.firstChar !== firstChar || profile.lastChar !== lastChar) return null;
  return profile;
}
