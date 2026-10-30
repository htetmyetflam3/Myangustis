import { parseTtfCmap } from "../main/parser/core/ttf-cmap.js";
import { renderPdfPagePng } from "../main/parser/read/pdf-render.js";
import { note } from "../main/parser/core/provenance.js";
import fs from "node:fs";
import path from "node:path";

import { ZawgyiDetector, containsMyanmar, hasOnlyZawgyiFonts, hasOnlyUnicodeFonts } from "../main/parser/text/detector.js";
import { preserveRegionalRuns } from "../main/parser/text/unicode-evidence.js";
import { decryptPdf, isEncryptedPdf, hasObjectStreams, expandObjectStreams } from "../main/parser/read/decrypt.js";
import { Rabbit } from "../main/parser/text/rabbit.js";
import { createHash } from "node:crypto";
import { countZawCodeEvidence, reorderZawCodeText } from "../main/parser/text/legacy-order.js";
import zawCodeDraft from "../main/parser/jason-map/zawcode-draft-glyphs.json" with { type: "json" };
import { cleanupText, orderText } from "../main/parser/text/normalize.js";
import { extractDocxParagraphs, extractDocxImages, validateDocxArchive } from "../main/parser/read/docx-extract.js";
import { extractDocxParagraphsExternal } from "../main/parser/read/docx-external.js";
import { scoreText } from "../main/parser/text/mm-score.js";
import { MAX_PAGES, MAX_TEXT_CHARS } from "../main/parser/core/limits.js";
import {
  parsePdfObjects, findFontStreams, findToUnicodeMaps, ARLARWADE_AYAR_MAP,
  loadSidecarMap, pickEmbeddedFont, getStream, findRootPages, collectPages,
  extractPageLines, pageHasImages, parseToUnicodeStream, extractMetadata,
} from "../main/parser/read/pdf-extract.js";
import {
  CmapIdentityMap, LegacyAyarMap, DocumentDecoding, detectLegacyLayoutFonts,
  legacyFontFaces,
} from "../main/parser/read/pdf-fonts.js";
import { LEGACY_CODE_PAGES, UNICODE_PATH, ZawCODE_PATH } from "../main/parser/codepage/registry.js";
import { confirmedPdfProfile } from "../main/parser/codepage/confirmed-pdf-runs.js";
import { normaliseFontName } from "../main/parser/codepage/names.js";
import { zawCodeGuard } from "../main/parser/text/repair.js";
import { loadScanDictionary, dictionaryWords } from "../main/parser/text/scan.js";
import { chooseCodePage, prepareVectorLayout, LEGACY_QUALITY_FLOOR } from "../main/parser/codepage/resolve.js";
import { buildVectorRepair } from "../main/parser/codepage/vector-repair.js";

export { LEGACY_QUALITY_FLOOR };
import { pyTruthy, pyRound, RuntimeError, baseName } from "../main/parser/core/pylib.js";



export const DETECT_PROBE_PAGES = 20;


const VECTOR_REPAIR_PROBE_PAGES = 12;








function vectorRepairEnabled(decoding) {
  if (!decoding) return false;
  if (process.env.PRASER_VECTOR_REPAIR === "0") return false;
  return decoding.kind === "cmap";
}


export function normCategory(category) {
  const cat = String(category).toUpperCase();
  return cat === "OTHER" ? "UNKNOWN" : cat;
}


export function safeProb(prob) {
  return Number.isFinite(prob) ? prob : 0.0;
}






export function loadDetector() {
  return new ZawgyiDetector();
}


