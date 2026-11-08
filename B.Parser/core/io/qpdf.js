/*
(PDF 8) PDF branch, position 8 in the chain - after the byte checks (PDF 7).
This module runs the external qpdf program to prepare a PDF for the parser: decrypt it and rewrite it without object streams, into a working file.
*/
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const QPDF_BIN = process.env.PRASER_QPDF_BIN || "qpdf";

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

export async function runQpdfFile(input, output, args = []) {
  if (typeof input !== "string" || typeof output !== "string" || !input || !output) {
    throw new TypeError("qpdf requires input and output file paths");
  }
  await run(QPDF_BIN, [...args, "--", path.resolve(input), path.resolve(output)]);
  await fs.chmod(output, 0o600);
  return { warnings: "" };
}
