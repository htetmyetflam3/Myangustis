/*
(parse) run: the parsing door at the top of @parse. Imports the two
decoding branches (pdf runtime/source, docx/source) and the shared
finishing (runtime/finish.js), and returns the parsed result:
one marked-up string per page, plus counts and reports.

Parsing ends here. Output writing is NOT called from parse: the
caller takes this result and hands it to requested.js (the output
wrapper) whenever - and however parallel - it chooses.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { streamPdfPages, collectPdfResult } from "./runtime/source.js";
import { processDocxBytes } from "./docx/source.js";
import { buildFinalPages } from "./runtime/finish.js";

// OCR is loaded lazily: the engine (tesseract + canvas) is heavy and most
// parses never need it.
const loadOcr = () => import("./ocr/ocr.js");

// Image-only PDF pages (scanned pages: an image but no extractable text)
// are OCR'd after the normal parse. Pages with real text are never
// touched, and an OCR failure only leaves the page as it was.
async function ocrImageOnlyPdfPages(job, source, log) {
  const targets = [];
  (job.pages ?? []).forEach((pg, i) => {
    if (pg.hasImg && String(pg.text ?? "").trim().length < 8) targets.push(i);
  });
  if (!targets.length) return;
  let bytes = source;
  if (typeof source === "string") {
    try { bytes = fs.readFileSync(source); } catch { return; }
  }
  const { ocrPdfPage } = await loadOcr();
  for (const i of targets) {
    try {
      const text = await ocrPdfPage(bytes, i + 1, { log });
      if (text && text.trim()) {
        job.pages[i].text = text;
        log(`    Page ${i + 1}: OCR supplied the text (image-only page)`);
      }
    } catch (error) {
      log(`    Page ${i + 1}: OCR skipped (${error.message})`);
    }
  }
}

// DOCX-embedded images are extracted to a scratch dir during the parse;
// each is OCR'd and its text replaces the image marker in place.
async function ocrDocxImages(job, log) {
  const files = job.imageFiles ?? [];
  if (!files.length) return;
  const { ocrImage } = await loadOcr();
  const replacements = new Map();
  for (const file of files) {
    try {
      const text = await ocrImage(fs.readFileSync(file.path), { log });
      replacements.set(file.marker, (text ?? "").trim());
    } catch (error) {
      log(`    DOCX image ${file.id}: OCR skipped (${error.message})`);
      replacements.set(file.marker, "");
    }
  }
  const swap = (value) => {
    if (typeof value !== "string") return value;
    let out = value;
    for (const [marker, text] of replacements) out = out.split(marker).join(text);
    return out;
  };
  for (const pg of job.pages ?? []) pg.text = swap(pg.text);
  for (const rep of job.reports ?? []) {
    rep.base = swap(rep.base);
    rep.clean = swap(rep.clean);
  }
}

export async function parseDecoding({ kind, source, filename = null, log = () => {} } = {}) {
  let job;
  if (kind === "pdf") {
    const reports = [];
    const [, npages, pageIter] = streamPdfPages(source, log, {});
    for await (const rep of pageIter) reports.push(rep);
    job = collectPdfResult(reports, npages, filename ?? "upload.pdf");
    await ocrImageOnlyPdfPages(job, source, log);
  } else if (kind === "docx") {
    const imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-docx-img-"));
    try {
      job = await processDocxBytes(source, filename ?? "upload.docx", log, { imageDir });
      await ocrDocxImages(job, log);
    } finally {
      fs.rmSync(imageDir, { recursive: true, force: true });
    }
  } else if (kind === "ocr") {
    // A bare image file: the whole input is one page of OCR text.
    const bytes = typeof source === "string" ? fs.readFileSync(source) : Buffer.from(source);
    const { ocrImage } = await loadOcr();
    const text = await ocrImage(bytes, { log });
    job = {
      filename: filename ?? "upload-image",
      kind: "ocr",
      reports: [{ page: 1, category: "UNKNOWN", prob: 0, base: text, clean: text }],
      counts: { UNKNOWN: 1 },
      metadata: {},
      changes: [],
      pages: [{ text }],
    };
  } else {
    throw new TypeError("parseDecoding: kind must be pdf, docx or ocr");
  }
  return {
    kind,
    filename: job.filename ?? filename,
    pages: buildFinalPages(job, true),
    counts: job.counts ?? {},
    reports: job.reports ?? [],
  };
}
