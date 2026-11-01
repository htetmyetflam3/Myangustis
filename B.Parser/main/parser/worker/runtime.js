import { getEngineNormalize, getLogen } from "../../../_path.js";
const { emitEvent, installPassiveLog } = (await getLogen()).siteLog;
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadDetector, processBytesForMethod, buildFinalPages, markPdfImagePages } from "../../../extend/pipeline.js";
import { writeOutput } from "../write/emit.js";
import { scanText, formatScanReport, loadScanDictionary, dictionaryWords } from "../text/scan.js";
import { repairText, repairFromScanVerdict } from "../text/repair.js";
import { orderZawCodePages } from "../text/zawcode-order.js";

import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "../core/limits.js";
import { REGISTER_LOG } from "../../../_path.js";
import { startRecord, note, appendRecord, registerPath } from "../core/provenance.js";






installPassiveLog({
  file: process.env.LOG_FILE || "",
  checks: /^(1|true|on|yes)$/i.test(String(process.env.LOG_CHECKS ?? "")),
});

const scanLoggingEnabled = /^(1|true|yes|on)$/iu.test(String(process.env.PRASER_SCAN_LOGGING || ""));





function dictionaryOnce() {
  return loadScanDictionary() ?? {};
}













function repairPages(pages, words, eligible = () => true) {
  const totals = { pages: 0, repairs: 0, splits: 0 };
  if (!words || !words.size) return { pages, totals };
  const repairedPages = pages.map((page, index) => {
    if (!eligible(index)) return page;
    const text = page?.text || "";
    if (!text) return page;
    const repaired = repairText(text, words);
    if (repaired.text === text) return page;
    totals.pages += 1;
    for (const item of repaired.repairs) totals.repairs += item.count;
    for (const item of repaired.splits || []) totals.splits += item.count;
    return { ...page, text: repaired.text };
  });
  return { pages: repairedPages, totals };
}

let detector = null;
export function detectorOnce() {
  if (detector === null) detector = loadDetector();
  return detector;
}

export function loadBytes({ inPath, data }) {
  const bytes = inPath
    ? fs.readFileSync(inPath)
    : data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
  }
  return bytes;
}













const SCAN_VERDICT_PATHS = new Set(["wininnwa", "ayar", "zawcode"]);
const scanVerdictApplies = (chosen) =>
  typeof chosen === "string" && (SCAN_VERDICT_PATHS.has(chosen) || chosen.startsWith("vector:"));

