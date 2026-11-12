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
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { validatePdf } from "../../../@entry/helper/validator.js";

// Prefer a system qpdf when available, with the bundled qpdf WASM CLI as the
// portable fallback. Keep the Python parser/runtime out of this JS path.
const require = createRequire(import.meta.url);
const loadQpdfWasm = () => require("@jspawn/qpdf-wasm/qpdf.js");

export function qpdfRunners() {
  if (process.env.PRASER_QPDF_BIN) return [{ bin: process.env.PRASER_QPDF_BIN, args: [] }];
  return [{ bin: "qpdf", args: [] }, { bin: "qpdf-wasm", args: [] }];
}

let chosen = null;

// The runner actually in force - resolved once, and reported to callers that
// want to know whether qpdf is usable at all.
export function qpdfRunner() {
  if (chosen) return chosen;
  if (process.env.PRASER_QPDF_BIN) {
    chosen = qpdfRunners()[0];
    return chosen;
  }
  try {
    const probe = spawnSync("qpdf", ["--version"], { stdio: "ignore" });
    if (probe.status === 0) {
      chosen = { bin: "qpdf", args: [] };
      return chosen;
    }
  } catch { /* fall through to the bundled WASM CLI */ }
  chosen = { bin: "qpdf-wasm", args: [] };
  return chosen;
}

let wasmModulePromise;
let wasmMounted = false;
let wasmStdout = "";
let wasmStderr = "";

async function getQpdfWasmModule() {
  if (!wasmModulePromise) {
    const originalFetch = globalThis.fetch;
    // This Emscripten build uses Node's filesystem loader when fetch is absent.
    globalThis.fetch = undefined;
    wasmModulePromise = loadQpdfWasm()({
      noInitialRun: true,
      print: (line) => { wasmStdout += `${line}\n`; },
      printErr: (line) => { wasmStderr += `${line}\n`; },
    }).finally(() => { globalThis.fetch = originalFetch; });
  }
  const module = await wasmModulePromise;
  if (!wasmMounted) {
    try { module.FS.mkdir("/host"); } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    module.FS.mount(module.NODEFS, { root: path.parse(process.cwd()).root }, "/host");
    wasmMounted = true;
  }
  return module;
}

async function runQpdfWasm(args) {
  wasmStdout = "";
  wasmStderr = "";
  const module = await getQpdfWasmModule();
  const virtualArgs = args.map((arg) =>
    path.isAbsolute(arg) ? `/host${path.resolve(arg)}` : arg);
  const code = module.callMain(virtualArgs);
  const stderr = wasmStderr.trim();
  if (code === 0 || code === 3) return { warnings: stderr };
  throw new Error(`qpdf exited with status ${code}${stderr ? `: ${stderr}` : ""}`);
}

// Run qpdf file to file; nothing passes through memory.
export function runQpdfFile(input, output, args = []) {
  if (typeof input !== "string" || typeof output !== "string" || !input || !output) {
    throw new TypeError("qpdf requires input and output file paths");
  }
  const { bin, args: prefix } = qpdfRunner();
  if (bin === "qpdf-wasm") {
    return runQpdfWasm([...prefix, ...args, "--", path.resolve(input), path.resolve(output)]);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...prefix, ...args, "--", path.resolve(input), path.resolve(output)], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (cause) => reject(new Error(
      cause?.code === "ENOENT"
        ? `qpdf executable not found (${JSON.stringify(bin)})`
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
