import test from "node:test";
import assert from "node:assert/strict";
import { AYAR_LEGACY_CODE_PAGE, WININNWA_LEGACY_CODE_PAGE } from "../../../B.Parser/main/parser/codepage/registry.js";
import { subsetFontBridge } from "../../../B.Parser/main/parser/codepage/subset-font-bridges.js";
import * as confirmedRuns from "../../../B.Parser/main/parser/codepage/confirmed-pdf-runs.js";
import { DocumentDecoding, FontDecoder, decodeRawBytes, encodeRawByteSlots } from "../../../B.Parser/main/parser/read/pdf-fonts.js";

const bg1 = {
  fontSha256: "9b3622c34d21de53fb2a6dacd19e698f05dc46e2d32091ddefe42e23ab7916f2",
  toUnicodeSha256: "fcc371c79280827bc1ef9ab5f9f8f0b4fb6913055cd80e208067b2ccd94950d1",
  baseFont: "wininnwa", firstChar: 0, lastChar: 105, hasEncoding: false,
};
const bg2 = {
  fontSha256: "31e1447e813a2b15bee4bc4b1be515764554378cfd254ee45d9f9c0a7eda686b",
  toUnicodeSha256: "b27b2c3cbb7d4bfd83766079109b5f52cd7ed0faef761c13d63e10ac74885099",
  baseFont: "wininnwa", firstChar: 0, lastChar: 113, hasEncoding: false,
};
const grammar = {
  fontSha256: "3da8a08e4a4bf0a6629f4efa1e5c0af7ce1d1349edf6580e2c74a33b56eea0ec",
  toUnicodeSha256: "59ec84bfabcd4c3db31921b81e989e54587a3357d426c8e97a313fda29c9ebf3",
  baseFont: "arlarwade", firstChar: 33, lastChar: 146, hasEncoding: false,
};
const bytes = (...codes) => String.fromCharCode(...codes);

function decoder(profile, toUnicode) {
  const doc = new DocumentDecoding("legacy", new Map(), WININNWA_LEGACY_CODE_PAGE);
  return new FontDecoder("F4", {
    baseFont: profile.fontFamily, toUnicode, doc,
    confirmedRawRuns: profile.rawRuns, fontLegacyCodePage: profile.codePage,
  });
}

test("resource routing requires the original font and encoding, not the family name alone", () => {
  const p = subsetFontBridge(bg1);
  assert.equal(p.fontFamily, "WinInnwa");
  assert.equal(p.layoutTable, "wininnwa");
  assert.equal(p.codePage, WININNWA_LEGACY_CODE_PAGE);
  assert.equal(subsetFontBridge({ ...bg1, toUnicodeSha256: bg2.toUnicodeSha256 }), null);
  assert.equal(subsetFontBridge({ ...bg1, fontSha256: bg2.fontSha256 }), null);
  assert.equal(subsetFontBridge({ ...bg1, hasEncoding: true }), null);
  assert.equal(subsetFontBridge({ ...bg1, baseFont: "arlarwade" }), null);
  assert.equal(subsetFontBridge({ ...bg1, pdfSha256: "not-used" }).fontFamily, "WinInnwa");
  assert.deepEqual(Object.keys(confirmedRuns), ["confirmedRunAt"]);
});

test("BG1 source slots read lower consonants independently of their heads", () => {
  const p = subsetFontBridge(bg1);
  const f = decoder(p, new Map([
    [0x17, "u"], [0x0b, "w"], [0x2b, "E"], [0x5c, "Å"], [0x5f, "å"], [0x25, "ú"],
  ]));
  assert.equal(f.decode(bytes(0x0e)), " ");
  assert.equal(f.decode(bytes(0x17, 0x25)), "က္က");
  assert.equal(f.decode(bytes(0x0b, 0x5c)), "တ္တ");
  assert.equal(f.decode(bytes(0x0b, 0x5f)), "တ္တ");
  assert.equal(f.decode(bytes(0x2b, 0x5c)), "န္တ");
  assert.equal(f.decode(bytes(0x2b, 0x5f)), "န္တ");
  assert.equal(f.decode(bytes(0x25)), "္က");
  assert.equal(f.decode(bytes(0x5c)), "္တ");
  assert.equal(f.decode(bytes(0x5f)), "္တ");
  assert.equal(f.decode(bytes(0x17), { useConfirmed: false }), "က");
});

