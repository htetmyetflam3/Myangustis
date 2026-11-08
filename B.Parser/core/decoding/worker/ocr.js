/*
(Support 44) Shared support, no chain position - an identical older copy of the OCR worker (OCR 1).
This file is byte-identical to core/worker/ocr.js and is not imported by the live chain; the Manager pool spawns the OCR 1 copy.
*/
import { parentPort } from "node:worker_threads";
import { handleOcrMessage } from "../ocr/ocr-ops.js";
import { withOutputType } from "./output-type.js";

if (!parentPort) {
  throw new Error("ocr.js must be run as a worker thread");
}

parentPort.on("message", async (msg) => {
  const { id } = msg ?? {};
  try {
    // A trigger/dispatcher OCR job arrives as job:"ocr"; the OCR operations
    // module names that same file-OCR operation op:"ocr". Existing low-level
    // op/type messages keep their original shape.
    const job = withOutputType(msg ?? {});
    const message = job.job === "ocr" && !job.op && !job.type
      ? { ...job, op: "ocr" }
      : job;
    const res = await handleOcrMessage(message);
    if (res && typeof res === "object" && "file" in res) {
      parentPort.postMessage({ id, ok: true, ...res });
    } else {
      parentPort.postMessage({ id, ok: true, result: res });
    }
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
