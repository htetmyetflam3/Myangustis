import { createSourceRunner } from "./runtime.js";

// Single default PDF converter runner. Image pages are detected and
// extracted by default (pdfImages) so the separate OCR worker can read
// them; the converter output itself stays text/layout only.
export const runPdfWorker = createSourceRunner({
  kind: "pdf",
  pdfImages: true,
});