test("BG2 has its own observed space and က္က bytes", () => {
  const p = subsetFontBridge(bg2);
  const f = decoder(p, new Map([
    [0x23, "u"], [0x2f, "ú"], [0x12, " "], [0x0b, "w"], [0x1d, "E"],
    [0x64, "å"], [0x66, "¾"], [0x6c, "Å"],
  ]));
  assert.equal(f.decode(bytes(0x12)), " ");
  assert.equal(f.decode(bytes(0x23, 0x2f)), "က္က");
  assert.equal(f.decode(bytes(0x2e, 0x23, 0x2f, 0x30)), "ဥက္ကဋ္ဌ");
  assert.equal(f.decode(bytes(0x16, 0x09, 0x30, 0x1e)), "ပါဠိ");
  assert.equal(f.decode(bytes(0x2f)), "္က");
  assert.equal(f.decode(bytes(0x30)), "[30]");
  assert.equal(f.decode(bytes(0x23, 0x2f, 0x30)), "က္က[30]");
  assert.equal(f.decode(bytes(0x0b, 0x64)), "တ္တ");
  assert.equal(f.decode(bytes(0x1d, 0x6c)), "န္တ");
  assert.equal(f.decode(bytes(0x66)), "္ဂ");
  assert.equal(f.decode(bytes(0x64)), "္တ");
  assert.equal(f.decode(bytes(0x6c)), "္တ");
});

test("Arlarwade remains its actual family name while this resource uses the Ayar table", () => {
  const p = subsetFontBridge(grammar);
  assert.equal(p.fontFamily, "Arlarwade");
  assert.equal(p.layoutTable, "ayar");
  assert.equal(p.codePage, AYAR_LEGACY_CODE_PAGE);
  const f = decoder(p, new Map([[0x42, "k"], [0x7d, "¶"]]));
  assert.equal(f.decode(bytes(0x42, 0x7d)), "က္က");
});

test("source-compared Arlarwade subsets and an Amyanmar subset stay distinct", () => {
  const samples = [
    ["164ab2dc98515900ba126fe7043f0fa455ed0472f32a68fbce5d41a6565584fb", "e79d2648ec9c0f7d7c232c7688a001cf7d7a996a44073bf45368717eb03035be", "arlarwade", 140, "Arlarwade"],
    ["4c50ba818d91e8762ea8217586e7a2440747c464b433964e49e3af5dee970db6", "c85288ebecad12b06e1b601eb42891225eb9339359b9f89a978f94fc08d9484c", "arlarwade", 101, "Arlarwade"],
    ["b353b9e2e602b1a65ec182154e49d8d71d9ec9d613718f0dbf01ba02918b4a55", "d2924887b20e94564271618032bd9772d2e941618ac12897a1d9133547b191f3", "arlarwade", 96, "Arlarwade"],
    ["286c99574ea17ff9806328746e5d56fa4f3399863d44978413ba5ffc458eed59", "fca550553495f3d7c95b4add9618b72475b2929242680fddb9fd72ec9ac961e7", "arlarwade", 130, "Arlarwade"],
    ["3e4ded8b484ebbee99b171f838c34feccab7b5d64d80c6be8d7762bc62decf5b", "991906b6fc159d60b1254dc471bce6070cbe1196e6155ef199246354a35f3cbc", "amyanmar", 48, "Amyanmar"],
    ["f07054869cfd47522501716cd5a97fcede7d94ca168982dc30981058f440f4b4", "39fe8ed4cffddedd1338a1538a6f2bde0b4103998e6a0bc696919a1984bc9fe8", "amyanmar", 45, "Amyanmar"],
    ["8e1de260b78eda0c3e730fc00c66ee74d381517af765694bbf6b2de29bb6bf43", "563a7c218778c50a904ef003f890da446bbf4be68e2c26899d6e5c41307f6df2", "amyanmar", 35, "Amyanmar"],
    ["ecc7f1b3201510172ba28dfc97a17104fc71d1aa014b86d0b071fd6083df7ce7", "e0946e0e279e40d027a2cbb1313235f04718d88c86534064205fdcedf88446f2", "amyanmar", 36, "Amyanmar"],
    ["5820563de6a3ea2720f9c754563b47b302d63606b937ab64e37f189a4f3b8264", "355abfd8e2b45b5e4bfeff0db1191c5f7e057bac775760f85c09ebcf6666d848", "amyanmar", 90, "Amyanmar"],
  ];
  for (const [fontSha256, toUnicodeSha256, baseFont, lastChar, family] of samples) {
    const params = { fontSha256, toUnicodeSha256, baseFont, firstChar: 33, lastChar, hasEncoding: false };
    const p = subsetFontBridge(params);
    assert.equal(p.fontFamily, family);
    assert.equal(p.layoutTable, "ayar");
    assert.equal(subsetFontBridge({ ...params, firstChar: 34 }), null);
    assert.equal(subsetFontBridge({ ...params, hasEncoding: true }), null);
  }
});

