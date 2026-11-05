import { createSourceRunner } from "./runtime.js";

export const runPdfManualWorker = createSourceRunner({
  kind: "pdf",
  method: "manual",
});
