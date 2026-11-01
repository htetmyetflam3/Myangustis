import { renderPdfPagePng } from "../main/parser/read/pdf-render.js";
import { note } from "../main/parser/core/provenance.js";
import { getEngineNormalize } from "../_path.js";
import fs from "node:fs";
import path from "node:path";

import { ZawgyiDetector, containsMyanmar, hasOnlyZawgyiFonts, hasOnlyUnicodeFonts, isZawgyiOneFont, isUnicodeFont } from "../main/parser/text/detector.js";
import { preserveRegionalRuns } from "../main/parser/text/unicode-evidence.js";
import { decryptPdf, isEncryptedPdf, hasObjectStreams, expandObjectStreams } from "../main/parser/read/decrypt.js";
import { Rabbit } from "../main/parser/text/rabbit.js";
import { cleanupText, orderText } from "../main/parser/text/cleanup.js";
import { extractDocxParagraphs, extractDocxImages, validateDocxArchive } from "../main/parser/read/docx-extract.js";
import { extractDocxParagraphsExternal } from "../main/parser/read/docx-external.js";
import { scoreText } from "../main/parser/text/mm-score.js";
import { choosePageParser, finishSharedPage, normalizePageLines } from "../main/parser/text/page-decision.js";
import { countImpossiblePairs } from "../main/parser/text/scan.js";
import { WININNWA_LEGACY_CODE_PAGE } from "../main/parser/codepage/registry.js";
import { MAX_PAGES, MAX_TEXT_CHARS } from "../main/parser/core/limits.js";
import {
  parsePdfObjects, findRootPages, collectPages, extractPageLines, probePagePrefix, pageHasImages, extractMetadata,
} from "../main/parser/read/pdf-extract.js";
import { DocumentDecoding, PDF_PARSING_PATHS, pageFontDecoders } from "../main/parser/read/pdf-fonts.js";
import { PAGE_CONTENT_PREFIX_BYTES } from "../main/parser/read/pdf-content-stream.js";
import { PageSourceWriter } from "../main/parser/write/page-source.js";
import { pyRound, RuntimeError, baseName } from "../main/parser/core/pylib.js";

const normalizeWithEngine = await getEngineNormalize();

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


