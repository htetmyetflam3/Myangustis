/*
(PDF 34) PDF branch, position 34 in the chain - last step on written PDF output (PDF 32).
This module runs qpdf over a written output PDF to optimize it when optimization is enabled.
*/







import fs from "node:fs";
import { runQpdfFile } from "./helper/decrypt.js";

const OPTIMIZE_OFF = new Set(["0", "off", "false", "no"]);

export const pdfOptimizeEnabled = () =>
  !OPTIMIZE_OFF.has(String(process.env.PRASER_PDF_OPTIMIZE ?? "").trim().toLowerCase());

export async function writeOptimizedPdf(outPath, inputPath, log = () => {}) {
  if (!pdfOptimizeEnabled()) {
    fs.copyFileSync(inputPath, outPath);
    log("[+] PDF second pass: SKIPPED (PRASER_PDF_OPTIMIZE=0)");
    return { path: outPath, optimized: false, linearized: false };
  }
  try {
    const before = fs.statSync(inputPath).size;
    const { warnings } = await runQpdfFile(inputPath, outPath, [
      "--stream-data=compress", "--recompress-flate", "--compression-level=9",
      "--object-streams=generate", "--linearize",
    ]);
    const after = fs.statSync(outPath).size;
    const saved = before - after;
    const pct = before ? ((saved / before) * 100).toFixed(1) : "0.0";
    log(
      `[+] PDF second pass (qpdf): ${before.toLocaleString("en-US")} -> `
        + `${after.toLocaleString("en-US")} bytes (${saved >= 0 ? "-" : "+"}${Math.abs(Number(pct)).toFixed(1)}%), linearized`,
    );
    if (warnings) log(`[i] qpdf warning: ${warnings}`);
    return { path: outPath, optimized: true, linearized: true };
  } catch (error) {
    fs.copyFileSync(inputPath, outPath);
    log(`[!] PDF second pass failed, kept the first-pass file: ${error.message}`);
    return { path: outPath, optimized: false, linearized: false };
  }
}
