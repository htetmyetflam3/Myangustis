import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as fontkit from "fontkit";
import { PDFDocument, PDFName } from "pdf-lib";

import { parseTtfCmap } from "../../../B.Parser/main/parser/core/ttf-cmap.js";
import { DocumentDecoding, FontDecoder } from "../../../B.Parser/main/parser/read/pdf-fonts.js";
import { streamPdfPages } from "../../../B.Parser/core/decoding/source-decoding.js";
import {
  decodeVisualUnicodeRun, hasVisualUnicodeConflicts, matchVisualUnicodeGlyphs,
} from "../../../B.Parser/main/parser/codepage/visual-unicode-glyphs.js";

// GIDs below are observations from the embedded resource on merged part 7,
// page 64, not keyboard slots or a map for other fonts. The witness is the
// full TharLon layout font in this repository.
const fontBytes = fs.readFileSync(new URL("../../../Junk/fonts/Unicode/TharLon.ttf", import.meta.url));
const cmap = parseTtfCmap(fontBytes);
const gid = (ch) => cmap.get(ch.codePointAt(0));
const raw = (...gids) => Buffer.from(gids.flatMap((value) => [value >>> 8, value & 255])).toString("latin1");

function directGlyphs(bytes = fontBytes) {
  const own = new Map();
  own.direct = new Map();
  own.ambiguous = new Set();
  for (const [cp, id] of parseTtfCmap(bytes)) {
    if (!id) continue;
    own.set(id, cp);
    if (own.direct.has(id) && own.direct.get(id) !== cp) {
      own.direct.delete(id);
      own.ambiguous.add(id);
    } else if (!own.ambiguous.has(id)) own.direct.set(id, cp);
  }
  return own;
}

function observedMappings() {
  return new Map([
    [gid("ဂ"), "ြ"], [gid("ဈ"), "ေ"],
    [499, "တ"], [461, "ဖ"], [508, "ေ"], [510, "ေ"], [377, "့"], [498, "ါ"],
    [382, "ျှ"], [384, "ွှ"], [419, "က"],
    [gid("ပ"), "ပ"], [gid("ဖ"), "ဖ"], [gid("မ"), "မ"], [gid("တ"), "တ"], [gid("လ"), "လ"],
    [gid("အ"), "အ"], [gid("ာ"), "ာ"], [gid("ေ"), "ေ"], [gid("ရ"), "ွ"],
    [gid("ဝ"), "ဝ"], [gid("၀"), "၀"], [gid("၈"), "၈"],
    [0xfff0, "\u200d"], [0xfff1, "ုု"], [0xfff2, "င်္ီ"],
  ]);
}

function observedDecoder({ toUnicode = observedMappings(), bytes = fontBytes, cidToGid = null } = {}) {
  return new FontDecoder("fixture", {
    isCid: true, toUnicode, ownGids: directGlyphs(bytes), doc: new DocumentDecoding("font"), cidToGid,
  });
}

function enable(decoder, bytes = fontBytes) {
  decoder.visualUnicodeGlyphs = matchVisualUnicodeGlyphs(decoder, bytes);
  assert.ok(decoder.visualUnicodeGlyphs);
  return decoder;
}

test("glyph recovery requires both direct contradictions and independent full-font witnesses", () => {
  const decoder = observedDecoder();
  assert.equal(hasVisualUnicodeConflicts(decoder), true);
  const roles = matchVisualUnicodeGlyphs(decoder, fontBytes);
  assert.equal(roles.get(499).role, "e");
  assert.equal(roles.get(461).role, "ra");
  assert.equal(roles.get(377).role, "kinzi");
  assert.equal(roles.get(508).role, "ya");
  assert.equal(roles.get(510).role, "wa");
  assert.equal(roles.get(419).role, "raWa");

  const correct = observedMappings();
  correct.set(gid("ဂ"), "ဂ");
  correct.set(gid("ဈ"), "ဈ");
  assert.equal(hasVisualUnicodeConflicts(observedDecoder({ toUnicode: correct })), false);
  assert.equal(matchVisualUnicodeGlyphs(observedDecoder({ toUnicode: correct }), fontBytes), null);
  assert.equal(matchVisualUnicodeGlyphs(decoder, Buffer.from("not a font")), null);
  const pyidaungsu = fs.readFileSync(new URL("../../../Junk/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF", import.meta.url));
  assert.equal(matchVisualUnicodeGlyphs(decoder, pyidaungsu), null);
  const insufficient = observedDecoder();
  insufficient.ownGids.direct = new Map([...insufficient.ownGids.direct].filter(([, cp]) => cp < 0x1004));
  assert.equal(matchVisualUnicodeGlyphs(insufficient, fontBytes), null);
});

