import { createSourceRunner } from "./runtime.js";

// Single default DOCX converter runner. Referenced images are detected and
// extracted by default (docxImages) so the separate OCR worker can read
// them; the converter output itself stays text/layout only.
export const runDocxWorker = createSourceRunner({
  kind: "docx",
  docxImages: true,
});
