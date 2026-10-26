import { createSourceRunner } from "./runtime.js";
import { runPdfWorker } from "./pdf.js";
import * as ocrWorker from "./ocr-ops.js";

// Manual PDF keeps a separate module boundary from pure PDF extraction. Today
// the manual PDF core shares the same extraction semantics; OCR is imported here
// so mixed/manual PDF handling can be added without crossing the pure worker.
void runPdfWorker;
void ocrWorker;

export const runPdfManualWorker = createSourceRunner({
  kind: "pdf",
  method: "manual",
});
