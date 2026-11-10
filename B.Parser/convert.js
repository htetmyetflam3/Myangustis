/*
The ONE door of B.Parser. This is the only file a caller needs.

  convert(input, outputPath) -> { file, from, to, pages, counts, ... }

    input      a file path (string), or { path }, or { bytes, filename }
               (bytes = Buffer / Uint8Array / async byte stream)
    outputPath where the result lands; the extension (.pdf / .docx / .txt)
               chooses the output format

What happens inside, in order (each stage already exists; this file
only wires them - it contains no parsing logic of its own):

  1. InitInput      (@entry/init.js)     take the file in, check size,
                                         land it as a temp file, prepare
                                         it (qpdf for PDF, unzip-check
                                         for DOCX)
  2. parseDecoding  (prised/@core/run.js)      read the prepared file and
                                         return one marked-up string
                                         per page (headings, bold,
                                         italic, paragraph breaks)
  3. writeOutputFile(prised/@core/requested.js) render those pages to the
                                         requested .pdf / .docx / .txt

OCR inputs are prepared by stage 1 but not yet converted here; they
fail loudly instead of silently producing nothing.
*/
import { InitInput } from "./@entry/init.js";
import { parseDecoding } from "./prised/@core/run.js";
import { writeOutputFile } from "./prised/@core/requested.js";

// One conversion at a time through this door: callers queue, a second
// conversion never runs beside the first (single-worker guard).
let conversionTail = Promise.resolve();
function acquireConversionSlot() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const acquired = conversionTail.then(() => release);
  conversionTail = conversionTail.then(() => gate);
  return acquired;
}

export async function convert(input, outputPath, options = {}) {
  const release = await acquireConversionSlot();
  try {
    return await convertSerialised(input, outputPath, options);
  } finally {
    release();
  }
}

async function convertSerialised(input, outputPath, { caller = "owner", log = () => {} } = {}) {
  if (!outputPath || typeof outputPath !== "string") {
    throw new TypeError("convert: outputPath is required (its extension picks pdf/docx/txt)");
  }

  // Normalise the three accepted input shapes into an InitInput trigger.
  let trigger;
  if (typeof input === "string") trigger = { path: input };
  else if (input && typeof input.path === "string") trigger = { path: input.path, filename: input.filename ?? null };
  else if (input && input.bytes !== undefined) trigger = { object: input.bytes, filename: input.filename ?? null };
  else if (input && input.object !== undefined) trigger = { object: input.object, filename: input.filename ?? null };
  else throw new TypeError("convert: input must be a path string, { path }, or { bytes, filename }");

  // 1) take in + prepare
  const prepared = await InitInput(trigger, caller);
  const filename = prepared.metadata?.filename ?? trigger.filename ?? "upload";

  // 2) parse -> marked-up page strings
  let parsed;
  if (prepared.kind === "pdf") {
    parsed = await parseDecoding({ kind: "pdf", source: prepared.path, filename, log });
  } else if (prepared.kind === "ocr") {
    parsed = await parseDecoding({ kind: "ocr", source: prepared.path, filename, log });
  } else if (prepared.kind === "docx") {
    parsed = await parseDecoding({ kind: "docx", source: prepared.path, filename, log });
  } else {
    throw new Error(`convert: "${prepared.kind}" input is prepared but conversion is not wired for it yet`);
  }

  // 3) write the requested file (only after parsing has finished)
  const written = await writeOutputFile(parsed.pages, outputPath, {
    source: parsed.filename,
    sourceKind: parsed.kind,
    counts: parsed.counts,
    log,
  });

  return { ...written, counts: parsed.counts };
}
