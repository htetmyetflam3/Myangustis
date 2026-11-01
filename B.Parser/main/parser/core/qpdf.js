import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const QPDF_BIN = process.env.PRASER_QPDF_BIN || "qpdf";
const WASM_QPDF = fileURLToPath(new URL("./qpdf-wasm.js", import.meta.url));

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (cause) => reject(new Error(
      cause?.code === "ENOENT"
        ? `qpdf executable not found (${JSON.stringify(binary)})`
        : `qpdf failed to start: ${cause?.message || cause}`,
      { cause },
    )));
    child.once("close", (code, signal) => {


      if (code === 0 || code === 3) resolve({ warnings: stderr.trim() });
      else reject(new Error(`qpdf exited with ${signal ? `signal ${signal}` : `status ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function execute(args) {
  try {
    return await run(QPDF_BIN, args);
  } catch (error) {
    if (error.cause?.code !== "ENOENT" || process.env.PRASER_QPDF_BIN) throw error;
    return run(process.execPath, [WASM_QPDF, ...args]);
  }
}

// File-to-file processing avoids copying the input and output PDFs through
// JavaScript buffers. The caller owns both files and their temporary directory.
export async function runQpdfFile(input, output, args = []) {
  if (typeof input !== "string" || typeof output !== "string" || !input || !output) {
    throw new TypeError("qpdf requires input and output file paths");
  }
  const result = await execute([...args, "--", path.resolve(input), path.resolve(output)]);
  await fs.chmod(output, 0o600);
  return result;
}
