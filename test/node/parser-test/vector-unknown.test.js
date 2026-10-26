import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { englishLikeness } from "../../../Parser/main/parser/text/mm-score.mjs";
import {
  LEGACY_CODE_PAGES,
  WININNWA_LEGACY_CODE_PAGE,
} from "../../../Parser/main/parser/codepage/registry.mjs";
import { buildVectorOutlineLayout } from "../../../Parser/main/parser/codepage/vector-repair.mjs";
import {
  loadDetector,
  streamPdfPages,
} from "../../../Parser/extend/pipeline.mjs";
import { prepareVectorLayout } from "../../../Parser/main/parser/codepage/resolve.mjs";

/**
 * Reliability of the outline layout-table build for UNKNOWN fonts, end to end.
 *
 * The fixture is the real legacy-layout document bg-mlc-1-1.pdf (embedded
 * WinInnwa). "Unknown" is produced by a length-preserving rename of the
 * embedded font's /BaseFont and /FontDescriptor /FontName, so every byte of
 * glyph data, every stream and every ToUnicode map is untouched -- only the
 * name the repository could recognise is gone.
 *
 * Scenarios:
 *   S1 the one-sided English check separates real Latin faces from the
 *      keyboard layout's junk ASCII (words, not sentences)
 *   S2 the outline build is name-blind and deterministic
 *   S3 the outline-identified face carries its real /BaseFont names
 *   S4 the renamed document decodes BOTH its English and its Myanmar
 *      (the headline acceptance of the restructure)
 *   S5 a clean Zawgyi-Type0 document is never vector-mapped
 *   S6 a font with neither a known name nor a ToUnicode never decodes
 *      through a vector layout
 *   S7 the pre-vector fallback still decodes the Myanmar body
 *   S8 buildVectorOutlineLayout accepts pre-parsed objects (pipeline reuse)
 */
// working-branch mapping: Parsed/fixtures/ exists on no branch and the
// site frontend samples are not in this tree; both books are tracked here
// as upload fixtures (the site sample.pdf is byte-identical to this one).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "..", "..", "..", "Parser", "main", "File", "upload", "pdf", "bg-mlc-1-1.pdf");
const SAMPLE = path.join(HERE, "..", "..", "..", "Parser", "main", "File", "upload", "pdf", "sample.pdf");
const KNOWN_NAME = "EAAAAA+WinInnwa";
// Same byte length (15) so the rename never moves a PDF offset.
const UNKNOWN_NAME = "QQXZT7+Fntb00k1";

function renameFont(bytes, from, to) {
  const needle = Buffer.from(from);
  const out = Buffer.from(bytes);
  assert.equal(needle.length, Buffer.byteLength(to), "rename must be length-preserving");
  const repl = Buffer.from(to);
  let count = 0;
  let idx = 0;
  while ((idx = out.indexOf(needle, idx)) !== -1) {
    repl.copy(out, idx);
    count += 1;
    idx += needle.length;
  }
  return { bytes: out, count };
}

/** Blank the /ToUnicode reference of the named font, keeping byte offsets. */
function blankToUnicode(bytes, baseFontName) {
  const out = Buffer.from(bytes);
  const fontNeedle = Buffer.from(`/${baseFontName}`);
  let at = out.indexOf(fontNeedle);
  while (at >= 0) {
    const objStart = out.lastIndexOf("obj", at);
    const objEnd = out.indexOf("endobj", at);
    const dict = out.subarray(objStart, objEnd);
    const tou = /\/ToUnicode\s+(\d+)\s+(\d+)\s+R/.exec(dict.toString("latin1"));
    if (tou) {
      const token = `/ToUnicode ${tou[1]} ${tou[2]} R`;
      const tokenAt = objStart + dict.indexOf(Buffer.from(token));
      out.fill(0x20, tokenAt, tokenAt + token.length);
      return out;
    }
    at = out.indexOf(fontNeedle, at + fontNeedle.length);
  }
  throw new Error(`no /ToUnicode found next to ${baseFontName}`);
}

const original = fs.readFileSync(FIXTURE);
const renamed = renameFont(original, KNOWN_NAME, UNKNOWN_NAME);
assert.equal(renamed.count, 2, "expected /BaseFont + /FontName occurrences");

// Shared builds (each probes pages and votes the embedded outlines).
const logsKnown = [];
const logsUnknown = [];
const layoutKnown = await prepareVectorLayout(original, (l) => logsKnown.push(String(l)));
const layoutUnknown = await prepareVectorLayout(renamed.bytes, (l) => logsUnknown.push(String(l)));

/** Decode the first page through the full pipeline and collect its log. */
async function decodeFirstPage(bytes, vectorLayout) {
  const logs = [];
  const [, , iterator] = streamPdfPages(bytes, loadDetector(), (l) => logs.push(String(l)), { vectorLayout });
  const first = iterator.next().value;
  assert.ok(first, "first page must decode");
  return { text: first.text, logs };
}

