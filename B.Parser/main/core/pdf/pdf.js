import { createSourceRunner } from "../manager/runtime.js";



export const runPdfWorker = createSourceRunner({
  kind: "pdf",
  method: "default",
});
