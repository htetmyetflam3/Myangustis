/*
(DOCX 4) DOCX branch, position 4 in the chain - after the worker entry (PDF 1) routes a DOCX job here.
This module is the converter-side DOCX entry point. It simply calls the default DOCX runner (DOCX 5).
*/
import { runDocxWorker } from "./docx.js";

// Converter-side DOCX entry. There is no manual/image-mode split here any
// more: the default converter runner detects and extracts referenced images
// for the separate OCR worker, and never re-embeds images into the output.
export async function runFromDocx(msg = {}) {
  return runDocxWorker(msg);
}