test("witnessed visual marks respect raw CID-to-GID mappings and cluster boundaries", () => {
  const decoder = enable(observedDecoder());
  const decode = (...ids) => decodeVisualUnicodeRun(decoder, ids.map((id) => raw(id)));
  assert.equal(decode(499, gid("ပ")), "ပေ");
  assert.equal(decode(499, 461, gid("ဖ")), "ဖြေ");
  assert.equal(decode(499, gid("တ"), 510), "တွေ");
  assert.equal(decode(499, 461, gid("ဖ"), 510), "ဖြွေ");
  assert.equal(decode(419, gid("က"), gid("ယ"), gid("်")), "ကြွယ်");
  assert.equal(decode(499, 419, gid("က")), "ကြွေ");
  assert.equal(decode(499, gid("လ"), 382), "လျှေ");
  assert.equal(decode(499, gid("မ"), 384), "မွှေ");
  assert.equal(decode(gid("ရ")), "ရ");
  assert.equal(decode(gid("ဝ"), gid("၀"), gid("၈")), "ဝ၀၈");
  assert.equal(decode(gid("အ"), gid("ဂ"), 377, 498), "အင်္ဂါ");
  decoder.toUnicode.set(377, "ဂ");
  assert.equal(decode(gid("အ"), gid("ဂ"), 377, 498), "အင်္ဂါ");
  decoder.toUnicode.set(377, "့");
  assert.equal(decode(gid("မ"), 508, gid("ာ")), "မျာ");
  assert.equal(decode(gid("ပ"), gid("ေ"), gid("က")), "ပေက");
  assert.equal(decode(gid("ပ"), 0xfff0, 377), "ပ\u200d့");
  assert.equal(decode(gid("ပ"), 0xfff1, 0xfff2), "ပုုင်္ီ");
  assert.equal(decodeVisualUnicodeRun(decoder, ["\x01"]), "[01]");

  const source = observedMappings();
  source.set(508, "ျေး");
  const multi = enable(observedDecoder({ toUnicode: source }));
  assert.equal(decodeVisualUnicodeRun(multi, [raw(gid("မ"), 508)]), "မျေး");
  source.set(508, "ျေ");
  assert.equal(decodeVisualUnicodeRun(multi, [raw(gid("မ"), 508)]), "မျေ");

  const lookup = new Map([[10, 499], [11, gid("ပ")], [12, gid("ဂ")], [13, gid("ဈ")], [14, 377]]);
  const tu = new Map([[10, "တ"], [11, "ပ"], [12, "ြ"], [13, "ေ"], [14, "့"]]);
  const mapped = enable(observedDecoder({ toUnicode: tu, cidToGid: (cid) => lookup.get(cid) ?? 0 }));
  assert.equal(decodeVisualUnicodeRun(mapped, [raw(10, 11)]), "ပေ");
  assert.equal(decodeVisualUnicodeRun(mapped, [raw(12, 14)]), "င်္ဂ");
});

