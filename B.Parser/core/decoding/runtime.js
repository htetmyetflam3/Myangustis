import { getEngineNormalize, getLogen } from "../../_path.js";
const { installPassiveLog } = (await getLogen()).siteLog;
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { processDocxForMethod, buildFinalPages } from "./source-decoding.js";
import { writeOutput } from "../io/write.js";
import { PosScanner } from "../beautify/scan.js";
import { PageStoreWriter } from "../io/emit.js";
import { repairTextWithPos, repairFromPosVerdict } from "../beautify/repair.js";
import { orderZawCodePages } from "../zawcode-order.js";
import { normalizeOutputText } from "./decide.js";
import { runPdfStream } from "../pdf/pdf-stream.js";

import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "../limits/local.js";
import { REGISTER_LOG } from "../../_path.js";
import { startRecord, note, appendRecord, registerPath } from "../provenance.js";






installPassiveLog({
  file: process.env.LOG_FILE || "",
  checks: /^(1|true|on|yes)$/i.test(String(process.env.LOG_CHECKS ?? "")),
});

async function beautifyPages(pages, eligible = () => true) {
  const totals = { pages: 0, repairs: 0, splits: 0 };
  const repairedPages = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const text = page?.text || "";
    if (!eligible(index) || !text) { repairedPages.push(page); continue; }
    const repaired = await repairTextWithPos(text);
    if (repaired.text === text) { repairedPages.push(page); continue; }
    totals.pages += 1;
    for (const item of repaired.repairs) totals.repairs += item.count;
    for (const item of repaired.splits || []) totals.splits += item.count;
    repairedPages.push({ ...page, text: repaired.text });
  }
  return { pages: repairedPages, totals };
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













export function createSourceRunner({ kind, docxImages = false, pdfImages = false }) {
  return async function runSource(msg = {}) {
    const {
      filename, data, inPath, outPath,
    } = msg;
    if (kind === "pdf") {
      // Default converter behavior for PDF: parse the text layer and
      // extract image pages for the separate OCR worker. The converter
      // never performs OCR itself and never re-embeds images.
      return runPdfStream(msg, {
        manual: false, pdfImages,
      });
    }
    let imageDir = null;
    const bytes = loadBytes({ inPath, data });
    const name = filename ?? (inPath ? path.basename(inPath) : null);



    const provenance = startRecord(name ?? inPath ?? "");
    const options = docxImages
      ? (imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-img-"))) && { imageDir, provenance }
      : { provenance };
    options.sourceEncoding = msg.sourceEncoding ?? "auto";
    let job;
    try {
      job = await processDocxForMethod(
        bytes,
        "default",
        name ?? null,
        () => {},
        options,
      );
    } catch (error) {
      if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true });
      throw error;
    }
    if (imageDir && !job.imageFiles?.length) {
      fs.rmSync(imageDir, { recursive: true, force: true });
      imageDir = null;
    }




    if (!outPath) return { result: job };

    try {
      const chosenPath = provenance?.codepage?.chosen ?? job.encodingPath ?? null;
      const isDraft = provenance?.codepage?.draft === true;
      const pageLocal = job.pageLocalDecoding === true;
      const applyCleanup = msg.applyCleanup !== false;
      const finalPages = buildFinalPages(job, applyCleanup);
      // Already-finalized PDF pages never run this document-wide repair path.
      const eligible = (index) => !pageLocal && job.reports[index]?.category !== "UNKNOWN";
      const { pages: repairedPages, totals: repairTotals } = applyCleanup && !isDraft && !pageLocal
        ? await beautifyPages(finalPages, eligible)
        : { pages: finalPages, totals: { pages: 0, repairs: 0, splits: 0 } };
      let scanRepairedPages = repairedPages;
      if (!isDraft && !pageLocal && applyCleanup && chosenPath === "zawcode") {
        scanRepairedPages = [];
        for (let index = 0; index < repairedPages.length; index += 1) {
          const page = repairedPages[index];
          const fixed = eligible(index)
            ? await repairFromPosVerdict([page], { path: chosenPath, preserveZawCodeOrder: true })
            : [page];
          scanRepairedPages.push(fixed[0]);
        }
      }
      const orderedPages = !isDraft && !pageLocal && applyCleanup && chosenPath === "zawcode"
        ? orderZawCodePages(scanRepairedPages, {}, { path: chosenPath })
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
        ...repaired,
        ...scanRepaired,
      });
      const common = {
        filename: name ?? null,
        counts: job.counts,
        encodingPath: chosenPath,
        ...(msg.includePreview ? { metadata: job.metadata ?? {}, changes: job.changes ?? [] } : {}),
        ...(job.imageFiles ? { imageFiles: job.imageFiles, imageDir } : {}),
        ...(job.linearizationError ? { linearizationWarning: job.linearizationError } : {}),
        ...(job.pageWarnings?.length ? { pageWarnings: job.pageWarnings } : {}),
        ...repaired,
        ...scanRepaired,
      };
      if (msg.deferImageOutput && job.imageFiles?.length) {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linga-docx-images-"));
        let store;
        try {
          store = new PageStoreWriter(directory, "source");
          for (const page of pages) store.addPage({ text: [page.text || ""] });
          store.close();
          return {
            ...common, pages: pages.length, deferredDocx: true,
            internalDocx: { directory, pageStore: store.store }, provenance,
          };
        } catch (error) {
          store?.close();
          fs.rmSync(directory, { recursive: true, force: true });
          if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true });
          throw error;
        }
      }
      const normalize = await getEngineNormalize();
      const outputPages = pages.map((page) => ({
        ...page, text: normalizeOutputText(page.text || "", normalize),
      }));
      const scanner = new PosScanner();
      try {
        // DOCX chunks contain 80 paragraphs each; they are not physical pages.
        for (const page of outputPages) await scanner.writePage(null, [page.text]);
        const written = await writeOutput(outPath, outputPages, {
          counts: job.counts, source: name ?? "", includeText: msg.includeText === true,
        });
        const posScan = await scanner.finish(written.file);
        appendRecord(provenance, { file: registerPath(REGISTER_LOG) });
        return { ...common, pages: pages.length, ...written, posScan };
      } finally {
        await scanner.close();
      }
    } catch (error) {
      if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true });
      throw error;
    }
  };
}
