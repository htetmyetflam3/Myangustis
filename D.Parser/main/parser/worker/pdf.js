import { createSourceRunner } from "./runtime.mjs";

// Pure text-based PDF extraction. This path deliberately does not OCR image
// regions embedded in an otherwise text-based PDF.
export const runPdfWorker = createSourceRunner({
  kind: "pdf",
  method: "default",
});