export function streamPdfPages(source, detector = null, log = () => {}, {
  provenance = null, sourceEncoding = "auto", onPageContent = null, onPagePrefix = null,
} = {}) {
  const input = Buffer.isBuffer(source) || source instanceof Uint8Array
    ? (Buffer.isBuffer(source) ? source : Buffer.from(source)) : fs.readFileSync(source);
  log(`[+] PDF size: ${input.length.toLocaleString("en-US")} bytes`);
  if (isEncryptedPdf(input)) {
    throw new RuntimeError("This PDF is password-protected; decrypt it before extraction.");
  }
  if (hasObjectStreams(input)) {
    throw new RuntimeError(
      "This PDF stores objects in object streams (/ObjStm); expand them before extraction "
        + "(processBytesForMethod does this automatically).",
    );
  }
  const objects = parsePdfObjects(input);
  const metadata = extractMetadata(objects, input);
  const root = findRootPages(objects);
  if (root === null || root === undefined) throw new RuntimeError("No page tree found in the PDF.");
  const allPages = collectPages(objects, root);
  const npages = allPages.length;
  if (npages > MAX_PAGES) throw new RuntimeError(`PDF exceeds the ${MAX_PAGES} page cap`);
  note(provenance, { metadata, pages: npages, decoding: { scope: "page/font resource" } });
  log(`[+] Total pages: ${npages}; decoding by font resource`);

  const shared = new DocumentDecoding("font");
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

  function* generate() {
    for (let idx = 0; idx < npages; idx += 1) {
      const [pnum, pgen] = allPages[idx];
      const fontNames = new Set();
      const fontKinds = new Set();
      const usedLegacyFonts = new Set();
      let parsingPath = PDF_PARSING_PATHS.ZAWGYI_ONE;
      let checkpoint = null;
      let confirmedRepair = null;
      const [extractedLines, w, h, images] = extractPageLines(objects, pnum, pgen, shared, {
        usedMyanmarFonts: fontNames,
        usedFontKinds: fontKinds,
        usedLegacyFonts,
        inspectPrefix: (prefix, sharedFonts, loader) => {
          if (legacy.loader !== loader) {
            legacy.loader = loader;
            legacy.resetFontCache();
          }
          // Probe both existing parsers on the same bounded page prefix. No
          // confirmed byte pair is used as a route-selection shortcut.
          legacy.legacyFontNames = null;
          const legacyFonts = pageFontDecoders(loader, pnum, pgen, legacy);
          const probe = probePagePrefix(prefix, sharedFonts, legacyFonts);
          const choice = choosePageParser(probe, { sourceEncoding });
          parsingPath = choice.parser;
          checkpoint = {
            bytes: prefix.length,
            reason: choice.reason,
            ...(choice.english !== undefined ? { english: choice.english } : {}),
            hasShownText: probe.hasShownText,
            hasText: Boolean(probe.shared.trim() || probe.legacy.trim()),
          };
          onPagePrefix?.(idx, prefix, parsingPath, checkpoint);
          if (parsingPath !== PDF_PARSING_PATHS.LEGACY) return shared;

          // Do not turn an English or Unicode face into WinInnwa merely
          // because a different face on the same page is legacy.
          const selected = new Set([...sharedFonts.values()]
            .filter((font) => font.parsingPath === PDF_PARSING_PATHS.LEGACY)
            .map((font) => font.baseFont).filter(Boolean));
          if (!selected.size) {
            for (const name of probe.usedFonts) {
              const font = sharedFonts.get(name);
              if (font && !font.isCid && !isUnicodeFont(font.baseFont) && font.baseFont) selected.add(font.baseFont);
            }
          }
          legacy.legacyFontNames = selected;
          // The selected page parser may still encounter a Unicode font later
          // in the page. Preserve that font's own shared decoder rather than
          // interpreting its character codes as WinInnwa.
          for (const [name, font] of sharedFonts) {
            if (shared.fontKind(font) === "UNICODE") legacyFonts.set(name, font);
          }
          return legacy;
        },
        onPageContent: (streams, references, loader) => onPageContent?.(idx, streams, references, loader),
        onConfirmedRepair: ({ before, after }) => {
          confirmedRepair = {
            changedLines: countDiffLines(before, after),
            impossibleBefore: countImpossiblePairs(before),
            impossibleAfter: countImpossiblePairs(after),
          };
        },
      });
      const original = extractedLines.map((line) => line[3]).join("\n");
      // Confirmed legacy repairs have already been applied by the extractor.
      // Normalize the resulting Unicode once per line, as on the shared path.
      const finished = parsingPath === PDF_PARSING_PATHS.LEGACY
        ? { text: [...normalizePageLines(original, normalizeWithEngine)].join("\n"), decision: "legacy" }
        : finishSharedPage(original, {
          normalize: normalizeWithEngine,
          sourceEncoding,
          unicodeEvidence: fontKinds.has("UNICODE"),
          zawgyiEvidence: fontKinds.size > 0 && [...fontKinds].every((kind) => kind === "ZAWGYI"),
        });
      const parts = finished.text.split("\n");
      const lines = finished.text === original ? extractedLines
        : parts.length === extractedLines.length
          ? extractedLines.map((line, i) => [...line.slice(0, 3), parts[i]]) : [];
      const warnings = [];
      if (checkpoint && !checkpoint.hasText && checkpoint.bytes === PAGE_CONTENT_PREFIX_BYTES && original.trim()) {
        const code = checkpoint.hasShownText ? "checkpoint-text-undecodable" : "text-after-checkpoint";
        warnings.push({ code, page: idx + 1, checkpointBytes: PAGE_CONTENT_PREFIX_BYTES });
        log(`[!] Page ${idx + 1}: no decodable text in the ${PAGE_CONTENT_PREFIX_BYTES}-byte checkpoint; page text was retained`);
      }
      if (parsingPath === PDF_PARSING_PATHS.ZAWGYI_ONE && usedLegacyFonts.size) {
        warnings.push({ code: "legacy-font-on-shared-page", page: idx + 1, fonts: [...usedLegacyFonts] });
      }
      if (finished.decision === "unaligned-unicode") {
        warnings.push({ code: "unicode-order-needs-review", page: idx + 1 });
      } else if (finished.decision === "unaligned-unknown") {
        warnings.push({ code: "encoding-order-needs-review", page: idx + 1 });
      } else if (finished.decision === "unaligned-zawgyi") {
        warnings.push({ code: "conversion-characters-need-review", page: idx + 1 });
      }
      const category = !containsMyanmar(finished.text) || finished.decision === "unaligned-unknown" ? "UNKNOWN"
        : finished.decision === "rabbit" || finished.decision === "unaligned-zawgyi" ? "ZAWGYI" : "UNICODE";
      shared._pageFonts.delete(`${pnum},${pgen}`);
      legacy._pageFonts.delete(`${pnum},${pgen}`);
      yield {
        idx, lines, wh: [w, h], text: finished.text,
        hasImg: images.length > 0 || pageHasImages(objects, pnum, pgen), images,
        decodeKind: parsingPath, perFont: true, pageFinalized: true, category,
        parsingPath, decision: finished.decision, fontNames, fontKinds, checkpoint,
        ...(confirmedRepair ? { confirmedRepair } : {}),
        ...(warnings.length ? { warnings } : {}),
      };
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
  if (pg.perFont) {
    const kinds = pg.fontKinds || new Set();
    const cat = pg.category ?? (kinds.size === 1 ? [...kinds][0] : "UNKNOWN");
    const rep = { page: idx + 1, category: cat, prob: cat === "ZAWGYI" ? 1 : 0,
      text: raw, nChanges: 0, perFont: true, pageFinalized: pg.pageFinalized === true,
      scanEligible: !pg.pageFinalized && kinds.size > 0 && !kinds.has("UNKNOWN"),
      ...(pg.decision === "zawcode" ? { textPath: "zawcode" } : {}),
      ...(pg.checkpoint ? { checkpoint: pg.checkpoint } : {}),
      ...(pg.confirmedRepair ? { confirmedRepair: pg.confirmedRepair } : {}),
      ...(pg.warnings?.length ? { warnings: pg.warnings } : {}) };
    if (wantLayout) {
      rep.lines = pg.lines;
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
  const m = String(method || "default").toLowerCase();
  if (!["default", "manual", "null"].includes(m)) {
    throw new Error(`Unsupported method: ${JSON.stringify(method)} (use "default"/"manual"/"null")`);
  }
  if (m === "null" && k !== "docx") {
    throw new Error(`method:"null" is DOCX-only (no PDF path emits it); got kind=${JSON.stringify(kind)}`);
  }
  if (k !== "pdf") {
    return m === "default" ? processBytesDefault(data, k, detector, filename, log, options)
      : processBytes(data, k, detector, filename, log, options);
  }
  if (isEncryptedPdf(data)) data = await decryptPdf(data, log);
  if (hasObjectStreams(data)) data = await expandObjectStreams(data, log);

  const writer = new PageSourceWriter();
  let retained = false;
  try {
    const runOptions = { ...options, onPageContent: (index, streams, refs, loader) => {
      writer.addPage(index, streams);
      options.onPageContent?.(index, streams, refs, loader);
    } };
    const job = m === "default" ? await processBytesDefault(data, k, detector, filename, log, runOptions)
      : processBytes(data, k, detector, filename, log, runOptions);
    try {
      const source = await writer.finish(data);
      note(options.provenance, { sourceLinearization: { linearized: true } });
      if (source.warnings) log(`[i] qpdf linearization warning: ${source.warnings}`);
      if (options.retainLinearizedSource) {
        job.internalPdf = source;
        retained = true;
      }
    } catch (error) {
      // Keep the existing extraction available if a PDF cannot be rewritten.
      // Never report the original as linearized when this pass failed.
      job.linearizationError = error.message;
      note(options.provenance, { sourceLinearization: { linearized: false, error: error.message } });
      log(`[!] Source PDF linearization skipped: ${error.message}`);
    }
    return job;
  } finally {
    writer.close({ remove: !retained });
  }
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
