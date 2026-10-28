import { createSourceRunner } from "./runtime.js";




export const runPdfImageWorker = createSourceRunner({
  kind: "pdf",
  method: "manual",
  pdfImages: true,
});
