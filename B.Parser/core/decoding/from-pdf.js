/*
(PDF 3) PDF branch, position 3 in the chain - after the worker entry (PDF 1).
This module is the converter-side PDF entry point. It simply calls the default PDF runner (PDF 4); image pages are detected for the separate OCR worker, never re-embedded here.
*/
import { runPdfWorker } from "./pdf.js";

// Converter-side PDF entry. There is no manual/image-mode split here any
// more: the default converter runner detects and extracts image pages for
// the separate OCR worker, and never re-embeds images into the output.
export async function runFromPdf(msg = {}) {
  return runPdfWorker(msg);
}
