import { parentPort } from "node:worker_threads";
import path from "node:path";
import { runFromPdf } from "./from-pdf.mjs";
import { runFromDocx } from "./from-docx.mjs";

if (!parentPort) {
  throw new Error("prase.worker.mjs must be run as a worker thread");
}

function inferKind(kind, name) {
  if (kind) return String(kind).toLowerCase();
  const ext = (name || "").toLowerCase().split(".").pop();
  return ext === "docx" ? "docx" : "pdf";
}

async function run(msg = {}) {
  const name = msg.filename ?? (msg.inPath ? path.basename(msg.inPath) : null);
  const kind = inferKind(msg.kind, name);
  if (kind === "docx") return await runFromDocx({ ...msg, kind });
  if (kind === "pdf") return await runFromPdf({ ...msg, kind });
  throw new Error(`Unsupported kind: ${JSON.stringify(kind)} (use 'pdf' or 'docx')`);
}

parentPort.on("message", async (msg) => {
  const { id } = msg ?? {};
  try {
    const result = await run(msg);
    if (result && typeof result === "object" && "result" in result && !("file" in result)) {
      parentPort.postMessage({ id, ok: true, result: result.result });
      return;
    }
    parentPort.postMessage({ id, ok: true, ...result });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { name: "Error", message: String(err) },
    });
  }
});
