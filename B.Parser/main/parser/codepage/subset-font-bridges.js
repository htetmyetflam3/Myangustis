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
    // These are confirmed PDF codes for this subset, not universal keys.
    rawRuns: {
      bytes: new Map([[0x0e, " "], [0x17, "က"], [0x25, "္က"]]),
      runs: [
        { bytes: [0x17, 0x25], text: "က္က" },
        { bytes: [0x07, 0x08], text: "ဒ္ဒ" },
        { bytes: [0x0B, 0x5C], text: "တ္တ" },
        { bytes: [0x2B, 0x5F], text: "န္တ" },
      ],
      unresolved: new Set([0x08, 0x5C, 0x5F]),
    },
  }],
  ["31e1447e813a2b15bee4bc4b1be515764554378cfd254ee45d9f9c0a7eda686b", {
    baseFont: "wininnwa",
    toUnicodeSha256: "b27b2c3cbb7d4bfd83766079109b5f52cd7ed0faef761c13d63e10ac74885099",
    firstChar: 0,
    lastChar: 113,
    codePage: WININNWA_LEGACY_CODE_PAGE,
    rawRuns: {
      bytes: new Map([[0x07, "ဒ"], [0x08, "္ဒ"]]),
      runs: [
        { bytes: [0x06, 0x07, 0x08, 0x09], text: "သဒ္ဒါ" },
        { bytes: [0x07, 0x08], text: "ဒ္ဒ" },
        { bytes: [0x0B, 0x64], text: "တ္တ" },
        { bytes: [0x1D, 0x6C], text: "န္တ" },
      ],
      unresolved: new Set([0x64, 0x66, 0x6C]),
    },
  }],
  // These resources were compared with their rendered pages. They use the
  // existing Ayar converter via their own ToUnicode maps, not new raw-code
  // mappings or a family-wide assumption. Other subsets keep the default.
  ["3e4ded8b484ebbee99b171f838c34feccab7b5d64d80c6be8d7762bc62decf5b", {
    baseFont: "amyanmar",
    toUnicodeSha256: "991906b6fc159d60b1254dc471bce6070cbe1196e6155ef199246354a35f3cbc",
    firstChar: 33,
    lastChar: 48,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["d194872a20d4ff557d6d1ce4b56aa627e97337fa933b87a3f0493245b8158d4f", {
    baseFont: "amyanmar",
    toUnicodeSha256: "1230aca5e1bcb1edcc0651d729ad8cce5b8d110a55af081ffa4c181a849e22e5",
    firstChar: 33,
    lastChar: 46,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["e612eea60822c6ff2f54bedc7c796f33c83ddc3065e43295f854545a9190086e", {
    baseFont: "amyanmar",
    toUnicodeSha256: "4fcdfa9ad74dd85730e10c7332af6f4b3f475e340e39d7fcca2cf2ecf33382b0",
    firstChar: 33,
    lastChar: 48,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["e0dbbbdae4992916c9dd8e169daa3d9ff0b4af3ac5e49cb0c44ba5485693260c", {
    baseFont: "amyanmar",
    toUnicodeSha256: "049014f73488443d0a1943aaf9866389ab77f6d7789fae5742ceaf5984e47ac0",
    firstChar: 33,
    lastChar: 45,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["5ae40cd07325483a2ccf011f583c185d330ca0eeb6b5119730a8f9bb198ba39d", {
    baseFont: "amyanmar",
    toUnicodeSha256: "1e641816e4a556944bfb864061626c83fd65867aa8529a937c005a9a452b0847",
    firstChar: 33,
    lastChar: 149,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["4d6aa345dd1b88e650c0b700cd51b336bf0d0ba7016b559ca9f5f562b1ab46ea", {
    baseFont: "arlarwade",
    toUnicodeSha256: "f598de0e4a176739e8e3c447480bd322fd0b01a4c80fb1d97b7bffd1750b27c1",
    firstChar: 33,
    lastChar: 140,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["ab7518c9f0347ee639244fe89fce37115fb9f4fd0fa5b7b065c08ff104bb4c25", {
    baseFont: "arlarwade",
    toUnicodeSha256: "bd52660177ecf1c893d399c2337ce2b22f6da146495d0c00762209d03a7dfca3",
    firstChar: 33,
    lastChar: 160,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["f7e6dc277e5783f5dfbddc1b023ed3bf98e0a0ab60a17d1a446c6c143c29d924", {
    baseFont: "arlarwade",
    toUnicodeSha256: "08e548c15cf5bb59ce17f8187aca6f79e95b9281c3788322a03be8d7c01bf5ff",
    firstChar: 33,
    lastChar: 129,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["3a59ab947871b19d1eaaebc827995f2eb13177771af040c03436e5425392350f", {
    baseFont: "arlarwade",
    toUnicodeSha256: "c02bbe18522c2beb049b59bdd629a2e7de7eaace2cc7a0688b67f01dec39c184",
    firstChar: 33,
    lastChar: 121,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["b89b5fe3daba90ad860720610d39142ea965ac5a83ce889084c6c75afa9858e3", {
    baseFont: "arlarwade",
    toUnicodeSha256: "28f39c1845d59dbe3cab976efbcbf32a790916ba2a3f3200686d521397177f2a",
    firstChar: 33,
    lastChar: 142,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["a7c9e0380ddaa992b8544130db21696438cbe6ec1b0afd8f262c9fc699623437", {
    baseFont: "arlarwade",
    toUnicodeSha256: "c155b0d0b2f4c55d5bdaa686e9c7b0f4a40e49cc349510a4e6e40d405438cc9b",
    firstChar: 33,
    lastChar: 136,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
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