async function pdfWithObservedResource({ bytes = fontBytes, mappings = observedMappings(), content = null } = {}) {
  let pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(bytes, { subset: false });
  pdf.addPage([400, 400]).drawText("ကခဂပေ", { font, x: 20, y: 350 });
  pdf = await PDFDocument.load(await pdf.save({ useObjectStreams: false }));
  const page = pdf.getPage(0);
  const fonts = page.node.Resources().lookup(PDFName.of("Font"));
  const name = fonts.keys()[0];
  const resource = fonts.lookup(name);
  const pairs = [...mappings].filter(([code]) => code < 0xfff0)
    .map(([code, value]) => `<${code.toString(16).padStart(4, "0")}> <${[...value].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("")}>`);
  const toUnicode = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CMapType 2 def\n`
    + `1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${pairs.length} beginbfchar\n`
    + `${pairs.join("\n")}\nendbfchar\nendcmap\nend end\n`;
  resource.set(PDFName.of("ToUnicode"), pdf.context.register(pdf.context.stream(toUnicode)));
  const hex = (bytes) => Buffer.from(bytes, "latin1").toString("hex");
  const operations = content ? content(name) : `BT ${name} 15 Tf 1 0 0 1 20 350 Tm <${hex(raw(499, gid("ပ")))}> Tj `
    + `<${hex(raw(gid("အ"), gid("ဂ"), 377, 498))}> Tj ET`;
  page.node.set(PDFName.of("Contents"), pdf.context.obj([pdf.context.register(pdf.context.stream(operations))]));
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

test("file-backed PDF reading reports witnessed recovery but honors a forced Zawgyi source", async () => {
  const bytes = await pdfWithObservedResource();
  for (const sourceEncoding of ["auto", "unicode"]) {
    const [, , pages] = streamPdfPages(bytes, () => {}, { sourceEncoding });
    try {
      const page = pages.next().value;
      assert.equal(page.text, "ပေအင်္ဂါ");
      assert.ok(page.warnings.some((w) => w.code === "unicode-glyph-recovery-needs-review"));
      assert.equal(page.parsingPath, "font-cmap");
    } finally { pages.return?.(); }
  }
  const [, , pages] = streamPdfPages(bytes, () => {}, { sourceEncoding: "zawgyi-one" });
  try {
    const page = pages.next().value;
    assert.ok(!page.warnings?.some((w) => w.code === "unicode-glyph-recovery-needs-review"));
    assert.notEqual(page.text, "ပေအင်္ဂါ");
  } finally { pages.return?.(); }
});

test("space-dominated ToUnicode retains a separately drawn witnessed kinzi", async () => {
  const bytes = fs.readFileSync(new URL("../../../Junk/fonts/Unicode/mm3_05-Jan-2011.ttf", import.meta.url));
  const mm3 = parseTtfCmap(bytes);
  const code = (ch) => mm3.get(ch.codePointAt(0));
  const mappings = new Map();
  for (let cp = 0x1000; cp < 0x1014; cp += 1) mappings.set(mm3.get(cp), " ");
  for (const id of [code("အ"), code("ပ"), 228, 239, 252, 222, mm3.get(0x20)]) mappings.set(id, " ");
  const box = (name, x, id) => `BT ${name} 15 Tf 1 0 0 1 ${x} 350 Tm <${id.toString(16).padStart(4, "0")}> Tj ET`;
  const pdf = await pdfWithObservedResource({ bytes, mappings, content: (name) => [
    box(name, 20, code("အ")), box(name, 40, code("ဂ")), box(name, 40, 252), box(name, 50, 222),
    box(name, 55, mm3.get(0x20)), box(name, 60, 228), box(name, 70, code("ပ")),
  ].join(" ") });
  const [, , pages] = streamPdfPages(pdf, () => {});
  try {
    const page = pages.next().value;
    assert.equal(page.text, "အင်္ဂါ ပေ");
    assert.ok(page.warnings.some((w) => w.code === "unicode-glyph-recovery-needs-review"));
  } finally { pages.return?.(); }
});

test("witnessed non-space glyphs can repair sparse space mappings without consuming real spaces", async () => {
  const bytes = fs.readFileSync(new URL("../../../Junk/fonts/Unicode/mm3_05-Jan-2011.ttf", import.meta.url));
  const mm3 = parseTtfCmap(bytes);
  const code = (ch) => mm3.get(ch.codePointAt(0));
  // Source evidence: merged part 2 page 252. Some drawn consonant/medial
  // glyphs map to space; the actual space glyph remains a space.
  const mappings = new Map([
    [code("က"), " "], [code("ခ"), "ြ"], [code("ဖ"), "ြ"], [code("ဒ"), "ေ"],
    [code("င"), "င"], [code("မ"), "မ"], [228, "ဒ"], [239, " "], [234, "ျေ"],
    [223, "ာ"], [224, "ိ"], [233, "်"], [232, "း"], [259, "ု"], [mm3.get(0x20), " "],
  ]);
  const own = directGlyphs(bytes);
  const decoder = new FontDecoder("fixture", { isCid: true, toUnicode: mappings,
    ownGids: own, doc: new DocumentDecoding("font") });
  enable(decoder, bytes);
  assert.equal(decoder._conflictingSpaceMap, false);
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(239)]), " ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, code("က"), 234, 223, 233)]), "ကျော်");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, 239, code("က"), 223, code("င"), 233, 232)]), "ကြောင်း");
  const boundary = { startsAtBoundary: true };
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("ခ"), 234, code("က"), 233)], boundary), "ချက်");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("မ"), 234, 223, 232)], boundary), "များ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("မ"), 234, 224, 259, 232)], boundary), "မျိုး");
  // Incomplete/unknown clusters retain the multi-output. A genuine space
  // must not be crossed to find a different prefix or completion.
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(234)]), "ျေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("က"), 234)]), "ကျေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("မ"), 234, 223)], boundary), "မျော");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, mm3.get(0x20), code("က"), 234)]), "ဒ ကျေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(mm3.get(0x20))]), " ");
  const alreadyCorrect = new Map(mappings);
  alreadyCorrect.set(234, "ျ");
  const unchanged = enable(new FontDecoder("fixture", { isCid: true, toUnicode: alreadyCorrect,
    ownGids: directGlyphs(bytes), doc: new DocumentDecoding("font") }), bytes);
  let unresolved = 0;
  assert.equal(decodeVisualUnicodeRun(unchanged, [raw(code("မ"), 234, 223, 232)],
    { startsAtBoundary: true, onUnresolved: () => { unresolved += 1; } }), "များ");
  assert.equal(unresolved, 0);

  const box = (name, x, id) => `BT ${name} 15 Tf 1 0 0 1 ${x} 350 Tm <${id.toString(16).padStart(4, "0")}> Tj ET`;
  const ids = [228, code("က"), 234, 223, 233, mm3.get(0x20), 228, 239, code("က"), 223, code("င"), 233, 232];
  const pdf = await pdfWithObservedResource({ bytes, mappings,
    content: (name) => ids.map((id, i) => box(name, 15 + i * 8, id)).join(" ") });
  const [, , pages] = streamPdfPages(pdf, () => {});
  try {
    const page = pages.next().value;
    assert.equal(page.text, "ကျော် ကြောင်း");
    assert.ok(page.warnings.some((w) => w.code === "unicode-glyph-recovery-needs-review"));
  } finally { pages.return?.(); }

  const unresolvedPdf = await pdfWithObservedResource({ bytes, mappings,
    content: (name) => box(name, 20, 234) });
  const [, , unresolvedPages] = streamPdfPages(unresolvedPdf, () => {}, { sourceEncoding: "unicode" });
  try {
    const page = unresolvedPages.next().value;
    assert.equal(page.text, "ျေ");
    assert.ok(page.warnings.some((w) => w.code === "unicode-glyph-mapping-needs-review"));
    assert.ok(!page.warnings.some((w) => w.code === "unicode-glyph-recovery-needs-review"));
  } finally { unresolvedPages.return?.(); }
});

test("a witnessed ra-wa glyph and a conflicting multi-output map retain the rendered cluster", () => {
  const bytes = fs.readFileSync(new URL("../../../Junk/fonts/Unicode/mm3_05-Jan-2011.ttf", import.meta.url));
  const mm3 = parseTtfCmap(bytes);
  const code = (ch) => mm3.get(ch.codePointAt(0));
  // Merged part 2 page 1315 draws e + ra-wa + ka while its ToUnicode
  // substitutes ka, a space and ra-wa-e respectively.
  const mappings = new Map([
    [228, "က"], [247, " "], [code("က"), "ြွေ"], [code("ခ"), "ြ"],
    [code("ဖ"), "ြ"], [code("ထ"), "ေ"], [code("ရ"), "ရ"], [code("စ"), "စ"],
    [code("အ"), "အ"], [code("ပ"), "ပ"], [223, "ာ"], [224, "ိ"], [225, "ီ"],
    [226, "ု"], [229, "ဲ"], [231, "့"], [232, "း"], [233, "်"], [234, "ျေ"],
    [235, "ွ"], [241, "က"], [252, "့"], [259, "ု"], [mm3.get(0x20), " "],
  ]);
  const decoder = enable(new FontDecoder("fixture", { isCid: true, toUnicode: mappings,
    ownGids: directGlyphs(bytes), doc: new DocumentDecoding("font") }), bytes);
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, 247, code("က"), 232)]), "ကြွေး");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("ရ"), code("က"), 233)]), "ရက်");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("က"), 224, 226)], { startsAtBoundary: true }), "ကို");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("စ"), code("က"), 223, 232)]), "စကား");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("အ"), code("ဖ"), 235, 229, 231, code("က"), 224, 226)]), "အဖွဲ့ကို");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("ခ"), 234, code("က"), 233)], { startsAtBoundary: true }), "ချက်");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("ခ"), 234, 259, code("ပ"), 233)],
    { startsAtBoundary: true }), "ချုပ်");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, code("က"), 234, 223, 233)]), "ကျော်");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(241, code("က"), 225, 232)]), "ကြီး");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, code("က"), 223, 233)]), "ကော်");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, code("က"), 223, code("က"), 233)]), "ကောက်");
  // The original multi-output survives an isolated or incomplete base,
  // either missing visual prefix, and a real intervening space.
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("က"))]), "ြွေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("က"), 233)]), "ြွေ်");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("က"), 233)], { startsAtBoundary: true }), "က်");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("က"), 224)], { startsAtBoundary: true }), "ြွေိ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, code("က"))]), "ကြွေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, code("က"), 233)]), "ကြွေ်");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(247, code("က"))]), " ြွေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, 247, mm3.get(0x20), code("က"))]), "က  ြွေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, 247, code("က"), 234)]), "က ြွေျေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("က"), 252)]), "ြွေ့");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(247)]), " ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(mm3.get(0x20))]), " ");
  mappings.set(code("က"), "က္");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(code("က"))]), "က္");
});

test("the 2009 Myanmar3 ya conflict retains its multi-output without a separate e", () => {
  // The GIDs and mappings are observed in the 2009 source resource; this
  // decoder supplies those roles directly to exercise incomplete clusters.
  const ownGids = new Map();
  ownGids.direct = new Map([[126, "ပ".codePointAt(0)], [130, "မ".codePointAt(0)]]);
  ownGids.ambiguous = new Set();
  const decoder = new FontDecoder("fixture", { isCid: true,
    toUnicode: new Map([[126, "ေ"], [130, "မ"], [223, "ာ"], [228, "ပ"],
      [232, "း"], [234, "ျေ"], [235, " "]]),
    ownGids, doc: new DocumentDecoding("font") });
  decoder.visualUnicodeGlyphs = new Map([
    [223, { suffix: "ာ" }], [228, { role: "e" }], [232, { suffix: "း" }],
    [234, { role: "ya", yaPlusEConflict: true }],
  ]);
  let unresolved = 0;
  const options = { onUnresolved: () => { unresolved += 1; } };
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, 126, 234)], options), "ပျေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(130, 234, 223, 232)],
    { ...options, startsAtBoundary: true }), "များ");
  assert.equal(unresolved, 0);
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(126, 234)], options), "ပျေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(234)], options), "ျေ");
  assert.equal(decodeVisualUnicodeRun(decoder, [raw(228, 235, 126, 234)], options), "ပ ပျေ");
  assert.equal(unresolved, 3);
});
