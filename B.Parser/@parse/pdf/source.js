/*
(praised/decoding/pdf) source: the PDF decoding branch.
Discovers the pages of a prepared PDF, decides each page's lane
from the page instructions, extracts and finishes the text
(finish.js), and collects the result. The branch's two separations
live one level down: font/ (font decoding - pdf-fonts,
pdf-encodings) and layout/ (layout decoding - page-instructions,
pdf-pages, pdf-content, pdf-image-coverage). They are separations,
not rivals: neither re-parses to check the other; judgement picks
the method a page is decoded by.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderPdfPagePng } from "./pdf-render.js";
import { note } from "../../../provenance.js";
import { MAX_TEXT_CHARS } from "../../../../init/helper/limit.js";
import {
  MAX_PDF_OBJECTS, extractPageLines, pageHasImages, extractMetadata,
  isEncryptedPdf, hasObjectStreams, scanPdfFileMarkers,
} from "../../decoding.js";
import { PdfFileObjects, openPdfScannedObjects } from "./pdf-objects.js";
import { decodePdfInstructions } from "./layout/page-instructions.js";
import { PdfPagePieces } from "./layout/pdf-pages.js";
import { DocumentDecoding, PDF_PARSING_PATHS, pageFontDecoders } from "./font/decoder.js";
import { cleanupFor, collectChanges, adviseParserMiddleChain } from "../finish.js";
import { RuntimeError } from "../../../helper/pylib.js";

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