export function streamPdfPages(source, detector = null, log = () => {}, { vectorLayout = null, provenance = null, textLayout = null } = {}) {
  const setting = String(process.env.PRASER_ZAWCODE_DRAFT ?? "");
  const layout = textLayout ?? (/^(1|true|yes|on)$/iu.test(setting) ? "zawcode"
    : /^(0|false|no|off)$/iu.test(setting) ? "off" : "auto");
  if (!["auto", "off", "zawcode"].includes(layout)) throw new Error(`Unsupported text layout: ${layout}`);
  const input = Buffer.isBuffer(source) || source instanceof Uint8Array
    ? (Buffer.isBuffer(source) ? source : Buffer.from(source))
    : fs.readFileSync(source);
  log(`[+] PDF size: ${input.length.toLocaleString("en-US")} bytes`);
  if (isEncryptedPdf(input)) {
    throw new RuntimeError(
      "This PDF is password-protected; decrypt it before extraction "
        + "(processBytesForMethod does this automatically).",
    );
  }
  if (hasObjectStreams(input)) {
    throw new RuntimeError(
      "This PDF stores objects in object streams (/ObjStm); expand them before extraction "
        + "(processBytesForMethod does this automatically).",
    );
  }
  const raw = input;
  const confirmedProfile = confirmedPdfProfile(createHash("sha256").update(raw).digest("hex"));

  const objects = parsePdfObjects(raw);
  log(`[+] Objects found: ${objects.size}`);




  const metadata = extractMetadata(objects, raw);
  note(provenance, { metadata });

  const pagesObj = findRootPages(objects);
  if (pagesObj === null || pagesObj === undefined) {
    throw new RuntimeError("No page tree found in the PDF.");
  }
  const allPages = collectPages(objects, pagesObj);
  const npages = allPages.length;
  note(provenance, { pages: npages });
  if (npages > MAX_PAGES) {
    throw new RuntimeError(`PDF exceeds the ${MAX_PAGES} page cap`);
  }
  log(`[+] Total pages: ${npages}`);

  const page = (idx, codeToUni, textPath = null) => {
    const [pnum, pgen] = allPages[idx];








    const hasImg = pageHasImages(objects, pnum, pgen);
    // Enable confirmed runs for the final legacy decoding, including a
    // vector-derived map. Scoring probes do not see them; the decoder still
    // requires the exact PDF hash, selected WinInnwa face, and font hash.
    if (confirmedProfile && codeToUni?.kind === "legacy") {
      codeToUni.confirmedPdfProfile = confirmedProfile;
    }
    const before = codeToUni?.zawcodeStats?.glyphs ?? 0;
    const fontNames = new Set();
    const [lines, w, h] = extractPageLines(objects, pnum, pgen, codeToUni,
      { usedMyanmarFonts: fontNames });
    const usedDraftFont = (codeToUni?.zawcodeStats?.glyphs ?? 0) > before;
    const selectedLegacy = codeToUni?.legacyFontNames;
    const selectedNames = selectedLegacy ? new Set([...selectedLegacy].map(normaliseFontName)) : null;
    const legacyDecoded = codeToUni?.kind === "legacy" && codeToUni.legacyCodePage?.size > 0
      && fontNames.size > 0 && selectedNames?.size > 0
      && [...fontNames].every((name) => name && selectedNames.has(normaliseFontName(name)));
    return {
      idx,
      lines,
      wh: [w, h],
      text: lines.map((l) => l[3]).join("\n"),
      hasImg,



      decodeKind: codeToUni && typeof codeToUni === "object" ? codeToUni.kind : null,
      fontNames,
      legacyDecoded,
      textPath: textPath === ZawCODE_PATH && !usedDraftFont ? null : textPath,
    };
  };

  function* generate() {
    if (layout !== "off") {
      const profilePresent = findFontStreams(objects).some(([num, gen]) => {
        try {
          const bytes = getStream(objects, num, gen);
          return bytes && Object.hasOwn(zawCodeDraft.profiles, createHash("sha256").update(bytes).digest("hex"));
        } catch { return false; }
      });
      if (!profilePresent && layout === "zawcode") {
        throw new RuntimeError("ZawCode draft has no matching embedded-font profile for this PDF");
      }
      if (profilePresent) {
        const stats = { glyphs: 0, strong: 0, page: 0, pages: new Set(), collecting: true };
        const decoding = new DocumentDecoding("cmap", new Map());
        decoding.trustFontToUnicode = true; // only the fingerprinted resource bypasses its ToUnicode
        decoding.zawcodeProfiles = zawCodeDraft.profiles;
        decoding.zawcodeTemplates = zawCodeDraft.templates;
        decoding.zawcodeStats = stats;
        decoding.zawcodeOrder = (text) => {
          if (stats.collecting) {
            const count = countZawCodeEvidence(text);
            stats.strong += count;
            if (count) stats.pages.add(stats.page);
          }
          return reorderZawCodeText(text);
        };
        const probeN = Math.min(DETECT_PROBE_PAGES, npages);
        const probe = [];
        for (let idx = 0; idx < probeN; idx += 1) {
          stats.page = idx;
          probe.push(page(idx, decoding, ZawCODE_PATH));
        }
        if (layout === "zawcode" && !stats.glyphs) {
          throw new RuntimeError("ZawCode draft profile is not used in the first probe pages");
        }
        if (stats.glyphs && (layout === "zawcode" || (stats.strong >= 2 && stats.pages.size >= 2))) {
          stats.collecting = false;
          note(provenance, { codepage: { chosen: ZawCODE_PATH, draft: true, source: "font-scoped raw glyph profile" } });
          log("[+] ZawCode draft: font-scoped glyphs; unknown codes remain visible");
          let fallback = null;
          let fallbackIndex = 0;
          const fallbackPage = (idx) => {
            if (!fallback) {
              [, , fallback] = streamPdfPages(input, detector, () => {},
                { vectorLayout, textLayout: "off" });
            }
            let current;
            while (fallbackIndex <= idx) {
              const next = fallback.next();
              if (next.done) throw new RuntimeError("Fallback page stream ended early");
              current = next.value;
              fallbackIndex += 1;
            }
            return current;
          };
          for (const item of probe) yield item.textPath ? item : fallbackPage(item.idx);
          for (let idx = probeN; idx < npages; idx += 1) {
            const item = page(idx, decoding, ZawCODE_PATH);
            yield item.textPath ? item : fallbackPage(idx);
          }
          return;
        }
      }
    }

    const direct = new DocumentDecoding("identity");
    if (detector !== null) {
      const probeN = Math.min(DETECT_PROBE_PAGES, npages);
      const probe = [];
      for (let idx = 0; idx < probeN; idx += 1) probe.push(page(idx, direct));
      let hasMyanmar = false;
      for (const p of probe) {
        if (containsMyanmar(p.text)) { hasMyanmar = true; break; }
      }
      if (hasMyanmar) {
        log("[+] Identity-H direct decode — no font/CMap lookup needed");
        for (const p of probe) yield p;
        for (let idx = probeN; idx < npages; idx += 1) {
          yield page(idx, direct);
          if ((idx + 1) % 500 === 0) log(`    ... extracted ${idx + 1}/${npages} pages`);
        }
        return;
      }
      log("[i] No Myanmar found via direct decode; trying ToUnicode/font cmap");
    }










    const probeN2 = Math.min(DETECT_PROBE_PAGES, npages);
    const decodesMyanmar = (strategy) => {
      for (let i = 0; i < probeN2; i += 1) {
        const [pnum, pgen] = allPages[i];
        const [plines] = extractPageLines(objects, pnum, pgen, strategy);
        const t = plines.map((x) => x[3]).join("\n");
        if (containsMyanmar(t)) return true;
      }
      return false;
    };

    const cmapMap = new Map();
    let conflicts = 0;
    const fontRefs = findFontStreams(objects);
    if (pyTruthy(fontRefs)) {
      log(`[+] Embedded font-stream candidates: ${fontRefs.length}`);








      const [ffRef, ttf0, cmap0] = pickEmbeddedFont(objects, fontRefs);
      const ordered = [];
      if (ffRef) ordered.push(ffRef);
      for (const r of fontRefs) if (!(ffRef && r[0] === ffRef[0] && r[1] === ffRef[1])) ordered.push(r);
      let used = 0;
      for (const ref of ordered) {
        let ttf;
        let cmap;
        if (ffRef && ref[0] === ffRef[0] && ref[1] === ffRef[1]) {
          ttf = ttf0;
          cmap = cmap0;
        } else {
          ttf = getStream(objects, ref[0], ref[1]);
          cmap = pyTruthy(ttf) ? parseTtfCmap(ttf) : new Map();
        }
        if (!pyTruthy(cmap)) continue;
        used += 1;
        for (const [uni, gid] of cmap) {
          if (!gid) continue;
          if (cmapMap.has(gid)) {
            if (cmapMap.get(gid) !== uni) conflicts += 1;
            continue;
          }
          cmapMap.set(gid, uni);
        }
      }
      log(`[+] Merged font cmap entries: ${cmapMap.size} from ${used} font stream(s)`
        + (conflicts ? `; ${conflicts} gid conflict(s) (first font wins)` : ""));
    }





    const legacyFonts = detectLegacyLayoutFonts(objects, getStream, parseToUnicodeStream);
    if (legacyFonts.length) {
      note(provenance, { fonts: legacyFontFaces(objects, getStream, parseToUnicodeStream) });
    }
    const tuMap = findToUnicodeMaps(objects);
    const ownTu = tuMap.size;
    const sidecar = loadSidecarMap();
    for (const [code, uni] of sidecar) if (!tuMap.has(code)) tuMap.set(code, uni);
    if (tuMap.size) {
      log("[+] ToUnicode mappings: " + ownTu
        + (sidecar.size ? ` (+${tuMap.size - ownTu} from sidecar cipher map)` : ""));
    }






    const unicodeStrategy = pyTruthy(cmapMap)
      ? new DocumentDecoding("cmap", new CmapIdentityMap(cmapMap))
      : (pyTruthy(tuMap) ? new DocumentDecoding("tounicode", tuMap) : null);
    if (unicodeStrategy) {
      log(`[+] Unicode path staged: ${unicodeStrategy.kind} (competing in the code page score)`);
    }
    let legacyMap = legacyFonts.length ? new LegacyAyarMap(ARLARWADE_AYAR_MAP) : new Map();
    let legacyPage = null;
    let legacyPageName = null;
    let legacyFontNames = null;


















    if (legacyMap.size) log(`[+] Legacy-layout fonts: ${legacyFonts.length}`);
    {




      const codePages = legacyMap.size
        ? (vectorLayout
            ? new Map([[vectorLayout.name, vectorLayout.table], ...LEGACY_CODE_PAGES])
            : new Map(LEGACY_CODE_PAGES))
        : new Map();
      let [table, name, quality, ranking, candidateSamples] = chooseCodePage(objects, allPages, legacyMap, codePages, vectorLayout, unicodeStrategy);











      let zawGuard = null;
      if (name === UNICODE_PATH && unicodeStrategy) {
        const chunks = [];
        const fontNames = new Set();
        for (const [pnum, pgen] of allPages.slice(0, DETECT_PROBE_PAGES)) {
          try {
            const [plines] = extractPageLines(objects, pnum, pgen, unicodeStrategy,
              { usedMyanmarFonts: fontNames });
            chunks.push(plines.map((x) => x[3]).join("\n"));
          } catch { /* a page that will not parse tells the guard nothing */ }
        }
        const guardSample = chunks.join("\n") || candidateSamples?.get(UNICODE_PATH) || "";
        if (guardSample) {
          try {
            const dictData = loadScanDictionary();
            zawGuard = zawCodeGuard(
              guardSample,
              dictionaryWords(dictData),
              dictData?.mapData?.newClause?.standalone || [],
            );
          } catch { zawGuard = null; }
          if (zawGuard?.zawcode && hasOnlyZawgyiFonts(fontNames)) {
            zawGuard = { ...zawGuard, zawcode: false, veto: "zawgyi-one-font" };
          }
          if (zawGuard?.zawcode) {
            name = ZawCODE_PATH;
            log(`[+] ZawCode guard: stored-order reading scans cleaner `
              + `(gate ${zawGuard.pureGate} -> ${zawGuard.crossedGate} at score ${quality.toFixed(3)}) `
              + `-- splitting the unicode win to "zawcode"`);
          }
        }
      }
      for (const [nm, sc] of ranking) {
        const chosenMark = nm === name || (name === ZawCODE_PATH && nm === UNICODE_PATH);
        log(`    text path ${JSON.stringify(nm)}: ${sc.toFixed(3)}${chosenMark ? "  <- chosen" : ""}`);
      }
      note(provenance, {
        codepage: {
          chosen: name,
          score: quality,
          floor: LEGACY_QUALITY_FLOOR,
          accepted: quality >= LEGACY_QUALITY_FLOOR,
          ranking: ranking.map(([nm, sc]) => [nm, sc]),
          ...(name === ZawCODE_PATH && zawGuard
            ? { splitFrom: UNICODE_PATH, zawCodeGuard: zawGuard }
            : {}),
        },
      });





      if (name === UNICODE_PATH || name === ZawCODE_PATH) {
        log(`[+] Unicode path won the code page score (${quality.toFixed(3)}) `
          + `-- using the font's own maps, no legacy table`);
      }
      legacyPage = table;
      legacyPageName = name;
      legacyFontNames = vectorLayout && name === vectorLayout.name
        ? [vectorLayout.fontName, ...(vectorLayout.sourceBaseFonts || [])]
        : null;
      if (name === UNICODE_PATH || name === ZawCODE_PATH) {





        log(`[+] Text path: ${name} -- the document read as itself, from the `
          + `font's own ${unicodeStrategy ? unicodeStrategy.kind : "unicode"} `
          + `table (score ${quality.toFixed(3)}). No legacy table applied.`
          + (quality < LEGACY_QUALITY_FLOOR
            ? ` Below the ${LEGACY_QUALITY_FLOOR.toFixed(2)} floor, so this `
              + `text may still be poor -- but nothing else scored higher.`
            : ``));
        legacyMap = new Map();
        legacyPage = null;
        legacyPageName = null;
        legacyFontNames = null;
      } else if (quality < LEGACY_QUALITY_FLOOR) {
        log(`[!] No registered legacy layout fits this document `
          + `(best ${JSON.stringify(name)} scores ${quality.toFixed(3)}, `
          + `expected >= ${LEGACY_QUALITY_FLOOR.toFixed(2)}). Falling back to `
          + `each font's own /ToUnicode. If the Myanmar text is wrong, `
          + `add this document's code page to LEGACY_CODE_PAGES in `
          + `codepage/registry.mjs.`);
        legacyMap = new Map();
        legacyPage = null;
        legacyPageName = null;
        legacyFontNames = null;
      }
    }




    let decoding = null;
    if (detector !== null) {
      const legacyOptions = { legacyFontNames };
      if (legacyMap.size && decodesMyanmar(new DocumentDecoding("legacy", legacyMap, legacyPage, legacyOptions))) {
        decoding = new DocumentDecoding("legacy", legacyMap, legacyPage, legacyOptions);
        log(`[+] Decoding via ${legacyPageName ? JSON.stringify(legacyPageName) : "legacy"} character map`);
      } else if (pyTruthy(cmapMap) && decodesMyanmar(new DocumentDecoding("cmap", new CmapIdentityMap(cmapMap)))) {



        decoding = new DocumentDecoding("cmap", new CmapIdentityMap(cmapMap));
        log("[+] Decoding via embedded font cmap (glyph truth) "
          + "+ identity fallback for exact-Unicode fonts");
      } else if (pyTruthy(tuMap) && decodesMyanmar(new DocumentDecoding("tounicode", tuMap))) {
        decoding = new DocumentDecoding("tounicode", tuMap);
        log("[+] Decoding via ToUnicode/sidecar map");
      }
    }
    if (decoding === null) {
      if (legacyMap.size) decoding = new DocumentDecoding("legacy", legacyMap, legacyPage, { legacyFontNames });
      else if (pyTruthy(cmapMap)) decoding = new DocumentDecoding("cmap", cmapMap);
      else if (pyTruthy(tuMap)) decoding = new DocumentDecoding("tounicode", tuMap);
      else decoding = new DocumentDecoding("none");
    }

    if (decoding.kind === "none") {
      log("[!] No font cmap and no ToUnicode map; "
        + "unmapped codes will appear as [XXXX] placeholders");
    }











    if (vectorRepairEnabled(decoding)) {
      const blind = new Set();
      decoding.recordBlind = blind;
      const probeN = Math.min(VECTOR_REPAIR_PROBE_PAGES, npages);
      for (let i = 0; i < probeN; i += 1) {
        try {
          extractPageLines(objects, allPages[i][0], allPages[i][1], decoding);
        } catch { /* a page that will not parse tells us nothing more */ }
      }
      decoding.recordBlind = null;
      if (blind.size) {
        log(`[+] Vector repair: ${blind.size} unnameable glyph id(s)`
          + ` over ${probeN} probe page(s) -- matching by outline`);
        try {
          const repair = buildVectorRepair({ objects, getStream, fontRefs }, blind, { log });
          if (repair) {
            decoding.vectorRepair = repair;
            log(`[+] Vector repair: recovered ${repair.stats.recovered}`
              + `/${repair.stats.asked} glyph id(s) from ${repair.stats.fonts} subset(s)`);
          }
        } catch (err) {
          log(`[!] Vector repair unavailable: ${err && err.message ? err.message : err}`);
        }
      }
    }

    for (let idx = 0; idx < npages; idx += 1) {
      yield page(idx, decoding);
      if ((idx + 1) % 500 === 0) log(`    ... extracted ${idx + 1}/${npages} pages`);
    }
  }

  return [metadata, npages, generate()];
}


