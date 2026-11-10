/*
(praised/decoding) run: the composer - next module after the split.
Imports the two decoding branches (pdf/source, docx/source), the
shared finishing (finish.js), and the output writing
(output/requested.js, the door over pdf/write + docx/write).
One function per kind: decode the landed input into finished
pages, then create the requested output file. It routes and
carries; decoding methods belong to the branches and judgement,
file shapes belong to the output writers.
*/
import { streamPdfPages, collectPdfResult } from "./pdf/source.js";
import { processDocxBytes, processDocxForMethod } from "./docx/source.js";
import { buildFinalPages } from "./finish.js";
import { writeOutputFile } from "./requested.js";

export { writeOutputFile };

// The whole middle in one call: decode by kind, lift the final
// pages, and create the requested output file (the conversion is
// the output door's dispatch: pdf->docx, docx->pdf, ->txt).
export async function runDecoding({ kind, source, filename = null, outPath, log = () => {} } = {}) {
  if (!outPath) throw new TypeError("runDecoding: outPath is required");
  let job;
  if (kind === "pdf") {
    const reports = [];
    let npages = 0;
    for await (const rep of streamPdfPages(source, log, {})) { reports.push(rep); npages += 1; }
    job = collectPdfResult(reports, npages, filename ?? "upload.pdf");
  } else if (kind === "docx") {
    job = await processDocxBytes(source, filename ?? "upload.docx", log, {});
  } else {
    throw new TypeError("runDecoding: kind must be pdf or docx");
  }
  const pages = buildFinalPages(job, true);
  const written = await writeOutputFile(pages, outPath, {
    source: filename ?? "", sourceKind: kind, counts: job.counts ?? {}, log,
  });
  return { job, written };
}
