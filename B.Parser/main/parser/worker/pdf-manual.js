import { createSourceRunner } from "./runtime.js";
import { runPdfWorker } from "./pdf.js";
import * as ocrWorker from "./ocr-ops.js";




void runPdfWorker;
void ocrWorker;

export const runPdfManualWorker = createSourceRunner({
  kind: "pdf",
  method: "manual",
});
