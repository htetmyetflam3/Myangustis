import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectPdfResult, markPdfImagePages, processPageRecord, streamPdfPages } from "../../../extend/pipeline.js";
import { runQpdfFile } from "../core/qpdf.js";
import { copyPdfPrefix, findPdfEnd } from "../read/pdf-tail.js";
import { renderPdfPagePng } from "../read/pdf-render.js";
import { PdfTextSink } from "../write/pdf-text-sink.js";
import { writePageStore } from "../write/emit.js";
import { PageStoreWriter } from "../read/page-store.js";
import { PosScanner } from "../text/scan.js";
import { PDF_PARSING_PATHS } from "../read/pdf-fonts.js";
import { startRecord, note, appendRecord, registerPath } from "../core/provenance.js";
import { REGISTER_LOG } from "../../../_path.js";
import {
  MAX_INPUT_BYTES, MAX_INPUT_MB, MAX_PAGES, MAX_TEXT_CHARS, OWNER_PARSER_WORKER,
} from "../core/limits.js";

async function preparePdf(input, prepared, directory, generalized) {
  const prepare = (source) => runQpdfFile(source, prepared, [
    "--password=", "--decrypt", "--object-streams=disable",
    ...(generalized ? ["--decode-level=generalized", "--stream-data=compress"] : ["--stream-data=preserve"]),
  ]);
  try {
    try {
      await prepare(input);
    } catch (cause) {
      if (!/can.t find startxref/iu.test(String(cause?.message))) throw cause;
      const end = findPdfEnd(input);
      if (!end || end >= fs.statSync(input).size) throw cause;
      const trimmed = path.join(directory, "trimmed.pdf");
      copyPdfPrefix(input, trimmed, end);
      await prepare(trimmed);
    }
  } catch (cause) {
    if (/invalid password|password.*incorrect|requires a password/iu.test(String(cause?.message))) {
      throw new Error("This PDF needs a password to open; supply an unprotected copy.", { cause });
    }
    throw cause;
  }
}

