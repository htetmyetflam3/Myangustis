import { createSourceRunner } from "../manager/runtime.js";

export const runPdfManualWorker = createSourceRunner({
  kind: "pdf",
  method: "manual",
});
