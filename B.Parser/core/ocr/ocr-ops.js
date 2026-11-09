/*
(OCR 2) OCR branch, position 2 in the chain - after the OCR worker entry (OCR 1).
This module handles OCR job messages: it loads the bytes, runs OCR over PDF pages or image files (OCR 3), and writes the recognized text out.
*/
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ocrAvailable,
  initOcr,
  pdfPageCount,
  pageHasImage,
  ocrPdfPage,
  ocrPdfRegion,
  ocrImage,
  ocrImageDetailed,
  closeOcr,
} from "./ocr.js";
import { writePageStore } from "../io/write.js";
import { PdfTextSink } from "../pdf/pdf-text-sink.js";
import { PageStoreWriter } from "../io/emit.js";
import { PosScanner } from "../beautify/scan.js";
import { normalizeOutputText } from "../decoding/judgement.js";
import { getEngineNormalize } from "../../_path.js";
import {
  MAX_INPUT_BYTES,
  MAX_INPUT_MB,
  MAX_PAGES,
  MAX_TEXT_CHARS,
  OWNER_PARSER_WORKER,
} from "../limits/local.js";

export function loadOcrBytes({ inPath, data }) {
  const bytes = inPath
    ? fs.readFileSync(inPath)
    : data instanceof Uint8Array ? data : data ? new Uint8Array(data) : null;
  if (bytes && bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
  }
  return bytes;
}

function loadOcrPdfSource(msg) {
  if (!msg?.inPath) return loadOcrBytes(msg ?? {});
  if (fs.statSync(msg.inPath).size > MAX_INPUT_BYTES) {
    throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
  }
  return msg.inPath;
}

export async function ocrToFile(msg) {
  const bytes = loadOcrPdfSource(msg);
  const n = await pdfPageCount(bytes);
  if (n > MAX_PAGES) throw new Error(`PDF exceeds the ${MAX_PAGES} page cap`);
  const source = msg.source ?? (msg.inPath ? path.basename(msg.inPath) : "");
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  const extension = path.extname(msg.outPath).toLowerCase();
  const textOutput = extension === "" || extension === ".txt";
  const directory = fs.mkdtempSync(msg.workDir
    ? path.join(msg.workDir, "ocr-") : path.join(os.tmpdir(), "linga-ocr-job-"));
  let sink;
  let store;
  let scanner;
  try {
    scanner = new PosScanner({ directory });
    if (textOutput) sink = new PdfTextSink(directory, { includeText: msg.includeText === true, owner: OWNER_PARSER_WORKER });
    else store = new PageStoreWriter(directory, "ocr");
    let textChars = 0;
    let normalize = null;
    for (let p = 1; p <= n; p += 1) {
      const recognized = await ocrPdfPage(bytes, p);
      textChars += recognized.length;
      if (textChars > MAX_TEXT_CHARS) throw new Error(`OCR text exceeds the ${MAX_TEXT_CHARS} character cap`);
      normalize ??= await getEngineNormalize();
      const text = normalizeOutputText(recognized, normalize);
      await scanner.writePage(p, [text]);
      if (sink) sink.addPage([text]);
      else store.addPage({ text: [text] });
    }
    store?.close();
    const written = sink ? sink.finish(msg.outPath, counts, source)
      : await writePageStore(msg.outPath, store.store, {
        directory, counts, source, includeText: msg.includeText === true, owner: OWNER_PARSER_WORKER, layout: false,
      });
    const posScan = await scanner.finish();
    return { filename: source || null, pages: n, ...written, posScan };
  } finally {
    await scanner?.close();
    sink?.close();
    store?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export async function ocrImageFiles(msg) {
  const files = Array.isArray(msg.files) ? msg.files : [];
  if (!OWNER_PARSER_WORKER && files.length > 4096) throw new Error("DOCX image count exceeds the OCR limit");
  const results = [];
  for (const file of files) {
    const image = fs.readFileSync(file.path);
    if (image.byteLength > MAX_INPUT_BYTES) throw new Error(`Image exceeds the ${MAX_INPUT_MB} MB cap`);
    results.push({ id: file.id, text: await ocrImage(image) });
  }
  return results;
}

export async function handleOcrMessage(msg) {
  if (msg?.op === "ocr") return await ocrToFile(msg);
  if (msg?.op === "ocr-images") return await ocrImageFiles(msg);
  const { type, pageNumber } = msg ?? {};
  const bytes = ["pageCount", "pageHasImage", "ocrPage", "ocrRegion"].includes(type)
    ? loadOcrPdfSource(msg ?? {})
    : loadOcrBytes(msg ?? {});
  switch (type) {
    case "available":
      return await ocrAvailable();
    case "init":
      await initOcr();
      return true;
    case "pageCount":
      return await pdfPageCount(bytes);
    case "pageHasImage":
      return await pageHasImage(bytes, pageNumber);
    case "ocrPage":
      return await ocrPdfPage(bytes, pageNumber);
    case "ocrRegion":
      return await ocrPdfRegion(bytes, pageNumber, msg.bbox);
    case "ocrImageDetailed":
      return await ocrImageDetailed(bytes);
    case "close":
      await closeOcr();
      return true;
    default:
      throw new Error(`ocr.worker: unknown message ${JSON.stringify(type ?? msg?.op)}`);
  }
}
