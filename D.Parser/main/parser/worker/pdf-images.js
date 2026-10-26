import { createSourceRunner } from "./runtime.mjs";

// A PDF with both a text layer and image areas worth reading. The text core
// keeps what it extracted; every page carrying an image is rendered and
// marked, and the manager sends those renders to the OCR lane.
export const runPdfImageWorker = createSourceRunner({
  kind: "pdf",
  method: "manual",
  pdfImages: true,
});
