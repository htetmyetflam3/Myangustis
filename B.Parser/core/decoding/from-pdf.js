import { runPdfWorker } from "./pdf.js";

// Converter-side PDF entry. There is no manual/image-mode split here any
// more: the default converter runner detects and extracts image pages for
// the separate OCR worker, and never re-embeds images into the output.
export async function runFromPdf(msg = {}) {
  return runPdfWorker(msg);
}