const orderUnicode = (text) => preserveRegionalRuns(text, orderText);
const cleanupUnicode = (text) => preserveRegionalRuns(text, cleanupText);

export function cleanupFor(cat, text) {
  return cat === "UNICODE" ? cleanupUnicode(text) : null;
}


function convertLine(t, cat, applyCleanup) {
  if (cat === "ZAWGYI") return orderText(Rabbit.zg2uni(t));
  if (cat === "UNICODE") return applyCleanup ? cleanupUnicode(t) : orderUnicode(t);
  return orderText(t);
}
function convLines(lines, cat, applyCleanup) {
  return lines.map(([x, y, size, t]) => [x, y, size, convertLine(t, cat, applyCleanup)]);
}


export function countDiffLines(base, clean) {
  const bl = base.split("\n");
  const cl = clean.split("\n");
  const n = Math.max(bl.length, cl.length);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if ((i < bl.length ? bl[i] : "") !== (i < cl.length ? cl[i] : "")) count += 1;
  }
  return count;
}


export function processPageRecord(pg, detector, applyCleanup, log = () => {}, wantLayout = false, sourceEncoding = "auto") {
  const idx = pg.idx;
  const raw = pg.text;
  if (pg.textPath === ZawCODE_PATH) {
    // Profiled runs were already ordered once, while assembling each line.
    const rep = { page: idx + 1, category: "UNICODE", prob: 0,
      text: raw, nChanges: 0, textPath: ZawCODE_PATH };
    if (wantLayout) {
      rep.lines = pg.lines;
      rep.wh = pg.wh;
      rep.hasImg = pg.hasImg;
    }
    return rep;
  }
  const [category, prob] = sourceEncoding === "auto" && pg.legacyDecoded
    ? ["UNICODE", 0]
    // A PDF font name does not establish what its character codes or
    // /ToUnicode entries mean. DOCX text has a different evidence boundary.
    : detector.detect(raw, { sourceEncoding, fontNames: pg.fontNames, unicodeFontEvidence: false });
  let cat = normCategory(category);
























  if (cat === "ZAWGYI" && sourceEncoding !== "zawgyi-one" && !hasOnlyZawgyiFonts(pg.fontNames)
    && (pg.decodeKind === "cmap" || pg.decodeKind === "tounicode")) {
    const asUnicode = scoreText(orderText(raw));
    const asZawgyi = scoreText(orderText(Rabbit.zg2uni(raw)));
    if (asUnicode.marks >= 50 && asZawgyi.score - asUnicode.score >= 0.03) {
      log(`    Page ${idx + 1}: zawgyi-cmap path -- decoded from the font's own `
        + `${pg.decodeKind} table but still Zawgyi: Rabbit reading scores `
        + `${asZawgyi.score.toFixed(3)} vs ${asUnicode.score.toFixed(3)} as Unicode`);
    } else {
      cat = "UNICODE";
      log(`    Page ${idx + 1}: unicode path -- ${category} verdict overridden; `
        + `decoded from the font's own ${pg.decodeKind} table and reads as itself `
        + `(${asUnicode.score.toFixed(3)} vs ${asZawgyi.score.toFixed(3)} converted), `
        + `so this is Unicode in drawing order, not Zawgyi`);
    }
  }

  if (cat === "UNKNOWN") {



    const rep = {
      page: idx + 1, category: cat, prob: safeProb(prob), text: raw, nChanges: 0,
    };
    if (wantLayout) {
      rep.lines = pg.lines;
      rep.wh = pg.wh;
      rep.hasImg = pg.hasImg;
    }
    log(`    Page ${idx + 1}: UNKNOWN -> passed through`);
    return rep;
  }

  let base;
  if (cat === "ZAWGYI") {
    base = orderText(Rabbit.zg2uni(raw));
    if (hasOnlyZawgyiFonts(pg.fontNames) && (pg.decodeKind === "cmap" || pg.decodeKind === "tounicode")) {
      log(`    Page ${idx + 1}: zawgyi-cmap path -- Zawgyi-One font evidence -> converted`);
    } else {
      log(`    Page ${idx + 1}: ZAWGYI (font/source evidence) -> converted`);
    }
  } else {
    base = orderUnicode(raw);
    log(`    Page ${idx + 1}: UNICODE (source evidence) -> kept`);
  }

  const clean = cleanupFor(cat, base);
  const nChanges = clean === null || clean === base ? 0 : countDiffLines(base, clean);
  const text = applyCleanup && clean !== null ? clean : base;
  const rep = {
    page: idx + 1, category: cat, prob: safeProb(prob), text, nChanges,
  };
  if (wantLayout) {
    rep.lines = convLines(pg.lines, cat, applyCleanup);
    rep.wh = pg.wh;
    rep.hasImg = pg.hasImg;
  }
  return rep;
}


