import { parentPort } from "node:worker_threads";
import { handleOcrMessage } from "./ocr-ops.mjs";

if (!parentPort) {
  throw new Error("ocr.worker.mjs must be run as a worker thread");
}

parentPort.on("message", async (msg) => {
  const { id } = msg ?? {};
  try {
    const res = await handleOcrMessage(msg);
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
