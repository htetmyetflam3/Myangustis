/*
(PDF 10) PDF branch, position 10 in the chain - after the file is prepared (PDF 6 to 9), before output is written (PDF 31).
This module is the page-by-page orchestrator: it discovers the pages, decides each page's decoding lane from the page instructions (PDF 11), extracts the text (PDF 13), finishes each page (PDF 19), and turns pages into final records.
*/
import { renderPdfPagePng } from "../pdf/pdf-render.js";
import { note } from "../provenance.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { containsMyanmar, hasOnlyZawgyiFonts, hasOnlyUnicodeFonts } from "../detect.js";
import { Rabbit } from "../rabbit.js";
import { orderText } from "../clean.js";
import { preserveCharacters, instructionLane } from "./praised/judgement.js";
export { instructionLane };
import { extractDocxParagraphs, validateDocxArchive } from "../docx/docx-extract.js";
import { extractDocxParagraphsExternal } from "../docx/docx-external.js";
import { scoreText } from "./praised/judgement.js";
import { countImpossiblePairs } from "../beautify/scan.js";
import { WININNWA_LEGACY_CODE_PAGE } from "../codepage/codepage-registry.js";
import { MAX_PAGES, MAX_TEXT_CHARS } from "../limits/local.js";
import {
  MAX_PDF_OBJECTS, extractPageLines, pageHasImages, extractMetadata,
  isEncryptedPdf, hasObjectStreams, scanPdfFileMarkers,
} from "../io/read.js";
import { PdfFileObjects, openPdfScannedObjects } from "../pdf/pdf-objects.js";
import { decodePdfInstructions } from "../pdf/page-instructions.js";
import { PdfPagePieces } from "../pdf/pdf-pages.js";
import {
  cleanupUnicodeText as cleanupUnicode, convertFinalizedPageText,
  finishPageToFile, orderUnicodeText as orderUnicode, pageLayoutLines,
} from "./praised/finalized-cmap.js";
import { DocumentDecoding, PDF_PARSING_PATHS, legacyLayoutForFont, pageFontDecoders } from "../pdf/pdf-fonts.js";
import { pyRound, RuntimeError, baseName } from "../pylib.js";
import { agentAdvisory } from "../../../Architecture/host/advisory.js";

const PARSER_CHAIN_DOOR = "ParserManager";

function adviseParserMiddleChain(api) {
  if (process.env.MYANGUSTIS_CHAIN_DOOR === PARSER_CHAIN_DOOR) return;
  agentAdvisory(
    "parser-middle-chain",
    `[Parser agent advisor] STOP: B.Parser/core/decoding/source-decoding.js:${api}() is a middle-chain API, not the Parser chain door. `
      + "Start from B.Parser/index.js (Manager.dispatchStream/Manager.dispatch) or "
      + "tools-box/js/pipeline-cli.js parser local, and report only that front-door behavior. "
      + "Calling pipeline/text/read helpers directly skips Manager spooling, worker preparation, output/POS sidecars and cleanup options.",
  );
}