export function processPdfStream(pdfSource, detector, applyCleanup, log = () => {}, wantLayout = false, options = {}) {
  const [metadata, npages, pages] = streamPdfPages(pdfSource, detector, log, options);

  function* reports() {
    for (const pg of pages) {
      yield processPageRecord(pg, detector, applyCleanup, log, wantLayout, options.sourceEncoding);
    }
  }

  return [metadata, npages, reports()];
}


export function collectStreamResults(pdfSource, detector, applyCleanup, log = () => {}, wantLayout = false, options = {}) {
  const [metadata, npages, reports] = processPdfStream(pdfSource, detector, applyCleanup, log, wantLayout, options);
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  const pages = [];
  let totalChanges = 0;
  for (const rep of reports) {
    counts[rep.category] = (counts[rep.category] ?? 0) + 1;
    const out = {};
    if ("text" in rep) out.text = rep.text;
    if ("lines" in rep) out.lines = rep.lines;
    if ("wh" in rep) out.wh = rep.wh;
    if ("hasImg" in rep) out.hasImg = rep.hasImg;
    pages.push(out);
    totalChanges += rep.nChanges;
  }
  return [pages, counts, totalChanges, metadata, npages];
}


export function collectChanges(reports) {
  const changes = [];
  for (const rep of reports) {
    if (rep.clean === null) continue;
    const baseLines = rep.base.split("\n");
    const cleanLines = rep.clean.split("\n");
    for (let li = 0; li < Math.max(baseLines.length, cleanLines.length); li += 1) {
      const bl = li < baseLines.length ? baseLines[li] : "";
      const cl = li < cleanLines.length ? cleanLines[li] : "";
      if (bl !== cl) {
        changes.push({
          id: `p${rep.page}-l${li + 1}`,
          page: rep.page,
          line: li + 1,
          category: rep.category,
          original: bl,
          suggested: cl,
        });
      }
    }
  }
  return changes;
}