test("an exact Amyanmar sample uses the Ayar table without renaming the font", () => {
  const p = subsetFontBridge({
    fontSha256: "f07054869cfd47522501716cd5a97fcede7d94ca168982dc30981058f440f4b4",
    toUnicodeSha256: "39fe8ed4cffddedd1338a1538a6f2bde0b4103998e6a0bc696919a1984bc9fe8",
    baseFont: "amyanmar", firstChar: 33, lastChar: 45, hasEncoding: false,
  });
  const f = decoder(p, new Map([[0x21, "q"], [0x22, "d"], [0x23, "»"], [0x24, "å"]]));
  assert.equal(f.decode(bytes(0x21, 0x22, 0x23, 0x24)), "သဒ္ဒါ");
});

test("review candidates in raw-slot helpers require explicit diagnostic opt-in", () => {
  const profile = { bytes: { "01": "က" }, resolvedForReview: { "02": "ခ" } };
  assert.equal(decodeRawBytes(Uint8Array.of(1), profile), "က");
  assert.throws(() => decodeRawBytes(Uint8Array.of(2), profile), /Unmapped raw PDF byte 02/);
  assert.equal(decodeRawBytes(Uint8Array.of(2), profile, { includeReview: true }), "ခ");
  assert.throws(() => encodeRawByteSlots(["ခ"], profile), /Unresolved raw glyph/);
  assert.deepEqual(encodeRawByteSlots(["ခ"], profile, { includeReview: true }), Uint8Array.of(2));
});

test("a source without ToUnicode can still use a supplied legacy table", () => {
  const doc = new DocumentDecoding("legacy", new Map(), WININNWA_LEGACY_CODE_PAGE);
  const f = new FontDecoder("F", { baseFont: "WinInnwa", doc });
  assert.equal(f.decode(bytes(0x75)), "က");
});

test("a selected keyboard layout follows PDF Differences independently of the face name", () => {
  const doc = new DocumentDecoding("legacy", new Map(), WININNWA_LEGACY_CODE_PAGE, {
    legacyFontNames: ["DecorativeFace"],
  });
  const options = {
    baseFont: "DecorativeFace", doc, hasEncoding: true, encodingHasDifferences: true,
    encoding: new Map([[1, "t"], [2, "c"], [3, "s"], [4, "d"], [5, "e"], [6, "f"], [7, "u"], [8, "k"],
      [9, " "], [10, "|"]]),
  };
  const f = new FontDecoder("F", options);
  // PDF-local 01..08 represent WinInnwa character slots tcsdefuk.
  assert.equal(f.decode(bytes(1, 2, 3, 4, 5, 6, 7, 4, 8)), "အချိန်ကို");
  assert.equal(f.decode(bytes(10)), "|"); // An unresolved layout slot stays visible.
  const other = new FontDecoder("Other", { ...options, baseFont: "EnglishFace" });
  assert.equal(other.decode(bytes(1, 2, 3)), "tcs");
});
