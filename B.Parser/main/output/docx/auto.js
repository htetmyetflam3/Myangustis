import { createSourceRunner } from "../../manager/runtime.js";
import { runDocxWorker } from "../docx.js";
import * as ocrWorker from "../../ocr/ocr-ops.js";



void runDocxWorker;
void ocrWorker;

export const runDocxManualWorker = createSourceRunner({
  kind: "docx",
  method: "manual",
  docxImages: true,
});