async function runPdfStreamAttempt(msg, { detector, manual = false, pdfImages = false, generalized = false } = {}) {
  const directory = fs.mkdtempSync(msg.workDir
    ? path.join(msg.workDir, "pdf-") : path.join(os.tmpdir(), "linga-pdf-job-"));
  let keepDirectory = false;
  let sink = null;
  let storeWriter = null;
  let scanner = null;
  let imageDir = null;
  let keepImages = false;
  const imageFiles = [];
  try {
    let input = msg.inPath;
    if (input) {
      if (fs.statSync(input).size > MAX_INPUT_BYTES) {
        throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
      }
    } else {
      const data = msg.data instanceof Uint8Array ? msg.data : msg.data ? new Uint8Array(msg.data) : null;
      if (!data) throw new Error("worker: no input data");
      if (data.byteLength > MAX_INPUT_BYTES) throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
      input = path.join(directory, "input.pdf");
      fs.writeFileSync(input, data, { mode: 0o600 });
    }
    const prepared = path.join(directory, "prepared.pdf");
    await preparePdf(input, prepared, directory, generalized);

    const source = msg.filename ?? (msg.inPath ? path.basename(msg.inPath) : "");
    const provenance = startRecord(source || msg.inPath || "");
    const warnings = [];
    const pagePaths = new Set();
    const noOutput = !msg.outPath;
    const outputExt = noOutput ? null : path.extname(msg.outPath).toLowerCase();
    const textOutput = !noOutput && (outputExt === "" || outputExt === ".txt");
    const pageScratch = path.join(directory, "pages");
    fs.mkdirSync(pageScratch, { mode: 0o700 });
    const [, totalPages, pages] = streamPdfPages(prepared, detector, () => {}, {
      diskPages: true,
      layoutPages: noOutput || outputExt === ".docx",
      scratchDir: pageScratch,
      sourceEncoding: msg.sourceEncoding ?? "auto",
      provenance,
    });
    if (totalPages > MAX_PAGES) {
      pages.return?.();
      throw new Error(`PDF exceeds the ${MAX_PAGES} page cap`);
    }
    const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
    let pageNumber = 0;
    let textChars = 0;
    const reports = noOutput ? [] : null;
    // Manual OCR modifies page text later; scan that final text instead.
    if (!manual && !noOutput) scanner = new PosScanner({ directory });
    if (!noOutput && !manual && textOutput) {
      sink = new PdfTextSink(directory, { includeText: msg.includeText === true, owner: OWNER_PARSER_WORKER });
    } else if (!noOutput) {
      storeWriter = new PageStoreWriter(directory);
    }
    try {
      for (const page of pages) {
        pageNumber += 1;
        const text = page.text;
        textChars += text.chars;
        if (textChars > MAX_TEXT_CHARS) throw new Error(`PDF extracted text exceeds the ${MAX_TEXT_CHARS} character cap`);
        if (scanner) await scanner.writePage(pageNumber, text.chunks());
        counts[page.category in counts ? page.category : "UNKNOWN"] += 1;
        if (page.parsingPath === PDF_PARSING_PATHS.LEGACY) pagePaths.add("wininnwa");
        else if (page.decision === "zawcode") pagePaths.add("zawcode");
        else if (page.category === "ZAWGYI") pagePaths.add("zawgyi-one");
        else if (page.category === "UNICODE") pagePaths.add("unicode");
        if (page.warnings) warnings.push(...page.warnings);
        if (noOutput) {
          reports.push(processPageRecord({
            ...page, text: [...text.chunks()].join(""), lines: [...page.lines],
          }, detector, false, () => {}, true, msg.sourceEncoding ?? "auto"));
          continue;
        }
        let marker = "";
        if (pdfImages && page.hasImg) {
          imageDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "linga-img-"));
          const id = String(imageFiles.length + 1).padStart(4, "0");
          const target = path.join(imageDir, `${id}-page${pageNumber}.png`);
          try {
            const { png } = await renderPdfPagePng(prepared, pageNumber);
            fs.writeFileSync(target, png, { mode: 0o600 });
            imageFiles.push({ id, path: target });
            marker = `\n[[IMAGE_${id}]]`;
          } catch {
            // Keep the page text if its image cannot be rendered, as before.
          }
        }
        function* chunks() {
          yield* text.chunks();
          if (marker) yield marker;
        }
        if (storeWriter) {
          storeWriter.addPage({
            text: chunks(), lines: page.lines ?? [],
            wh: page.wh, images: page.images ?? [], hasImg: page.hasImg === true,
          });
        } else {
          sink.addPage(chunks());
        }
      }
    } finally {
      pages.return?.();
      storeWriter?.close();
    }

    const linearized = path.join(directory, "source-linearized.pdf");
    let rasterSource = linearized;
    let linearizationWarning = null;
    try {
      await runQpdfFile(prepared, linearized, ["--linearize", "--object-streams=disable", "--stream-data=preserve"]);
    } catch (error) {
      linearizationWarning = String(error?.message || error);
      rasterSource = prepared;
    }
    note(provenance, {
      detection: counts,
      output: msg.outPath,
      sourceLinearization: linearizationWarning
        ? { linearized: false, error: linearizationWarning } : { linearized: true },
    });
    if (noOutput) {
      const job = collectPdfResult(reports, totalPages, source || "upload.pdf");
      if (linearizationWarning) job.linearizationError = linearizationWarning;
      if (pdfImages) {
        imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-img-"));
        job.imageFiles = await markPdfImagePages(rasterSource, job, imageDir);
        keepImages = job.imageFiles.length > 0;
      }
      return { result: job };
    }
    const common = {
      filename: source || null,
      pages: pageNumber,
      counts,
      encodingPath: pagePaths.size === 1 ? [...pagePaths][0] : null,
      ...(msg.includePreview === true ? { metadata: {}, changes: [] } : {}),
      ...(pdfImages ? { imageFiles, ...(imageFiles.length ? { imageDir } : {}) } : {}),
      ...(warnings.length ? { pageWarnings: warnings } : {}),
      ...(linearizationWarning ? { linearizationWarning } : {}),
    };
    if (manual) {
      keepDirectory = true;
      return {
        ...common,
        deferredOutput: true,
        pageStore: storeWriter.store,
        internalPdf: { path: rasterSource, dir: directory },
        provenance,
      };
    }
    const written = sink ? sink.finish(msg.outPath, counts, source)
      : await writePageStore(msg.outPath, storeWriter.store, {
        directory, counts, source, includeText: msg.includeText === true, owner: OWNER_PARSER_WORKER,
      });
    const posScan = scanner ? await scanner.finish(written.file) : null;
    appendRecord(provenance, { file: registerPath(REGISTER_LOG) });
    keepImages = imageFiles.length > 0;
    return { ...common, ...written, ...(posScan ? { posScan } : {}) };
  } finally {
    await scanner?.close();
    sink?.close();
    storeWriter?.close();
    if (imageDir && !keepImages) fs.rmSync(imageDir, { recursive: true, force: true });
    if (!keepDirectory) fs.rmSync(directory, { recursive: true, force: true });
  }
}

export async function runPdfStream(msg, options = {}) {
  try {
    return await runPdfStreamAttempt(msg, options);
  } catch (error) {
    if (error?.code !== "PDF_CONTENT_DECODE_REQUIRED" || options.generalized) throw error;
    // Less common filter chains require qpdf's generalized decoder. Retry the
    // whole job so the original checkpoint and page decisions are unchanged.
    return runPdfStreamAttempt(msg, { ...options, generalized: true });
  }
}
