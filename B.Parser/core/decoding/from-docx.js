import { runDocxWorker } from "./docx.js";

// Converter-side DOCX entry. There is no manual/image-mode split here any
// more: the default converter runner detects and extracts referenced images
// for the separate OCR worker, and never re-embeds images into the output.
export async function runFromDocx(msg = {}) {
  return runDocxWorker(msg);
}
