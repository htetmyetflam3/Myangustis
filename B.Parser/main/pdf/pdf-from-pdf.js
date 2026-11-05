import { runPdfWorker } from "../pdf/pdf.js";
import { runPdfManualWorker } from "../pdf/pdf-manual.js";
import { runPdfImageWorker } from "./pdf-images.js";






export async function runFromPdf(msg = {}) {
  if (String(msg.job || "extracting").toLowerCase() === "null") return runPdfImageWorker(msg);
  if (String(msg.method || "default").toLowerCase() === "manual") return runPdfManualWorker(msg);
  return runPdfWorker(msg);
}
