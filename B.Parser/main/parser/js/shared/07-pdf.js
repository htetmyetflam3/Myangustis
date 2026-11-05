import { createSourceRunner } from "./runtime.js";



export const runPdfWorker = createSourceRunner({
  kind: "pdf",
  method: "default",
});