test("S1: the one-sided English check separates Latin faces from layout junk", () => {
  // Real text decoded from the fixture's Latin faces (DejaVu): English words,
  // exactly how a Burmese book uses English.
  assert.equal(
    englishLikeness("Update: 2012-12-11 02:17 AM +0630BGo1-1.htm{ mrûn-ma þûd~da}, Volume 1, "
      + "Module 1, byMyanmar Language Commission (MLC), Ministry of Education, Governme").verdict,
    "english",
  );
  assert.equal(
    englishLikeness("TILMyanmar Grammar: MLCin three volumesMyanmar Thuddar Myanmar Thuddar ").verdict,
    "english",
  );
  assert.equal(englishLikeness("Myanmar Grammar: MLC in three volumes").verdict, "english");

  // Real WinInnwa /ToUnicode output: spaced romanized junk, not English. It
  // contains spaces and real punctuation, so spaces alone can never clear a
  // font -- the words themselves must be judged.
  assert.equal(
    englishLikeness("jrefrmo'gtwGJ (1)? tcef; (1)trSmpmjrefrmo'gukd twGJ(3) wGJcGJum jyKpkygonf/").verdict,
    "not-english",
  );
  assert.equal(englishLikeness("pneumonoultramicroscopicsilicovolcanoconiosis").verdict, "not-english");

  // One-sided: too little signal is NEVER "english" -- the pixels decide.
  assert.equal(englishLikeness("hello!").verdict, null);
  assert.equal(englishLikeness("MLC").verdict, null);
  assert.equal(englishLikeness("•").verdict, null);
});

test("S2: the outline layout build is name-blind and deterministic for an unknown font", () => {
  assert.ok(layoutKnown && layoutUnknown, "both builds must produce a layout");

  // Identical table content, decision for decision.
  assert.equal(layoutUnknown.baseLayout, layoutKnown.baseLayout);
  assert.equal(layoutUnknown.matched, layoutKnown.matched);
  for (const [code, text] of layoutKnown.decisions) {
    assert.equal(layoutUnknown.decisions.get(code), text, `decision for code 0x${code.toString(16)}`);
  }
  assert.equal(layoutUnknown.decisions.size, layoutKnown.decisions.size);

  // The correct registered base layout wins the outline vote.
  assert.equal(layoutUnknown.baseLayout, "wininnwa");
  const votes = new Map(layoutUnknown.votes);
  assert.ok(votes.get("wininnwa") > votes.get("ayar"), "wininnwa must out-vote ayar");

  // Per-slot outline precision, aggregated into a correct vote.
  let agree = 0;
  let contra = 0;
  for (const [code, text] of layoutUnknown.decisions) {
    const truth = WININNWA_LEGACY_CODE_PAGE.get(code);
    if (truth === undefined) continue;
    if (truth === text) agree += 1;
    else contra += 1;
  }
  assert.ok(agree > contra, `vote majority must be correct (agree ${agree} vs contradict ${contra})`);
  assert.ok(agree / (agree + contra) >= 0.55, `per-slot precision must stay above 55% (got ${agree}/${agree + contra})`);

  // Safety of the fill policy: the built table never contradicts the base.
  for (const [code, text] of layoutUnknown.table) {
    assert.equal(text, WININNWA_LEGACY_CODE_PAGE.get(code), `table slot 0x${code.toString(16)}`);
  }
  assert.notEqual(layoutUnknown.table, WININNWA_LEGACY_CODE_PAGE, "the built table is a document-specific copy");
});

test("S3: the outline-identified face carries its real /BaseFont names", () => {
  // The build reads the font dicts itself (the pixel builder needed a
  // descriptor-metrics detour because PDF.js hides /BaseFont), so the
  // winning face's own name keys the decode-time font gate directly --
  // earned by its outlines whether or not the repository has ever seen
  // the name, which is the whole point for the renamed face here.
  assert.deepEqual(layoutUnknown.sourceBaseFonts, [UNKNOWN_NAME]);
  assert.deepEqual(layoutKnown.sourceBaseFonts, [KNOWN_NAME]);
  assert.ok(
    logsUnknown.some((line) => /in font "QQXZT7\+Fntb00k1"/u.test(line)),
    "the build log must name the face that earned the layout",
  );

  // The English check kept the Latin faces out of the Myanmar vote, logged
  // once (not once per probe page).
  const exclusions = logsUnknown.filter((line) => /English face.*excluded from the Myanmar vote/u.test(line));
  assert.equal(exclusions.length, 1, `expected exactly one exclusion log, got ${exclusions.length}`);
  const excludedNames = [...exclusions[0].matchAll(/"([^"]+)"/gu)].map((m) => m[1]);
  assert.equal(excludedNames.length, 2, "both DejaVu Latin faces must be excluded");
  assert.notEqual(layoutUnknown.sourceFont, excludedNames[0]);
  assert.notEqual(layoutUnknown.sourceFont, excludedNames[1]);
});

