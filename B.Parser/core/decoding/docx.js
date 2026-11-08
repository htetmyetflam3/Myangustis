/*
(DOCX 5) DOCX branch, position 5 in the chain - after the converter-side entry (DOCX 4).
This module creates the single default DOCX converter runner (the shared source runner, PDF 5) with referenced-image extraction turned on.
*/
import { createSourceRunner } from "./runtime.js";

// Single default DOCX converter runner. Referenced images are detected and
// extracted by default (docxImages) so the separate OCR worker can read
// them; the converter output itself stays text/layout only.
export const runDocxWorker = createSourceRunner({
  kind: "docx",
  docxImages: true,
});
