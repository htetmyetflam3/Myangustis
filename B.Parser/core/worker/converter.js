import { parentPort } from "node:worker_threads";
import { runFromPdf } from "../decoding/from-pdf.js";
import { runFromDocx } from "../decoding/from-docx.js";
import { withOutputType } from "./output-type.js";

if (!parentPort) {
  throw new Error("converter.js must be run as a worker thread");
}

function firstBytes(msg = {}) {
  const bytes = msg.data ?? msg.bytes ?? msg.object?.bytes ?? msg.object?.data;
  return bytes instanceof Uint8Array ? bytes : null;
}

function kindFromName(name) {
  const ext = String(name ?? "").toLowerCase().split(".").pop();
  return ext === "pdf" || ext === "docx" ? ext : null;
}

// The converter owns the PDF/DOCX choice: callers send key:"converter" and
// do not pick a file-format worker. Prefer the actual bytes, then an explicit
// kind/input field, then the filename/object path.
export function detectConverterKind(msg = {}) {
  const bytes = firstBytes(msg);
  if (bytes && bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
    && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "pdf"; // "%PDF-"
  }
  if (bytes && bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return "docx"; // ZIP container ("PK"), which is what a DOCX is.
  }

  const declared = String(msg.kind ?? msg.inputKind ?? msg.inputFormat ?? "")
    .trim()
    .toLowerCase();
  if (declared === "pdf" || declared === "docx") return declared;

  return kindFromName(msg.filename)
    ?? kindFromName(msg.inPath)
    ?? kindFromName(msg.object?.path)
    ?? kindFromName(msg.object?.filename);
}

async function run(msg = {}) {
  // Default converter behavior: detect the input type here, inside the
  // worker. The caller only sends key:"converter" plus the desired output
  // type; it never picks a PDF worker or a DOCX worker.
  const job = withOutputType(msg);
  const kind = detectConverterKind(job);
  if (kind === "docx") return runFromDocx({ ...job, kind });
  if (kind === "pdf") return runFromPdf({ ...job, kind });
  throw new Error("converter worker could not detect PDF or DOCX input");
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
