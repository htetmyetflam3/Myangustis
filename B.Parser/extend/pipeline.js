import { renderPdfPagePng } from "../main/parser/read/pdf-render.js";
import { note } from "../main/parser/core/provenance.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ZawgyiDetector, containsMyanmar, hasOnlyZawgyiFonts, hasOnlyUnicodeFonts, isZawgyiOneFont, isUnicodeFont } from "../main/parser/text/detector.js";
import { isEncryptedPdf, hasObjectStreams, scanPdfFileMarkers } from "../main/parser/read/decrypt.js";
import { Rabbit } from "../main/parser/text/rabbit.js";
import { orderText } from "../main/parser/text/cleanup.js";
import { preserveCharacters } from "../main/parser/text/preserved-transform.js";
import { extractDocxParagraphs, validateDocxArchive } from "../main/parser/read/docx-extract.js";
import { extractDocxParagraphsExternal } from "../main/parser/read/docx-external.js";
import { scoreText, englishLikeness } from "../main/parser/text/myanmar-score.js";
import { choosePageParser } from "../main/parser/text/page-decision.js";
import { withoutZeroWidthSpace } from "../main/parser/text/zero-width.js";
import { countImpossiblePairs } from "../main/parser/text/scan.js";
import { WININNWA_LEGACY_CODE_PAGE } from "../main/parser/codepage/registry.js";
import { isLegacyFontName } from "../main/parser/codepage/names.js";
import { MAX_PAGES, MAX_TEXT_CHARS } from "../main/parser/core/limits.js";
import {
  MAX_PDF_OBJECTS, findRootPages, collectPages, extractPageLines, probePagePrefix, pageHasImages, extractMetadata,
  legacyAyarToUnicode,
} from "../main/parser/read/pdf-extract.js";
import { PdfFileObjects, openPdfScannedObjects } from "../main/parser/read/pdf-object-file.js";
import { PdfPagePieces } from "../main/parser/read/pdf-page-pieces.js";
import {
  cleanupUnicodeText as cleanupUnicode, convertFinalizedPageText,
  finishPageToFile, orderUnicodeText as orderUnicode, pageLayoutLines,
} from "../main/parser/text/page-file-decision.js";
import { DocumentDecoding, PDF_PARSING_PATHS, pageFontDecoders } from "../main/parser/read/pdf-fonts.js";
import { PAGE_CONTENT_PREFIX_BYTES } from "../main/parser/read/pdf-content-file.js";
import { pyRound, RuntimeError, baseName } from "../main/parser/core/pylib.js";
import { agentAdvisory } from "../../Architecture/host/advisory.js";

const PARSER_CHAIN_DOOR = "ParserManager";

