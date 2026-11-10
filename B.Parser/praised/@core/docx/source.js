/*
(praised/decoding/docx) source: the DOCX decoding branch.
Extracts the paragraphs (docx-extract, or the external
runner), chunks them for the shared page-record finishing
(finish.js), and builds the job the composer writes out. Same
rule as the PDF branch: separation only, judgement decides.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractDocxParagraphs, validateDocxArchive } from "./docx-extract.js";
import { extractDocxParagraphsExternal } from "./docx-external.js";
import { cleanupFor, processPageRecord, collectChanges, adviseParserMiddleChain } from "../runtime/finish.js";
import { containsMyanmar, hasOnlyZawgyiFonts, hasOnlyUnicodeFonts } from "../../@rule/detect.js";
import { MAX_PAGES, MAX_TEXT_CHARS } from "../../../@entry/helper/limit.js";
import { RuntimeError } from "../../@helper/pylib.js";

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
    pages.push({ text: base, marked: true });
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


export async function processDocxBytes(data, filename = "upload.docx", log = () => {}, { imageDir = null, sourceEncoding = "auto" } = {}) {
  adviseParserMiddleChain("processDocxBytes");
  // A string is the landed temp file the input stage prepared: this
  // branch reads its own input here, never at the door.
  const bytes = typeof data === "string" ? await fs.promises.readFile(data) : (Buffer.isBuffer(data) ? data : Buffer.from(data));
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