test("S4: the renamed document decodes BOTH its English and its Myanmar", async () => {
  // The headline acceptance of the restructure: bg-mlc with a font name the
  // repository has never seen decodes exactly like the original -- the
  // outline-earned /BaseFont keys open the decode-time font gate, so the
  // vector table is applied to the renamed face instead of its junk ToUnicode.
  const { text, logs } = await decodeFirstPage(renamed.bytes, layoutUnknown);

  assert.ok(text.startsWith("Update: 2012-12-11"), `page 1 must start with the header, got ${JSON.stringify(text.slice(0, 30))}`);
  assert.ok(text.includes("Myanmar Grammar: MLC"), "the English title line must survive");
  assert.ok(text.includes("မြန်မာသဒ္ဒါ"), "the Myanmar body must survive");
  const latinWords = text.match(/[A-Za-z]+/g) || [];
  assert.ok(latinWords.length >= 100, `Latin words must be preserved (got ${latinWords.length}, baseline 116)`);

  // The vector layout is the chosen code page, not a 0.000 name-gated score.
  assert.ok(logs.some((line) => /text path "vector:WinInnwa": 0\.98\d\s+<- chosen/u.test(line)));
  assert.ok(logs.includes('[+] Decoding via "vector:WinInnwa" character map'));
});

test("S5: a clean Zawgyi-Type0 document is never vector-mapped", async () => {
  // sample.pdf embeds ABCDEE+Zawgyi-One (Type0): a Unicode-codepoint font,
  // not a legacy keyboard layout, so detectLegacyLayoutFonts flags nothing
  // and the vector path must stay closed -- one regular path for both
  // Zawgyi-One and Unicode documents.
  const bytes = fs.readFileSync(SAMPLE);
  const layout = await prepareVectorLayout(bytes);
  assert.equal(layout, null, "no vector layout may be built for a Zawgyi-Type0 document");

  const { text, logs } = await decodeFirstPage(bytes, null);
  // Glyph-scale vector *repair* logging is fine (it only names ids the
  // decoder cannot); the vector *layout* machinery must stay out.
  assert.ok(!logs.some((line) => /"vector:|Vector layout/iu.test(line)), "no vector layout machinery may engage");
  assert.ok(/[\u1000-\u109F]/u.test(text), "the Myanmar body must decode through the regular path");
  assert.ok(text.includes("God of Slaughter"), "the English lines must decode through the regular path");
});

test("S6: a font with neither a known name nor a ToUnicode never decodes through a vector layout", async () => {
  // With the /ToUnicode of the renamed font blanked, the Myanmar face
  // cannot seat its glyphs, so the outline build has nothing to vote on
  // from it. The English check excludes the Latin faces; any layout that
  // still gets built must be kept out of the decode by the quality floor.
  const stripped = blankToUnicode(renamed.bytes, UNKNOWN_NAME);
  const buildLogs = [];
  const layout = await prepareVectorLayout(stripped, (l) => buildLogs.push(String(l)));

  if (layout) {
    const exclusions = buildLogs.filter((line) => /English face.*excluded from the Myanmar vote/u.test(line));
    assert.ok(exclusions.length >= 1, "the Latin faces must be excluded from the vote");
    const excludedNames = [...exclusions[0].matchAll(/"([^"]+)"/gu)].map((m) => m[1]);
    assert.ok(excludedNames.length >= 2, "both DejaVu Latin faces must be excluded");
    assert.notEqual(layout.sourceFont, excludedNames[0], "the build must not vote a Latin face");
    assert.notEqual(layout.sourceFont, excludedNames[1], "the build must not vote a Latin face");
  }

  const { logs } = await decodeFirstPage(stripped, layout);
  assert.ok(
    !logs.some((line) => /Decoding via "vector:/u.test(line)),
    "a layout built without a usable map must never be applied",
  );
});

test("S7: without the vector layout the fallback still decodes the Myanmar body", async () => {
  // The PRASER_VECTOR_LAYOUT=0 safety net: the registered wininnwa table
  // still decodes the Myanmar body; the Latin lines are garbled by the
  // whole-document map -- the pre-vector behaviour the outline build exists to
  // fix, kept working so the gate can always be turned off.
  const { text, logs } = await decodeFirstPage(renamed.bytes, null);
  assert.ok(text.includes("မြန်မာသဒ္ဒါ"), "the Myanmar body must still decode");
  assert.equal((text.match(/[A-Za-z]+/g) || []).length, 0, "Latin words are garbled by the whole-document map");
  assert.ok(!logs.some((line) => /Decoding via "vector:/u.test(line)));
  assert.ok(logs.some((line) => /Decoding via "wininnwa" character map/u.test(line)));
});

test("S8: buildVectorOutlineLayout reuses pre-parsed objects and matches the direct build", async () => {
  // The pipeline parses the document once and hands the objects to the
  // build; the build must produce the identical layout with or without them.
  const direct = buildVectorOutlineLayout(renamed.bytes, LEGACY_CODE_PAGES);
  assert.ok(direct, "the objects-free build must produce a layout");
  assert.equal(direct.name, layoutUnknown.name);
  assert.equal(direct.baseLayout, layoutUnknown.baseLayout);
  assert.deepEqual(direct.sourceBaseFonts, layoutUnknown.sourceBaseFonts);
  for (const [code, text] of direct.decisions) {
    assert.equal(layoutUnknown.decisions.get(code), text, `decision for code 0x${code.toString(16)}`);
  }
  assert.equal(direct.decisions.size, layoutUnknown.decisions.size);
});