function scanPathVerdict(pages, outPath, chosenPath) {
  if (!scanVerdictApplies(chosenPath)) {
    return { report: null, scanLog: null, scanSummary: [], scanTotals: null };
  }
  const body = pages.map((page) => page.text || "").join("\n\n");
  const data = dictionaryOnce();
  const report = scanText(body, {
    dictionary: dictionaryWords(data),
    standalone: data?.mapData?.newClause?.standalone || [],
  });
  const summary = Object.entries(report)
    .map(([key, value]) => `${key} ${value.total}`)
    .filter((value) => !value.endsWith(" 0"));
  const scanTotals = Object.fromEntries(
    Object.entries(report).map(([key, value]) => [key, value.total]),
  );
  emitEvent("scan", { path: chosenPath, chars: body.length, ...scanTotals });

  if (!scanLoggingEnabled) return { report, scanLog: null, scanSummary: summary, scanTotals };
  const scanPath = `${outPath}.scan.txt`;
  fs.writeFileSync(scanPath, formatScanReport(report, {
    source: path.basename(outPath),
    totalChars: body.length,
  }), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(scanPath, 0o600);
  return { report, scanLog: scanPath, scanSummary: summary, scanTotals };
}

export function createSourceRunner({ kind, method, docxImages = false, pdfImages = false }) {
  return async function runSource(msg = {}) {
    const {
      filename, data, inPath, outPath,
    } = msg;
    let imageDir = null;
    const bytes = loadBytes({ inPath, data });
    const name = filename ?? (inPath ? path.basename(inPath) : null);



    const provenance = startRecord(name ?? inPath ?? "");
    const options = (docxImages || pdfImages)
      ? (imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-img-"))) && { imageDir, provenance }
      : { provenance };
    options.sourceEncoding = msg.sourceEncoding ?? "auto";
    options.retainLinearizedSource = kind === "pdf" && msg.deferOutput === true;
    const job = await processBytesForMethod(
      bytes,
      kind,
      method,
      detectorOnce(),
      name ?? null,
      () => {},
      options,
    );




    let handedOffSource = false;
    try {
    if (pdfImages && imageDir) job.imageFiles = await markPdfImagePages(bytes, job, imageDir);

    if (!outPath) return { result: job };







    const chosenPath = provenance?.codepage?.chosen ?? job.encodingPath ?? null;
    const isDraft = provenance?.codepage?.draft === true;
    const pageLocal = job.pageLocalDecoding === true;
    const dictData = isDraft || pageLocal ? null : dictionaryOnce();
    const words = dictData ? dictionaryWords(dictData) : new Set();
    const standalone = dictData?.mapData?.newClause?.standalone || [];
    const applyCleanup = msg.applyCleanup !== false;
    const finalPages = buildFinalPages(job, applyCleanup);
    // PDF pages have already made their whole-page decision. Do not apply a
    // document-wide scan/repair or run ZawCode normalization a second time.
    const eligible = (index) => !pageLocal && job.reports[index]?.category !== "UNKNOWN";
    const { pages: repairedPages, totals: repairTotals } = applyCleanup
      ? repairPages(finalPages, words, eligible)
      : { pages: finalPages, totals: { pages: 0, repairs: 0, splits: 0 } };
    const { report, scanLog, scanSummary, scanTotals } = isDraft || pageLocal
      ? { report: null, scanLog: null, scanSummary: [], scanTotals: null }
      : scanPathVerdict(repairedPages, outPath, chosenPath);
    const scanRepairedPages = isDraft || !applyCleanup ? repairedPages
      : repairFromScanVerdict(repairedPages, report, words, {
        path: chosenPath, standalone, preserveZawCodeOrder: chosenPath === "zawcode",
      });
    const orderedPages = !isDraft && applyCleanup && chosenPath === "zawcode" && report
      ? orderZawCodePages(scanRepairedPages, report, {
        path: chosenPath, normalize: await getEngineNormalize(),
      })
      : scanRepairedPages;
    const pages = orderedPages.map((page, index) => eligible(index) ? page : finalPages[index]);
    const scanRepairPages = pages.reduce(
      (n, page, i) => n + ((page?.text || "") !== (repairedPages[i]?.text || "") ? 1 : 0),
      0,
    );
    const scanRepaired = scanRepairPages
      ? { scanRepair: { path: chosenPath, pages: scanRepairPages } }
      : {};
    const repaired = repairTotals.repairs || repairTotals.splits ? { repair: repairTotals } : {};
    note(provenance, {
      detection: job.counts,
      output: outPath,
      ...(scanTotals ? { scan: { path: chosenPath, ...scanTotals } } : {}),
      ...repaired,
      ...scanRepaired,
    });
    const common = {
      filename: name ?? null,
      counts: job.counts,
      encodingPath: chosenPath,
      ...(scanLog ? { scanLog } : {}),
      ...(scanTotals ? { scanPath: chosenPath } : {}),
      ...(scanSummary?.length ? { scanSummary } : {}),
      ...(msg.includePreview ? { metadata: job.metadata ?? {}, changes: job.changes ?? [] } : {}),
      ...(job.imageFiles ? { imageFiles: job.imageFiles, imageDir } : {}),
      ...(job.linearizationError ? { linearizationWarning: job.linearizationError } : {}),
      ...(job.pageWarnings?.length ? { pageWarnings: job.pageWarnings } : {}),
      ...repaired,
      ...scanRepaired,
    };
    if (msg.deferOutput) {
      handedOffSource = true;
      return { ...common, deferredOutput: true, pagesData: pages, provenance,
        ...(job.internalPdf ? { internalPdf: job.internalPdf } : {}) };
    }
    const written = await writeOutput(outPath, pages, {
      counts: job.counts, source: name ?? "", includeText: msg.includeText === true,
    });
    appendRecord(provenance, { file: registerPath(REGISTER_LOG) });
    return { ...common, pages: pages.length, ...written };
    } finally {
      if (!handedOffSource && job.internalPdf?.dir) fs.rmSync(job.internalPdf.dir, { recursive: true, force: true });
    }
  };
}
