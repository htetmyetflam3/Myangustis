/*
(PDF 4) PDF branch, position 4 in the chain - after the converter-side entry (PDF 3).
This module creates the single default PDF converter runner (PDF 5) with image-page extraction turned on.
*/
import { createSourceRunner } from "./runtime.js";

// Single default PDF converter runner. Image pages are detected and
// extracted by default (pdfImages) so the separate OCR worker can read
// them; the converter output itself stays text/layout only.
export const runPdfWorker = createSourceRunner({
  kind: "pdf",
  pdfImages: true,
});
