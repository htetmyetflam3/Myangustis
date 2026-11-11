/*
(new/decrypt) The decryption step of the input stage.
qpdf over the landed tmp file; qpdf's decrypted output is a tmp file
too, handed downstream to seek in. A clean file passes untouched.
The qpdf runner lives here now (it used to sit in the old init tree)
so this tree answers for its own stages end to end.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { validatePdf } from "../../../@entry/helper/validator.js";

const QPDF_BIN = process.env.PRASER_QPDF_BIN || "qpdf";

// Run qpdf file to file; nothing passes through memory.
export function runQpdfFile(input, output, args = []) {
  if (typeof input !== "string" || typeof output !== "string" || !input || !output) {
    throw new TypeError("qpdf requires input and output file paths");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(QPDF_BIN, [...args, "--", path.resolve(input), path.resolve(output)], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (cause) => reject(new Error(
      cause?.code === "ENOENT"
        ? `qpdf executable not found (${JSON.stringify(QPDF_BIN)})`
        : `qpdf failed to start: ${cause?.message || cause}`,
      { cause },
    )));
    child.once("close", (code, signal) => {
      if (code === 0 || code === 3) resolve({ warnings: stderr.trim() });
      else reject(new Error(`qpdf exited with ${signal ? `signal ${signal}` : `status ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

export async function decryptPdf(file, workDir = null) {
  const state = validatePdf(file);
  if (!state.encrypted && !state.objectStreams) {
    return { path: file, prepared: false, ...state };
  }
  const dir = workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-decrypt-"));
  fs.mkdirSync(dir, { recursive: true });
  const prepared = path.join(dir, "decrypted.pdf");
  await runQpdfFile(file, prepared, ["--decrypt", "--object-streams=disable", "--qdf"]);
  return { path: prepared, prepared: true, ...state, size: fs.statSync(prepared).size };
}
