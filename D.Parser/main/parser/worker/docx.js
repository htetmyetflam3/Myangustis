import { createSourceRunner } from "./runtime.mjs";

// Pure text-based DOCX extraction. Image areas are skipped here; DOCX image OCR
// belongs to docxmanualworker. The null method is also pure and DOCX-only, so it
// stays in this module instead of crossing into the manual/OCR path.
const runDocxDefaultWorker = createSourceRunner({
  kind: "docx",
  method: "default",
});

const runDocxNullWorker = createSourceRunner({
  kind: "docx",
  method: "null",
});

export function runDocxWorker(msg = {}) {
  return String(msg.method || "default").toLowerCase() === "null"
    ? runDocxNullWorker(msg)
    : runDocxDefaultWorker(msg);
}
