import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const QPDF_BIN = process.env.PRASER_QPDF_BIN || "qpdf";

function execute(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(QPDF_BIN, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (cause) => reject(new Error(
      cause?.code === "ENOENT"
        ? `qpdf executable not found (${JSON.stringify(QPDF_BIN)}); install qpdf or set PRASER_QPDF_BIN`
        : `qpdf failed to start: ${cause?.message || cause}`,
      { cause },
    )));
    child.once("close", (code, signal) => {
      // qpdf exit 3 means warnings with a valid output; all other nonzero
      // statuses are fatal.
      if (code === 0 || code === 3) resolve({ warnings: stderr.trim() });
      else reject(new Error(`qpdf exited with ${signal ? `signal ${signal}` : `status ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

export async function qpdfAvailable() {
  try {
    await execute(["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** Run qpdf against private temporary files and return the rewritten bytes. */
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
