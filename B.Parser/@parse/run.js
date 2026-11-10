/*
(parse) run: the parsing door at the top of @parse. Imports the two
decoding branches (pdf runtime/source, docx/source) and the shared
finishing (runtime/finish.js), and returns the parsed result:
one marked-up string per page, plus counts and reports.

Parsing ends here. Output writing is NOT called from parse: the
caller takes this result and hands it to requested.js (the output
wrapper) whenever - and however parallel - it chooses.
*/
import { streamPdfPages, collectPdfResult } from "./runtime/source.js";
import { processDocxBytes } from "./docx/source.js";
import { buildFinalPages } from "./runtime/finish.js";

export async function parseDecoding({ kind, source, filename = null, log = () => {} } = {}) {
  let job;
  if (kind === "pdf") {
    const reports = [];
    const [, npages, pageIter] = streamPdfPages(source, log, {});
    for await (const rep of pageIter) reports.push(rep);
    job = collectPdfResult(reports, npages, filename ?? "upload.pdf");
  } else if (kind === "docx") {
    job = await processDocxBytes(source, filename ?? "upload.docx", log, {});
  } else {
    throw new TypeError("parseDecoding: kind must be pdf or docx");
  }
  return {
    kind,
    filename: job.filename ?? filename,
    pages: buildFinalPages(job, true),
    counts: job.counts ?? {},
    reports: job.reports ?? [],
  };
}