function adviseParserMiddleChain(api) {
  if (process.env.MYANGUSTIS_CHAIN_DOOR === PARSER_CHAIN_DOOR) return;
  agentAdvisory(
    "parser-middle-chain",
    `[Parser agent advisor] STOP: B.Parser/extend/pipeline.js:${api}() is a middle-chain API, not the Parser chain door. `
      + "Start from B.Parser/main/parser/index.js (Manager.dispatchStream/Manager.dispatch) or "
      + "tools-box/js/pipeline-cli.js parser local, and report only that front-door behavior. "
      + "Calling pipeline/text/read helpers directly skips Manager spooling, worker preparation, output/POS sidecars and cleanup options.",
  );
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

// Evidence for applying the existing WinInnwa keyboard layout to a selected
// simple resource, irrespective of its display font. Do not promote a URL,
// short label, ordinary English, or an isolated long word into the layout.
function hasWinLayoutEvidence(text) {
  const sample = withoutZeroWidthSpace(text);
  if (containsMyanmar(sample)) return false;
  const english = englishLikeness(sample);
  if (english.verdict !== "not-english" || !english.hasSpaces
      || english.letters < 24 || english.runs < 4) return false;
  const mixedCaseWords = (sample.match(/[A-Za-z]{3,}/gu) || [])
    .filter((word) => /[a-z][A-Z][a-z]/u.test(word)).length;
  if (english.violationRate <= 0.02 && mixedCaseWords < 2) return false;
  let mapped = 0;
  let visible = 0;
  let slots = "";
  for (const ch of sample) {
    if (!/\s/u.test(ch)) visible += 1;
    const value = WININNWA_LEGACY_CODE_PAGE.get(ch.codePointAt(0));
    if (value !== undefined) {
      if (!/\s/u.test(ch)) mapped += 1;
      slots += value;
    } else slots += ch;
  }
  const reading = scoreText(legacyAyarToUnicode(slots));
  return visible > 0 && mapped / visible >= 0.9 && reading.marks >= 12
    && reading.score >= 0.85 && reading.duplicate <= 0.05;
}

// A previously supported legacy face may begin with a short or deliberately
// overprinted title, before the body provides enough text for the full score.
// Its name is only supporting evidence on an already selected legacy page:
// require non-English byte patterns as well, and leave addresses untouched.
function hasNamedWinLayoutEvidence(text) {
  const sample = withoutZeroWidthSpace(text);
  if (containsMyanmar(sample) || /(?:https?:\/\/|www\.|\b[a-z0-9.-]+\.[a-z]{2,}\b)/iu.test(sample)) return false;
  const english = englishLikeness(sample);
  if (english.verdict === "english" || english.letters < 8) return false;
  const repeated = (sample.match(/([a-z])\1+/giu) || []).reduce((sum, run) => sum + run.length, 0);
  const mixed = (sample.match(/[A-Za-z]{3,}/gu) || [])
    .filter((word) => /[a-z][A-Z][a-z]/u.test(word)).length;
  const unusual = (sample.match(/[&@;'*]/gu) || []).length;
  const overprint = repeated >= 8 && repeated / english.letters >= 0.75;
  return overprint || (english.letters >= 16
    && (english.violationRate > 0.02 || mixed >= 2 || unusual >= 4));
}

export function streamPdfPages(source, detector = null, log = () => {}, {
  provenance = null, sourceEncoding = "auto", onPageContent = null, onPagePrefix = null, scratchDir = null,
  diskPages = false, layoutPages = false,
} = {}) {
  adviseParserMiddleChain("streamPdfPages");
  const fileBacked = typeof source === "string";
  if (diskPages && !fileBacked) throw new TypeError("Disk-backed PDF pages require a prepared PDF file path");
  const input = fileBacked ? null : (Buffer.isBuffer(source) ? source : Buffer.from(source));
  const size = fileBacked ? fs.statSync(source).size : input.length;
  log(`[+] PDF size: ${size.toLocaleString("en-US")} bytes`);
  const markers = fileBacked ? scanPdfFileMarkers(source)
    : { encrypted: isEncryptedPdf(input), objectStreams: hasObjectStreams(input) };
  if (markers.encrypted) {
    throw new RuntimeError("This PDF is password-protected; decrypt it before extraction.");
  }
  if (markers.objectStreams) {
    throw new RuntimeError(
      "This PDF stores objects in object streams (/ObjStm); expand them before extraction "
        + "(the PDF worker prepares the file automatically).",
    );
  }
  const scanned = fileBacked ? null : openPdfScannedObjects(input, { maxObjects: MAX_PDF_OBJECTS });
  const objects = fileBacked ? new PdfFileObjects(source, { maxObjects: MAX_PDF_OBJECTS }) : scanned.objects;
  const closeObjects = () => { if (scanned) scanned.close(); else objects.close(); };
  let metadata;
  let allPages;
  try {
    metadata = extractMetadata(objects, fileBacked ? objects.trailer : input);
    const root = findRootPages(objects);
    if (root === null || root === undefined) throw new RuntimeError("No page tree found in the PDF.");
    allPages = collectPages(objects, root);
    if (allPages.length > MAX_PAGES) throw new RuntimeError(`PDF exceeds the ${MAX_PAGES} page cap`);
  } catch (error) {
    closeObjects();
    throw error;
  }
  const npages = allPages.length;
  let workDir = scratchDir;
  let ownsScratch = false;
  let pieceStore = null;
  try {
    if (!workDir) {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-pdf-pages-"));
      ownsScratch = true;
    }
    pieceStore = new PdfPagePieces(workDir);
  } catch (error) {
    closeObjects();
    if (ownsScratch) fs.rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
  note(provenance, { metadata, pages: npages, decoding: { scope: "page/font resource" } });
  log(`[+] Total pages: ${npages}; decoding by font resource`);

  const shared = new DocumentDecoding("font");
  // An explicit Zawgyi request must not be reinterpreted as Unicode glyphs.
  shared.visualUnicodeEnabled = sourceEncoding !== "zawgyi-one";
  const legacy = new DocumentDecoding("legacy", new Map(), WININNWA_LEGACY_CODE_PAGE);
  const sharedFontKinds = new WeakMap();
  shared.fontKind = (font) => {
    if (sharedFontKinds.has(font)) return sharedFontKinds.get(font);
    let kind = "UNKNOWN";
    if (isUnicodeFont(font.baseFont) || sourceEncoding === "unicode") kind = "UNICODE";
    else if (isZawgyiOneFont(font.baseFont)) kind = "ZAWGYI";
    else {
      const clusters = font.toUnicode && !font._conflictingSpaceMap
        ? [...font.toUnicode.values()].filter((value) => [...value].length > 1 && containsMyanmar(value)).length : 0;
      if (clusters >= 4) kind = "UNICODE";
    }
    sharedFontKinds.set(font, kind);
    return kind;
  };
  legacy.fontKind = (font) => font.needsLegacyTextFix ? "UNICODE" : shared.fontKind(font);

  let activeText = null;
  const close = () => {
    activeText?.close();
    activeText = null;
    pieceStore?.close();
    closeObjects();
    if (ownsScratch) fs.rmSync(workDir, { recursive: true, force: true });
  };

  function* generate() {
    try {
    for (let idx = 0; idx < npages; idx += 1) {
      const [pnum, pgen] = allPages[idx];
      const fontNames = new Set();
      const fontKinds = new Set();
      const usedLegacyFonts = new Set();
      let parsingPath = PDF_PARSING_PATHS.ZAWGYI_ONE;
      let checkpoint = null;
      let confirmedRepair = null;
      let visualGlyphRecovery = false;
      let unresolvedVisualGlyph = false;
      const [extractedLines, w, h, images] = extractPageLines(objects, pnum, pgen, shared, {
        scratchDir: workDir,
        pieceStore,
        usedMyanmarFonts: fontNames,
        usedFontKinds: fontKinds,
        usedLegacyFonts,
        inspectPrefix: (prefix, sharedFonts, loader, mediaBox) => {
          if (legacy.loader !== loader) {
            legacy.loader = loader;
            legacy.resetFontCache();
          }
          // Probe both existing parsers on the same bounded page prefix. No
          // confirmed byte pair is used as a route-selection shortcut.
          legacy.legacyFontNames = null;
          legacy.legacyResources = null;
          const legacyFonts = pageFontDecoders(loader, pnum, pgen, legacy);
          const probe = probePagePrefix(prefix, sharedFonts, legacyFonts, { mediaBox });
          const choice = choosePageParser(probe, { sourceEncoding });
          parsingPath = choice.parser;
          checkpoint = {
            bytes: prefix.length,
            reason: choice.reason,
            ...(choice.english !== undefined ? { english: choice.english } : {}),
            hasShownText: probe.hasShownText,
            hasText: Boolean(withoutZeroWidthSpace(probe.shared).trim() || withoutZeroWidthSpace(probe.legacy).trim()),
          };
          onPagePrefix?.(idx, prefix, parsingPath, checkpoint);
          if (parsingPath !== PDF_PARSING_PATHS.LEGACY) return shared;

          // Do not turn an English or Unicode face into WinInnwa merely
          // because a different face on the same page is legacy.
          const selected = new Set([...sharedFonts]
            .filter(([, font]) => font.parsingPath === PDF_PARSING_PATHS.LEGACY)
            .map(([name]) => name));
          for (const name of probe.usedFonts) {
            const font = sharedFonts.get(name);
            if (!font || font.isCid || isUnicodeFont(font.baseFont)) continue;
            const sample = probe.sharedByFont.get(name) || "";
            if (hasWinLayoutEvidence(sample)
                || (isLegacyFontName(font.baseFont) && hasNamedWinLayoutEvidence(sample))) selected.add(name);
          }
          // Selection is per PDF resource, not a family-wide byte map. Two
          // resources with the same display name can have different encodings.
          legacy.legacyResources = new Set([...selected].map((name) => legacyFonts.get(name)).filter(Boolean));
          // The selected page parser may still encounter a Unicode or
          // Zawgyi resource later. Read that resource's own encoding rather
          // than interpreting its PDF codes as WinInnwa; conversion remains
          // a single page-level decision and mixed pages are reported below.
          for (const [name, font] of sharedFonts) {
            if (["UNICODE", "ZAWGYI"].includes(shared.fontKind(font))) legacyFonts.set(name, font);
          }
          return legacy;
        },
        onPageContent: (streams, references, loader, spool) => onPageContent?.(idx, streams, references, loader, spool),
        onVisualGlyphRecovery: ({ changed, unresolved }) => {
          visualGlyphRecovery ||= changed;
          unresolvedVisualGlyph ||= unresolved;
        },
        onConfirmedRepair: ({ before, after, summary }) => {
          confirmedRepair = summary ?? {
            changedLines: countDiffLines(before, after),
            impossibleBefore: countImpossiblePairs(before),
            impossibleAfter: countImpossiblePairs(after),
          };
        },
      });
      const finishedPage = finishPageToFile(extractedLines, {
        directory: workDir, parsingPath, sourceEncoding, fontKinds,
      });
      const finished = { decision: finishedPage.decision };
      const { category, originalHasText } = finishedPage;
      let text;
      let lines;
      if (diskPages) {
        text = activeText = finishedPage.text;
        lines = layoutPages ? {
          [Symbol.iterator]: () => pageLayoutLines(extractedLines, text, finishedPage.lineCount),
        } : undefined;
      } else {
        try {
          text = [...finishedPage.text.chunks()].join("");
          lines = [...pageLayoutLines(extractedLines, finishedPage.text, finishedPage.lineCount)];
        } finally { finishedPage.text.close(); }
      }
      const warnings = [];
      if (checkpoint && !checkpoint.hasText && checkpoint.bytes === PAGE_CONTENT_PREFIX_BYTES && originalHasText) {
        const code = checkpoint.hasShownText ? "checkpoint-text-undecodable" : "text-after-checkpoint";
        warnings.push({ code, page: idx + 1, checkpointBytes: PAGE_CONTENT_PREFIX_BYTES });
        log(`[!] Page ${idx + 1}: no decodable text in the ${PAGE_CONTENT_PREFIX_BYTES}-byte checkpoint; page text was retained`);
      }
      if (visualGlyphRecovery) {
        warnings.push({ code: "unicode-glyph-recovery-needs-review", page: idx + 1 });
      }
      if (unresolvedVisualGlyph) {
        warnings.push({ code: "unicode-glyph-mapping-needs-review", page: idx + 1 });
      }
      if (parsingPath === PDF_PARSING_PATHS.ZAWGYI_ONE && usedLegacyFonts.size) {
        warnings.push({ code: "legacy-font-on-shared-page", page: idx + 1, fonts: [...usedLegacyFonts] });
      }
      if (parsingPath === PDF_PARSING_PATHS.LEGACY && fontKinds.has("ZAWGYI")) {
        warnings.push({ code: "zawgyi-font-on-legacy-page", page: idx + 1 });
      }
      if (finished.decision === "unaligned-unicode") {
        warnings.push({ code: "unicode-order-needs-review", page: idx + 1 });
      } else if (finished.decision === "unaligned-unknown") {
        warnings.push({ code: "encoding-order-needs-review", page: idx + 1 });
      } else if (finished.decision === "unaligned-zawgyi") {
        warnings.push({ code: "conversion-characters-need-review", page: idx + 1 });
      }
      shared._pageFonts.delete(`${pnum},${pgen}`);
      legacy._pageFonts.delete(`${pnum},${pgen}`);
      const result = {
        idx, lines, wh: [w, h], text, lineCount: finishedPage.lineCount,
        hasImg: images.length > 0 || pageHasImages(objects, pnum, pgen), images,
        decodeKind: parsingPath, perFont: true, pageFinalized: true, category,
        parsingPath, decision: finished.decision, fontNames, fontKinds, checkpoint,
        ...(confirmedRepair ? { confirmedRepair } : {}),
        ...(warnings.length ? { warnings } : {}),
      };
      if (idx + 1 === npages && !diskPages) close();
      yield result;
      activeText?.close();
      activeText = null;
      if ((idx + 1) % 500 === 0) log(`    ... extracted ${idx + 1}/${npages} pages`);
    }
    } finally {
      close();
    }
  }
  const pages = generate();
  const stop = pages.return.bind(pages);
  pages.return = (value) => {
    try { return stop(value); } finally { close(); }
  };
  return [metadata, npages, pages];
}


const orderZawgyi = (text) => preserveCharacters(text, (part) => orderText(Rabbit.zg2uni(part)));

export function cleanupFor(cat, text) {
  return cat === "UNICODE" ? cleanupUnicode(text) : null;
}


function convertLine(t, cat, applyCleanup) {
  if (cat === "ZAWGYI") return orderZawgyi(t);
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
  adviseParserMiddleChain("processPageRecord");
  const idx = pg.idx;
  const raw = pg.text;
  if (pg.perFont) {
    const kinds = pg.fontKinds || new Set();
    const cat = pg.category ?? (kinds.size === 1 ? [...kinds][0] : "UNKNOWN");
    const finalized = pg.pageFinalized === true;
    const text = finalized && typeof raw === "string"
      ? convertFinalizedPageText(raw, pg, applyCleanup !== false) : raw;
    const rep = { page: idx + 1, category: cat, prob: cat === "ZAWGYI" ? 1 : 0,
      text, nChanges: typeof raw === "string" && text !== raw ? countDiffLines(raw, text) : 0,
      perFont: true, pageFinalized: finalized,
      scanEligible: !finalized && kinds.size > 0 && !kinds.has("UNKNOWN"),
      ...(pg.decision === "zawcode" ? { textPath: "zawcode" } : {}),
      ...(pg.checkpoint ? { checkpoint: pg.checkpoint } : {}),
      ...(pg.confirmedRepair ? { confirmedRepair: pg.confirmedRepair } : {}),
      ...(pg.warnings?.length ? { warnings: pg.warnings } : {}) };
    if (wantLayout) {
      rep.lines = finalized && Array.isArray(pg.lines)
        ? pg.lines.map(([x, y, size, line]) => [x, y, size,
          convertFinalizedPageText(line, pg, applyCleanup !== false)])
        : pg.lines;
      rep.wh = pg.wh;
      rep.hasImg = pg.hasImg;
      rep.images = pg.images;
      rep.parsingPath = pg.parsingPath;
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
    base = orderZawgyi(raw);
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

export function collectPdfResult(reportsIter, npages, filename = "upload.pdf") {
  adviseParserMiddleChain("collectPdfResult");
  const reports = [];
  const pages = [];
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  const pagePaths = new Set();
  const pageWarnings = [];
  let textChars = 0;
  for (const rep of reportsIter) {
    const cat = rep.category;
    const base = rep.text;
    textChars += base.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new RuntimeError(`Extracted text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
    const clean = rep.perFont ? null : cleanupFor(cat, base);
    if (rep.parsingPath === PDF_PARSING_PATHS.LEGACY) pagePaths.add("wininnwa");
    else if (rep.textPath) pagePaths.add(rep.textPath);
    else if (cat === "ZAWGYI") pagePaths.add("zawgyi-one");
    else if (cat === "UNICODE") pagePaths.add("unicode");
    if (rep.warnings) pageWarnings.push(...rep.warnings);
    reports.push({ page: rep.page, category: cat, prob: rep.prob, base, clean,
      ...(rep.perFont ? { scanEligible: rep.scanEligible, pageFinalized: rep.pageFinalized } : {}),
      ...(rep.textPath ? { textPath: rep.textPath } : {}),
      ...(rep.checkpoint ? { checkpoint: rep.checkpoint } : {}),
      ...(rep.confirmedRepair ? { confirmedRepair: rep.confirmedRepair } : {}),
      ...(rep.warnings ? { warnings: rep.warnings } : {}) });
    pages.push({ text: base, lines: rep.lines, wh: rep.wh, hasImg: rep.hasImg,
      images: rep.images, parsingPath: rep.parsingPath });
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  const changes = collectChanges(reports);
  const encodingPath = pagePaths.size === 1 ? [...pagePaths][0] : null;
  return {
    filename, kind: "pdf", reports, counts, metadata: {}, changes, pages, npages,
    pageLocalDecoding: true,
    ...(encodingPath ? { encodingPath } : {}),
    ...(pageWarnings.length ? { pageWarnings } : {}),
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
    // OCR placeholders are internal and are not evidence about the DOCX's
    // source encoding or its keyboard/font.
    const detectionText = chunk.replace(/\uE000OCR-[0-9a-f-]{36}-\d+\uE001/gu, "");
    const [category, prob] = detector.detect(detectionText, { sourceEncoding, fontNames });
    const cat = normCategory(category);
    // For actual DOCX text, a known Unicode face is enough to keep the stored
    // code points, but does not prove which keyboard produced them.
    const fontUnicode = sourceEncoding === "auto" && hasOnlyUnicodeFonts(fontNames);
    const base = cat === "ZAWGYI" ? orderZawgyi(chunk)
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
  adviseParserMiddleChain("processDocxBytes");
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const fontNamesByParagraph = [];
  const imageFiles = imageDir ? [] : null;
  const paragraphs = extractDocxParagraphs(bytes, { imageDir, imageFiles, fontNamesByParagraph });
  const job = buildDocxJob(paragraphs, filename, detector, log, sourceEncoding, fontNamesByParagraph);
  if (imageFiles) job.imageFiles = imageFiles;
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


export async function processDocxForMethod(data, method, detector, filename = null, log = () => {}, options = {}) {
  const mode = String(method || "default").toLowerCase();
  if (!["default", "manual", "null"].includes(mode)) {
    throw new Error(`Unsupported method: ${JSON.stringify(method)} (use "default"/"manual"/"null")`);
  }
  if (mode === "default") {
    const probe = await processDocxBytesExternal(data, detector, filename || "upload.docx", log);
    if ((probe.counts.ZAWGYI ?? 0) + (probe.counts.UNICODE ?? 0) === 0) {
      log("    mammoth probe has no source-encoding evidence; handing the original DOCX to PRASER");
    } else {
      log(externalQualityOk(probe.counts)
        ? "    mammoth probe passed; handing the original DOCX to PRASER"
        : "    mammoth probe failed the Unicode-readability check; handing the original DOCX to PRASER");
    }
  }
  return processDocxBytes(data, detector, filename || "upload.docx", log, options);
}


export function buildFinalPages(job, applyCleanup) {
  adviseParserMiddleChain("buildFinalPages");
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
        images: pg.images,
        parsingPath: pg.parsingPath,
      });
    } else {
      out.push({ text: pg.text, lines: pg.lines, wh: pg.wh, hasImg: pg.hasImg,
        images: pg.images, parsingPath: pg.parsingPath });
    }
  }
  return out;
}

export { pyRound, baseName };














export async function markPdfImagePages(bytes, job, imageDir, log = () => {}) {
  const files = [];
  const reports = Array.isArray(job?.reports) ? job.reports : [];
  for (let i = 0; i < reports.length; i += 1) {
    if (!reports[i]?.hasImg && !job.pages?.[i]?.hasImg) continue;
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