export function buildContent(job, applyCleanup = false, kind = null) {
  const k = (kind || job.kind || "pdf").toLowerCase();
  const sep = k === "docx" ? "\n" : "\n\n";
  const parts = [];
  const len = Math.min(job.pages.length, job.reports.length);
  for (let i = 0; i < len; i += 1) {
    const pg = job.pages[i];
    const rep = job.reports[i];
    parts.push(applyCleanup && rep.clean !== null && rep.clean !== undefined ? rep.clean : pg.text);
  }
  return parts.join(sep);
}






export function processPdfBytes(data, detector, filename = "upload.pdf", log = () => {}, options = {}) {
  const source = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const [, npages, reportsIter] = processPdfStream(source, detector, false, log, true, options);
  const reports = [];
  const pages = [];
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  let textChars = 0;
  let encodingPath = null;
  for (const rep of reportsIter) {
    const cat = rep.category;
    const base = rep.text;
    textChars += base.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new RuntimeError(`Extracted text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
    const clean = rep.textPath === ZawCODE_PATH ? null : cleanupFor(cat, base);
    if (rep.textPath) encodingPath = rep.textPath;
    reports.push({ page: rep.page, category: cat, prob: rep.prob, base, clean,
      ...(rep.textPath ? { textPath: rep.textPath } : {}) });
    pages.push({ text: base, lines: rep.lines, wh: rep.wh, hasImg: rep.hasImg });
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  const changes = collectChanges(reports);
  return {
    filename, kind: "pdf", reports, counts, metadata: {}, changes, pages, npages,
    ...(encodingPath ? { encodingPath } : {}),
  };
}




export const DOCX_CHUNK_PARAGRAPHS = 80;

export function chunkParagraphs(paragraphs, perChunk = DOCX_CHUNK_PARAGRAPHS) {
  if (!paragraphs.length) return [""];
  const out = [];
  for (let i = 0; i < paragraphs.length; i += perChunk) {
    out.push(paragraphs.slice(i, i + perChunk).join("\n"));
  }
  return out;
}


function buildDocxJob(paragraphs, filename, detector, log, sourceEncoding = "auto", fontNamesByParagraph = null) {
  const reports = [];
  const pages = [];
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  let textChars = 0;
  for (const paragraph of paragraphs) {
    textChars += paragraph.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new RuntimeError(`Extracted text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
  }
  const chunks = chunkParagraphs(paragraphs);
  if (chunks.length > MAX_PAGES) {
    throw new RuntimeError(`DOCX exceeds the ${MAX_PAGES} chunk cap`);
  }
  chunks.forEach((chunk, idx) => {
    const fontNames = new Set();
    for (const names of fontNamesByParagraph?.slice(idx * DOCX_CHUNK_PARAGRAPHS, (idx + 1) * DOCX_CHUNK_PARAGRAPHS) ?? []) {
      for (const name of names) fontNames.add(name);
    }
    const [category, prob] = detector.detect(chunk, { sourceEncoding, fontNames });
    const cat = normCategory(category);
    // For actual DOCX text, a known Unicode face is enough to keep the stored
    // code points, but does not prove which keyboard produced them.
    const fontUnicode = sourceEncoding === "auto" && hasOnlyUnicodeFonts(fontNames);
    const base = cat === "ZAWGYI" ? orderText(Rabbit.zg2uni(chunk))
      : cat === "UNICODE" ? (fontUnicode ? chunk : orderUnicode(chunk)) : chunk;
    const clean = cleanupFor(cat, base);
    reports.push({ page: idx + 1, category: cat, prob: safeProb(prob), base, clean });
    pages.push({ text: base });
    counts[cat] = (counts[cat] ?? 0) + 1;
    log(`    Chunk ${idx + 1}: ${cat}`);
  });

  return {
    filename,
    kind: "docx",
    reports,
    counts,
    metadata: {},
    changes: collectChanges(reports),
    pages,
    paragraphs,
  };
}
export function processDocxBytes(data, detector, filename = "upload.docx", log = () => {}, { imageDir = null, sourceEncoding = "auto" } = {}) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const fontNamesByParagraph = [];
  const paragraphs = extractDocxParagraphs(bytes, { includeImageMarkers: Boolean(imageDir), fontNamesByParagraph });
  const job = buildDocxJob(paragraphs, filename, detector, log, sourceEncoding, fontNamesByParagraph);
  if (imageDir) job.imageFiles = extractDocxImages(bytes, imageDir);
  return job;
}


