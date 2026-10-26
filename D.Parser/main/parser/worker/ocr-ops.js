import fs from "node:fs";
import path from "node:path";
import {
  ocrAvailable,
  pdfPageCount,
  pageHasImage,
  ocrPdfPage,
  ocrImage,
  ocrImageDetailed,
  closeOcr,
} from "../read/ocr.mjs";
import { writeOutput } from "../write/emit.mjs";
import {
  MAX_INPUT_BYTES,
  MAX_INPUT_MB,
  MAX_PAGES,
  MAX_TEXT_CHARS,
} from "../core/limits.mjs";

export function loadOcrBytes({ inPath, data }) {
  const bytes = inPath
    ? fs.readFileSync(inPath)
    : data instanceof Uint8Array ? data : data ? new Uint8Array(data) : null;
  if (bytes && bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
  }
  return bytes;
}

export async function ocrToFile(msg) {
  const bytes = loadOcrBytes(msg);
  const n = await pdfPageCount(bytes);
  if (n > MAX_PAGES) throw new Error(`PDF exceeds the ${MAX_PAGES} page cap`);
  const pages = [];
  let textChars = 0;
  for (let p = 1; p <= n; p += 1) {
    const text = await ocrPdfPage(bytes, p);
    textChars += text.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new Error(`OCR text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
    pages.push({ text });
  }
  const source = msg.source ?? (msg.inPath ? path.basename(msg.inPath) : "");
  const written = await writeOutput(msg.outPath, pages, {
    counts: { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 },
    source,
  });
  return { filename: source || null, pages: n, ...written };
}

export async function ocrImageFiles(msg) {
  const files = Array.isArray(msg.files) ? msg.files : [];
  if (files.length > 4096) throw new Error("DOCX image count exceeds the OCR limit");
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
  const bytes = loadOcrBytes(msg ?? {});
  switch (type) {
    case "available":
      return await ocrAvailable();
    case "pageCount":
      return await pdfPageCount(bytes);
    case "pageHasImage":
      return await pageHasImage(bytes, pageNumber);
    case "ocrPage":
      return await ocrPdfPage(bytes, pageNumber);
    case "ocrImageDetailed":
      return await ocrImageDetailed(bytes);
    case "close":
      await closeOcr();
      return true;
    default:
      throw new Error(`ocr.worker: unknown message ${JSON.stringify(type ?? msg?.op)}`);
  }
}
