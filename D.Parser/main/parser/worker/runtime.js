import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadDetector, processBytesForMethod, buildFinalPages, markPdfImagePages } from "../../../extend/pipeline.mjs";
import { writeOutput } from "../write/emit.mjs";
import { scanText, formatScanReport, loadScanDictionary, dictionaryWords } from "../text/scan.mjs";
import { repairText, repairFromScanVerdict } from "../text/repair.mjs";
import { emitEvent } from "../../../../Bridge/logen/core.js";
import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "../core/limits.mjs";
import { REGISTER_LOG } from "../core/paths.mjs";
import { startRecord, note, appendRecord, registerPath } from "../core/provenance.mjs";
import { installPassiveLog } from "../../../../Bridge/logen/site.js";

/* The praser runs in a worker thread, so the listener installed in index.js
   is in another thread and would never see these events. Worker stdout is
   the parent's stdout, so installing here puts the lines in the same place.
   Same switches, same default: off unless LOG_CHECKS/LOG_FILE say otherwise. */
installPassiveLog({
  file: process.env.LOG_FILE || "",
  checks: /^(1|true|on|yes)$/i.test(String(process.env.LOG_CHECKS ?? "")),
});

const scanLoggingEnabled = /^(1|true|yes|on)$/iu.test(String(process.env.PRASER_SCAN_LOGGING || ""));

/* One dictionary for the whole run: the ZawCode guard in the pipeline, the
   repair pass and the diagnostic scan arbitrate over the SAME word list
   (text/scan.mjs `loadScanDictionary` caches the load), or the report
   would describe text the writer never saw. */
function dictionaryOnce() {
  return loadScanDictionary() ?? {};
}

/**
 * Apply the dictionary-arbitrated repairs to finished page text.
 *
 * `text/repair.mjs` resolves the two confusions a code page cannot settle on
 * its own: a glyph shared between a letter and a digit (ဝ/၀, ရ/၇, ဉ/ဥ), and a
 * page number glued onto its heading once the dot leaders are gone. Each fires
 * only when the token is not a word and exactly one repaired variant is, so a
 * repair can neither invent a word nor choose between two readings.
 *
 * Returns the pages plus the tally, which belongs in the provenance record:
 * a changed word with no record of why is how a repair becomes a bug report.
 */
function repairPages(pages, words) {
  const totals = { pages: 0, repairs: 0, splits: 0 };
  if (!words || !words.size) return { pages, totals };
  const repairedPages = pages.map((page) => {
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

/* Where the scan verdict belongs: after parsing finishes, on the paths
   whose reading came from a chosen byte table -- wininnwa, ayar, and the
   vector auto-build ("vector:<base>") -- and on zawcode, the split of the
   Unicode/cmap win whose stored order the scan has to arbitrate and the
   behind-scan mend then repairs. NOT on zawgyi (Rabbit's output is
   judged by the conversion) and NOT on pure unicode (the document read
   as itself; a correct reading scans clean, so there is nothing to
   arbitrate and no repair rule to feed). Placement measured, not argued
   (.bin/node/path-scan.mjs): the structural scan rules rank the probe
   candidates exactly as mm-score does, so scan has nothing to add as a
   chooser; as the after-choice verdict its totals land in the
   provenance record beside the path that produced them. */
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
  // PRASER_SCAN_LOGGING only controls the on-disk report.
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
    // Authoring register: see core/provenance.mjs. Uploads record the same
    // facts as a terminal run -- the broken-document case that matters most
    // is the one that came in over the wire, where there is no stdout to read.
    const provenance = startRecord(name ?? inPath ?? "");
    const options = (docxImages || pdfImages)
      ? (imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-img-"))) && { imageDir, provenance }
      : { provenance };
    const job = await processBytesForMethod(
      bytes,
      kind,
      method,
      detectorOnce(),
      name ?? null,
      () => {},
      options,
    );

    // PDF image areas are rendered after extraction, because rendering is
    // async and the page walk is not. DOCX fills job.imageFiles during
    // extraction; from here on the two are the same shape.
    if (pdfImages && imageDir) job.imageFiles = await markPdfImagePages(bytes, job, imageDir);

    if (!outPath) return { result: job };

    // Repairs run on the finished text, immediately before the write. Then
    // the scan verdict on the chosen path (wininnwa/ayar/vector/zawcode),
    // then the behind-scan repair slot -- the scan-coordinate ZawCode mend
    // on that path, a pass-through elsewhere -- then the write. The scan
    // totals in the record are the verdict that located the damage; on
    // zawcode the mend runs after them by design.
    const dictData = dictionaryOnce();
    const words = dictionaryWords(dictData);
    const standalone = dictData?.mapData?.newClause?.standalone || [];
    const { pages: repairedPages, totals: repairTotals } = repairPages(
      buildFinalPages(job, true),
      words,
    );
    const chosenPath = provenance?.codepage?.chosen ?? null;
    const { report, scanLog, scanSummary, scanTotals } = scanPathVerdict(repairedPages, outPath, chosenPath);
    const pages = repairFromScanVerdict(repairedPages, report, words, { path: chosenPath, standalone });
    const scanRepairPages = pages.reduce(
      (n, page, i) => n + ((page?.text || "") !== (repairedPages[i]?.text || "") ? 1 : 0),
      0,
    );
    const scanRepaired = scanRepairPages
      ? { scanRepair: { path: chosenPath, pages: scanRepairPages } }
      : {};
    const written = await writeOutput(outPath, pages, { counts: job.counts, source: name ?? "" });
    const repaired = repairTotals.repairs || repairTotals.splits ? { repair: repairTotals } : {};
    note(provenance, {
      detection: job.counts,
      output: outPath,
      ...(scanTotals ? { scan: { path: chosenPath, ...scanTotals } } : {}),
      ...repaired,
      ...scanRepaired,
    });
    appendRecord(provenance, { file: registerPath(REGISTER_LOG) });

    return {
      filename: name ?? null,
      pages: pages.length,
      counts: job.counts,
      // The six-path verdict, always surfaced for the caller policy layer.
      encodingPath: chosenPath,
      ...(scanLog ? { scanLog } : {}),
      ...(scanTotals ? { scanPath: chosenPath } : {}),
      ...(scanSummary?.length ? { scanSummary } : {}),
      ...(job.imageFiles ? { imageFiles: job.imageFiles, imageDir } : {}),
      ...repaired,
      ...scanRepaired,
      ...written,
    };
  };
}
