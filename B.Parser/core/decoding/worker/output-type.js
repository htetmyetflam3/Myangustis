/*
(Support 45) Shared support, no chain position - an identical older copy of the output-type helper (PDF 2).
This file is byte-identical to core/worker/output-type.js and is not imported by the live chain.
*/
import path from "node:path";

export const OUTPUT_TYPES = new Set(["pdf", "docx", "txt"]);

export function normalizeOutputType(output) {
  if (output === undefined || output === null || output === "") return "txt";
  const normalized = String(output).trim().toLowerCase().replace(/^\./, "");
  if (!OUTPUT_TYPES.has(normalized)) {
    throw new TypeError(`Unsupported output "${output}" (use "pdf", "docx", or "txt")`);
  }
  return normalized;
}

// The requested output type owns the extension of the path the worker
// writes, so downstream writers choose txt/docx/pdf from the trigger's
// output field instead of from whatever suffix a caller happened to use.
export function withOutputType(msg = {}) {
  const output = normalizeOutputType(msg.output ?? msg.outputFormat ?? msg.outputType);
  if (!msg.outPath) return { ...msg, output };
  const ext = path.extname(msg.outPath);
  if (ext.toLowerCase() === `.${output}`) return { ...msg, output };
  const base = ext ? msg.outPath.slice(0, -ext.length) : msg.outPath;
  return { ...msg, output, outPath: `${base}.${output}` };
}
