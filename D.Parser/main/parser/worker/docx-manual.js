import { createSourceRunner } from "./runtime.js";
import { runDocxWorker } from "./docx.js";
import * as ocrWorker from "./ocr-ops.js";

// Manual DOCX is the image-aware DOCX path. The pure DOCX worker skips images;
// this module owns the DOCX+OCR boundary.
void runDocxWorker;
void ocrWorker;

export const runDocxManualWorker = createSourceRunner({
  kind: "docx",
  method: "manual",
  docxImages: true,
});