export async function processDocxBytesExternal(data, detector, filename = "upload.docx", log = () => {}) {
  validateDocxArchive(Buffer.isBuffer(data) ? data : Buffer.from(data));
  const paragraphs = await extractDocxParagraphsExternal(data);
  return buildDocxJob(paragraphs, filename, detector, log);
}

export const EXTERNAL_UNICODE_QUALITY_FLOOR = 0.5;
function externalQualityOk(counts) {
  const total = (counts.ZAWGYI ?? 0) + (counts.UNICODE ?? 0) + (counts.UNKNOWN ?? 0);
  if (total === 0) return false;
  return (counts.UNICODE ?? 0) / total >= EXTERNAL_UNICODE_QUALITY_FLOOR;
}


export async function processBytesDefault(data, kind, detector, filename = null, log = () => {}, options = {}) {
  const k = (kind || "").toLowerCase();
  if (k === "pdf") return processPdfBytes(data, detector, filename || "upload.pdf", log, options);
  if (k === "docx") {


    const probe = await processDocxBytesExternal(data, detector, filename || "upload.docx", log);
    if ((probe.counts.ZAWGYI ?? 0) + (probe.counts.UNICODE ?? 0) === 0) {
      log("    mammoth probe has no source-encoding evidence; handing the original DOCX to PRASER");
    } else {
      log(externalQualityOk(probe.counts)
        ? "    mammoth probe passed; handing the original DOCX to PRASER"
        : "    mammoth probe failed the Unicode-readability check; handing the original DOCX to PRASER");
    }
    return processDocxBytes(data, detector, filename || "upload.docx", log, options);
  }
  throw new Error(`Unsupported kind: ${JSON.stringify(kind)} (use 'pdf' or 'docx')`);
}


