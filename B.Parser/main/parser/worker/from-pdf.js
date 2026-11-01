import { runPdfWorker } from "./pdf.js";
import { runPdfManualWorker } from "./pdf-manual.js";
import { runPdfImageWorker } from "./pdf-images.js";






export async function runFromPdf(msg = {}) {
  if (String(msg.job || "extracting").toLowerCase() === "null") return runPdfImageWorker(msg);
  if (String(msg.method || "default").toLowerCase() === "manual") return runPdfManualWorker(msg);
  return runPdfWorker(msg);
}
