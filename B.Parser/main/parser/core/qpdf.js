import fs from "node:fs/promises";
import os from "node:os";
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

export async function qpdfAvailable() {
  try {
    await execute(["--version"]);
    return true;
  } catch {
    return false;
  }
}


export async function runQpdf(bytes, args = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "linga-qpdf-"));
  const input = path.join(dir, "input.pdf");
  const output = path.join(dir, "output.pdf");
  try {
    await fs.writeFile(input, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), { mode: 0o600 });
    const result = await execute([...args, "--", input, output]);
    const data = await fs.readFile(output);
    return { data, warnings: result.warnings };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