export function processBytes(data, kind, detector, filename = null, log = () => {}, options = {}) {
  const k = (kind || "").toLowerCase();
  if (k === "pdf") return processPdfBytes(data, detector, filename || "upload.pdf", log, options);
  if (k === "docx") return processDocxBytes(data, detector, filename || "upload.docx", log, options);
  throw new Error(`Unsupported kind: ${JSON.stringify(kind)} (use 'pdf' or 'docx')`);
}


export async function processBytesForMethod(data, kind, method, detector, filename = null, log = () => {}, options = {}) {
  const k = (kind || "").toLowerCase();
  if (k === "pdf" && isEncryptedPdf(data)) data = await decryptPdf(data, log);
  if (k === "pdf" && hasObjectStreams(data)) data = await expandObjectStreams(data, log);
  const runOptions = { ...options };
  const vectorEnabled = !/^(0|false|no|off)$/iu.test(String(process.env.PRASER_VECTOR_LAYOUT || "1"));
  if (k === "pdf" && vectorEnabled && !runOptions.vectorLayout) {
    runOptions.vectorLayout = await prepareVectorLayout(data, log);
  }
  const m = String(method || "default").toLowerCase();
  if (m === "manual") return processBytes(data, k, detector, filename, log, runOptions);
  if (m === "null") {
    if (k !== "docx") {
      throw new Error(`method:"null" is DOCX-only (no PDF path emits it); got kind=${JSON.stringify(kind)}`);
    }
    return processBytes(data, k, detector, filename, log, runOptions);
  }
  if (m === "default") return processBytesDefault(data, k, detector, filename, log, runOptions);
  throw new Error(`Unsupported method: ${JSON.stringify(method)} (use "default"/"manual"/"null")`);
}


