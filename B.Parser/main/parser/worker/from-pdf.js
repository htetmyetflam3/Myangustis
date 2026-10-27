import { runPdfWorker } from "./pdf.js";
import { runPdfImageWorker } from "./pdf-images.js";

/* handling "null" is the mixed case: a text layer AND image areas. The text
   core reads the text and marks the image pages; the second worker group
   reads the pages. Anything else is plain text extraction -- a pure scan
   never reaches this file, because the manager sends job:"ocr" to the OCR
   lane instead. */
export async function runFromPdf(msg = {}) {
  return String(msg.job || "extracting").toLowerCase() === "null"
    ? runPdfImageWorker(msg)
    : runPdfWorker(msg);
}
