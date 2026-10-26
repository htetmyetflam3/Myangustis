/**
 * qpdf second pass for every generated PDF.
 *
 * qpdf is Apache-2.0 licensed and provides deterministic stream compression,
 * object cleanup, and standards-compliant Fast Web View linearization without
 * loading a PDF rendering engine. Opt out with PRASER_PDF_OPTIMIZE=0.
 */
import fs from "node:fs";
import { runQpdf } from "../core/qpdf.mjs";

const OPTIMIZE_OFF = new Set(["0", "off", "false", "no"]);

export const pdfOptimizeEnabled = () =>
  !OPTIMIZE_OFF.has(String(process.env.PRASER_PDF_OPTIMIZE ?? "").trim().toLowerCase());

let linearizeSupported = null;
export const linearizeAvailable = () => linearizeSupported;

/**
 * Re-write and optionally linearize PDF bytes with qpdf.
 *
 * @returns {Promise<{bytes: Buffer, linearized: boolean, before: number, after: number}>}
 */
export async function optimizePdfBytes(input, { linearize = true } = {}) {
  const before = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const args = [
    "--stream-data=compress",
    "--recompress-flate",
    "--compression-level=9",
    "--object-streams=generate",
  ];
  if (linearize) args.push("--linearize");
  try {
    const { data: bytes, warnings } = await runQpdf(before, args);
    linearizeSupported = linearize;
    return {
      bytes,
      linearized: linearize,
      before: before.length,
      after: bytes.length,
      warnings,
    };
  } catch (cause) {
    if (linearize) linearizeSupported = false;
    throw cause;
  }
}

/** Write the qpdf second pass, retaining a readable first-pass file on error. */
export async function writeOptimizedPdf(outPath, bytes, log = () => {}) {
  if (!pdfOptimizeEnabled()) {
    fs.writeFileSync(outPath, bytes);
    log("[+] PDF second pass: SKIPPED (PRASER_PDF_OPTIMIZE=0)");
    return { path: outPath, optimized: false, linearized: false };
  }
  try {
    const result = await optimizePdfBytes(bytes);
    fs.writeFileSync(outPath, result.bytes);
    const saved = result.before - result.after;
    const pct = result.before ? ((saved / result.before) * 100).toFixed(1) : "0.0";
    log(
      `[+] PDF second pass (qpdf): ${result.before.toLocaleString("en-US")} -> `
        + `${result.after.toLocaleString("en-US")} bytes (${saved >= 0 ? "-" : "+"}${Math.abs(Number(pct)).toFixed(1)}%), `
        + `${result.linearized ? "linearized" : "not linearized"}`,
    );
    if (result.warnings) log(`[i] qpdf warning: ${result.warnings}`);
    return { path: outPath, optimized: true, linearized: result.linearized };
  } catch (error) {
    fs.writeFileSync(outPath, bytes);
    log(`[!] PDF second pass failed, kept the first-pass file: ${error.message}`);
    return { path: outPath, optimized: false, linearized: false };
  }
}
