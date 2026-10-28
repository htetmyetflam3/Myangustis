import { runPdfWorker } from "./pdf.js";
import { runPdfImageWorker } from "./pdf-images.js";






export async function runFromPdf(msg = {}) {
  return String(msg.job || "extracting").toLowerCase() === "null"
    ? runPdfImageWorker(msg)
    : runPdfWorker(msg);
}
