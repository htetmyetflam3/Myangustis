import { createSourceRunner } from "./runtime.mjs";
import { runPdfWorker } from "./pdf.mjs";
import * as ocrWorker from "./ocr-ops.mjs";

// Manual PDF keeps a separate module boundary from pure PDF extraction. Today
// the manual PDF core shares the same extraction semantics; OCR is imported here
// so mixed/manual PDF handling can be added without crossing the pure worker.
void runPdfWorker;
void ocrWorker;

export const runPdfManualWorker = createSourceRunner({
  kind: "pdf",
  method: "manual",
});