export function buildFinalPages(job, applyCleanup) {
  const out = [];
  const len = Math.min(job.pages.length, job.reports.length);
  for (let i = 0; i < len; i += 1) {
    const pg = job.pages[i];
    const rep = job.reports[i];
    if (!("lines" in pg)) {
      out.push({
        text: applyCleanup && rep.clean !== null && rep.clean !== undefined ? rep.clean : pg.text,
      });
      continue;
    }
    if (applyCleanup && rep.clean !== null && rep.clean !== undefined) {
      out.push({
        text: rep.clean,
        lines: pg.lines.map(([x, y, s, t]) => [x, y, s, cleanupUnicode(t)]),
        wh: pg.wh,
        hasImg: pg.hasImg,
      });
    } else {
      out.push({ text: pg.text, lines: pg.lines, wh: pg.wh, hasImg: pg.hasImg });
    }
  }
  return out;
}

export { pyRound, baseName };














export async function markPdfImagePages(bytes, job, imageDir, log = () => {}) {
  const files = [];
  const reports = Array.isArray(job?.reports) ? job.reports : [];
  for (let i = 0; i < reports.length; i += 1) {
    if (!reports[i]?.hasImg) continue;
    const id = String(files.length + 1).padStart(4, "0");
    const target = path.join(imageDir, `${id}-page${i + 1}.png`);
    try {
      const { png } = await renderPdfPagePng(bytes, i + 1);
      fs.writeFileSync(target, png, { mode: 0o600 });
    } catch (error) {
      log(`    Page ${i + 1}: render for OCR skipped (${error.message})`);
      continue;
    }
    const marker = `\n[[IMAGE_${id}]]`;
    if (job.pages?.[i]) job.pages[i].text = `${job.pages[i].text ?? ""}${marker}`;
    if (reports[i].clean != null) reports[i].clean = `${reports[i].clean}${marker}`;
    reports[i].text = `${reports[i].text ?? ""}${marker}`;
    files.push({ id, path: target });
  }
  return files;
}