export function streamPdfPages(source, log = () => {}, {
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
  let instructionPages;
  try {
    metadata = extractMetadata(objects, fileBacked ? objects.trailer : input);
    // Page order, geometry, font chains and content references come from
    // the outside-stream instruction pass (page-instructions.js): the
    // document is discovered from dictionaries alone, before any stream
    // is opened. The instruction walk enforces the page cap itself.
    const instructions = decodePdfInstructions(objects);
    if (!instructions.rootPages) throw new RuntimeError("No page tree found in the PDF.");
    instructionPages = instructions.pages;
  } catch (error) {
    closeObjects();
    throw error;
  }
  const npages = instructionPages.length;
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
  // The legacy lane's document-level fallback layout is WinInnwa: per-
  // resource layouts are guarded by font name inside the lane
  // (legacyLayoutForFont) — Ayar-set faces get Ayar, unknown faces stay
  // on WinInnwa and are flagged for the cleaning stage's next module.
  const legacy = new DocumentDecoding("legacy", new Map(), WININNWA_LEGACY_CODE_PAGE);
  const sharedFontKinds = new WeakMap();
  shared.fontKind = (font) => {
    if (sharedFontKinds.has(font)) return sharedFontKinds.get(font);
    // Font names never classify a resource. The only evidence is the
    // caller's explicit encoding, or what the font's own ToUnicode map
    // actually outputs (multi-character Myanmar clusters read as Unicode).
    let kind = "UNKNOWN";
    if (sourceEncoding === "unicode") kind = "UNICODE";
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
      const pageInstruction = instructionPages[idx];
      const [pnum, pgen] = [pageInstruction.num, pageInstruction.gen];
      const laneChoice = instructionLane(pageInstruction, sourceEncoding);
      const fontNames = new Set();
      const fontKinds = new Set();
      const usedLegacyFonts = new Set();
      let legacyUnknownFonts = [];
      let parsingPath = PDF_PARSING_PATHS.FONT_CMAP;
      let checkpoint = null;
      let confirmedRepair = null;
      let visualGlyphRecovery = false;
      let unresolvedVisualGlyph = false;
      const [extractedLines, w, h, images] = extractPageLines(objects, pnum, pgen, shared, {
        pageBox: pageInstruction.size,
        scratchDir: workDir,
        pieceStore,
        usedMyanmarFonts: fontNames,
        usedFontKinds: fontKinds,
        usedLegacyFonts,
        inspectPrefix: (prefix, sharedFonts, loader) => {
          if (legacy.loader !== loader) {
            legacy.loader = loader;
            legacy.resetFontCache();
          }
          // The lane is decided by the outside-stream instructions for
          // this page (see instructionLane above); no sample of the
          // page's shown text is decoded to choose it.
          legacy.legacyFontNames = null;
          legacy.legacyResources = null;
          parsingPath = laneChoice.parser;
          checkpoint = {
            reason: laneChoice.reason,
            ...(laneChoice.fonts ? { fonts: laneChoice.fonts } : {}),
          };
          onPagePrefix?.(idx, prefix, parsingPath, checkpoint);
          if (parsingPath !== PDF_PARSING_PATHS.LEGACY) return shared;
          const legacyFonts = pageFontDecoders(loader, pnum, pgen, legacy);

          // Inside the legacy lane the font name is only a layout guard:
          // profile-matched resources, name-guarded legacy faces, and any
          // other simple face (unknown faces parse with Ayar) are read with
          // the legacy layouts; CID faces keep their own cmap decoding.
          const selected = new Set([...sharedFonts]
            .filter(([, font]) => !font.isCid
              && (font.parsingPath === PDF_PARSING_PATHS.LEGACY
                || legacyLayoutForFont(font.baseFont)))
            .map(([name]) => name));
          // Selection is per PDF resource, not a family-wide byte map. Two
          // resources with the same display name can have different encodings.
          legacy.legacyResources = new Set([...selected].map((name) => legacyFonts.get(name)).filter(Boolean));
          // Unknown legacy faces parse with WinInnwa above; record them so
          // the cleaning stage can route them to its next module.
          legacyUnknownFonts = [...selected]
            .filter((name) => {
              const font = sharedFonts.get(name);
              return font && !legacyLayoutForFont(font.baseFont).known
                && !["UNICODE", "ZAWGYI"].includes(shared.fontKind(font));
            })
            .map((name) => sharedFonts.get(name)?.baseFont || name);
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
      if (visualGlyphRecovery) {
        warnings.push({ code: "unicode-glyph-recovery-needs-review", page: idx + 1 });
      }
      if (unresolvedVisualGlyph) {
        warnings.push({ code: "unicode-glyph-mapping-needs-review", page: idx + 1 });
      }
      if (parsingPath === PDF_PARSING_PATHS.FONT_CMAP && usedLegacyFonts.size) {
        warnings.push({ code: "legacy-font-on-shared-page", page: idx + 1, fonts: [...usedLegacyFonts] });
      }
      if (parsingPath === PDF_PARSING_PATHS.LEGACY && fontKinds.has("ZAWGYI")) {
        warnings.push({ code: "zawgyi-font-on-legacy-page", page: idx + 1 });
      }
      if (parsingPath === PDF_PARSING_PATHS.LEGACY && legacyUnknownFonts.length) {
        warnings.push({ code: "legacy-unknown-font", page: idx + 1, fonts: legacyUnknownFonts });
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


export function processPageRecord(pg, applyCleanup, log = () => {}, wantLayout = false, sourceEncoding = "auto") {
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
  // No detector: the category is whatever the per-page parsing decided
  // (2 KB checkpoint -> page parser -> page decision/category). A record
  // that carries no category from that parsing is UNKNOWN and passes
  // through; font names alone never classify it here.
  const [category, prob] = sourceEncoding === "auto" && pg.legacyDecoded
    ? ["UNICODE", 0]
    : [pg.category ?? "UNKNOWN", pg.category === "ZAWGYI" ? 1 : 0];
  let cat = String(category).toUpperCase();
  if (cat === "OTHER") cat = "UNKNOWN";
























  if (cat === "ZAWGYI" && sourceEncoding !== "zawgyi-one"
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
      page: idx + 1, category: cat, prob: Number.isFinite(prob) ? prob : 0, text: raw, nChanges: 0,
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
    page: idx + 1, category: cat, prob: Number.isFinite(prob) ? prob : 0, text, nChanges,
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


function buildDocxJob(paragraphs, filename, log, sourceEncoding = "auto", fontNamesByParagraph = null) {
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
    // No detector: classify the chunk from the evidence in hand — explicit
    // source encoding first, then the chunk's own font faces. Anything else
    // stays UNKNOWN and passes through unconverted.
    let category = "UNKNOWN";
    let prob = 0;
    if (containsMyanmar(detectionText)) {
      if (sourceEncoding === "zawgyi-one") { category = "ZAWGYI"; prob = 1; }
      else if (sourceEncoding === "unicode") category = "UNICODE";
      else if (hasOnlyZawgyiFonts(fontNames)) { category = "ZAWGYI"; prob = 1; }
      else if (hasOnlyUnicodeFonts(fontNames)) category = "UNICODE";
    }
    let cat = String(category).toUpperCase();
    if (cat === "OTHER") cat = "UNKNOWN";
    // For actual DOCX text, a known Unicode face is enough to keep the stored
    // code points, but does not prove which keyboard produced them.
    const fontUnicode = sourceEncoding === "auto" && hasOnlyUnicodeFonts(fontNames);
    const base = cat === "ZAWGYI" ? orderZawgyi(chunk)
      : cat === "UNICODE" ? (fontUnicode ? chunk : orderUnicode(chunk)) : chunk;
    const clean = cleanupFor(cat, base);
    reports.push({ page: idx + 1, category: cat, prob: Number.isFinite(prob) ? prob : 0, base, clean });
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
export function processDocxBytes(data, filename = "upload.docx", log = () => {}, { imageDir = null, sourceEncoding = "auto" } = {}) {
  adviseParserMiddleChain("processDocxBytes");
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const fontNamesByParagraph = [];
  const imageFiles = imageDir ? [] : null;
  const paragraphs = extractDocxParagraphs(bytes, { imageDir, imageFiles, fontNamesByParagraph });
  const job = buildDocxJob(paragraphs, filename, log, sourceEncoding, fontNamesByParagraph);
  if (imageFiles) job.imageFiles = imageFiles;
  return job;
}


export async function processDocxBytesExternal(data, filename = "upload.docx", log = () => {}) {
  validateDocxArchive(Buffer.isBuffer(data) ? data : Buffer.from(data));
  const paragraphs = await extractDocxParagraphsExternal(data);
  return buildDocxJob(paragraphs, filename, log);
}

export const EXTERNAL_UNICODE_QUALITY_FLOOR = 0.5;
function externalQualityOk(counts) {
  const total = (counts.ZAWGYI ?? 0) + (counts.UNICODE ?? 0) + (counts.UNKNOWN ?? 0);
  if (total === 0) return false;
  return (counts.UNICODE ?? 0) / total >= EXTERNAL_UNICODE_QUALITY_FLOOR;
}


export async function processDocxForMethod(data, method, filename = null, log = () => {}, options = {}) {
  const mode = String(method || "default").toLowerCase();
  if (!["default", "manual", "null"].includes(mode)) {
    throw new Error(`Unsupported method: ${JSON.stringify(method)} (use "default"/"manual"/"null")`);
  }
  if (mode === "default") {
    const probe = await processDocxBytesExternal(data, filename || "upload.docx", log);
    if ((probe.counts.ZAWGYI ?? 0) + (probe.counts.UNICODE ?? 0) === 0) {
      log("    mammoth probe has no source-encoding evidence; handing the original DOCX to PRASER");
    } else {
      log(externalQualityOk(probe.counts)
        ? "    mammoth probe passed; handing the original DOCX to PRASER"
        : "    mammoth probe failed the Unicode-readability check; handing the original DOCX to PRASER");
    }
  }
  return processDocxBytes(data, filename || "upload.docx", log, options);
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
