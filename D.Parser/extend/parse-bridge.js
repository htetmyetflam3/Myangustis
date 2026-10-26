#!/usr/bin/env node
// Scraper -> Parser integration plugin.
//
// This is the scraper-side half of the bridge. The Parser Manager is the
// other half and owns the ONLY policy decision (parser/caller-policy.mjs):
//
//     scraper caller  ->  Unicode / ZawCode parse, OCR, or old-font SKIP.
//
// This file holds none of that logic. It is the process/IO adapter the
// Python crawler shells (the same transport as support/segment_bridge.mjs):
// one Node process for a batch, cross-module dynamic import, JSON verdict out.
// It translates the Manager's generic result into the three-category
// vocabulary the scraper pipeline already understands (pdf_classify.py):
//
//     convertable  Unicode or Zawgyi-One text; outputFile holds the .txt
//     scanned      image-only document, no text layer; PDF preserved as-is
//     old          pre-standard/legacy font the scraper must not parse;
//                  the Manager returned { skipped:true }, PDF preserved as-is
//
// Usage:
//   node parse-bridge.mjs --out RESULT.json [--ocr] PDF [PDF ...]
//
//   --out FILE  REQUIRED. The JSON verdict array is written here. Results go
//               to a FILE, never stdout: the Parser logs through console.log
//               (Bridge/logen), including from worker threads, so stdout is
//               reserved for diagnostics — the same contract segment_bridge.mjs
//               established. The crawler reads FILE after a clean exit.
//   --ocr       route a scanned document through the Manager's OCR lane
//               instead of reporting it as 'scanned'. Off by default: the
//               crawler's standing behaviour is to preserve scans as PDFs.
//
// Exit codes: 0 every input reached a terminal verdict (old/scanned included);
//             2 bad usage; 1 the Parser could not be loaded at all. A single
//             document failing never aborts the batch — it becomes an
//             { category:'error' } verdict so the crawler can keep going.
//
// Runtime: Node 22+. The Parser's heavy libraries (pdfjs, canvas, tesseract)
// resolve from Parser/main/parser and are loaded lazily by the Manager; this
// adapter itself has no dependencies.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const NODE_MAJOR = Number(process.versions.node.split(".", 1)[0]);
if (NODE_MAJOR < 22) {
  console.error(
    `[parse-bridge] Node.js 22+ required; found ${process.version} at ${process.execPath}.`,
  );
  process.exit(1);
}

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", ".."); // Scraper/plugin -> repository root
const PARSER_FRONT_DOOR = url.pathToFileURL(
  path.join(REPO, "Parser", "main", "parser", "index.mjs"),
).href;

// Manager encoding path -> the scraper's historical encoding label.
const ENCODING_LABEL = { unicode: "unicode", zawcode: "zawgyi-one" };

function parseArgs(argv) {
  const files = [];
  let outFile = null;
  let ocr = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ocr") {
      ocr = true;
    } else if (arg === "--out") {
      if (i + 1 >= argv.length) throw new Error("--out requires a file path");
      outFile = argv[(i += 1)];
    } else if (arg.startsWith("--out=")) {
      outFile = arg.slice("--out=".length);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}`);
    } else {
      files.push(arg);
    }
  }
  return { files, outFile, ocr };
}

function baseVerdict(input) {
  return {
    input,
    filename: path.basename(input),
    category: null,
    encoding: null,
    encodingPath: null,
    reason: null,
    pages: 0,
    textChars: 0,
    textBytes: 0,
    lineCount: 0,
    outputFile: null,
    counts: null,
    ms: 0,
  };
}

// One Manager result -> one scraper verdict. Pure mapping; no re-decision.
function mapResult(input, result, startedAt) {
  const v = baseVerdict(input);
  v.ms = Date.now() - startedAt;
  v.encodingPath = result.encodingPath ?? null;
  v.encoding = ENCODING_LABEL[v.encodingPath] ?? null;
  v.pages = result.pages ?? 0;
  v.textChars = result.textChars ?? 0;
  v.textBytes = result.textBytes ?? 0;
  v.lineCount = result.lineCount ?? 0;
  v.counts = result.counts ?? null;

  if (result.skipped === true) {
    // The Manager's scraper policy refused an old-font document. This is a
    // normal terminal verdict, not an error: the crawler keeps the PDF.
    v.category = "old";
    v.reason = result.reason ?? "legacy-font-not-convertible";
    return v;
  }
  if (result.lane === "ocr") {
    v.category = "convertable"; // OCR produced text for a scan
    v.outputFile = result.file ?? null;
    v.reason = "ocr";
    return v;
  }
  if (!result.file || !v.textChars) {
    // Extraction ran but yielded no readable text: image-only -> preserve.
    v.category = "scanned";
    v.reason = "no-text-layer";
    return v;
  }
  v.category = "convertable";
  v.outputFile = result.file;
  v.reason = result.encodingPath ?? "text-layer";
  return v;
}

async function classifyOne(manager, input, { ocr }) {
  const startedAt = Date.now();
  const inputKind = input.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
  const job = {
    job: "extracting",
    method: "default",
    output: "txt",
    inPath: path.resolve(input),
    filename: path.basename(input),
    inputKind,
  };
  try {
    const result = await manager.dispatch(job, "scraper");
    const verdict = mapResult(input, result, startedAt);

    // Optional OCR round for an otherwise scanned document.
    if (ocr && verdict.category === "scanned") {
      const ocrStarted = Date.now();
      try {
        const ocrResult = await manager.dispatch(
          { ...job, job: "ocr", method: "default" },
          "scraper",
        );
        const ocrVerdict = mapResult(input, ocrResult, ocrStarted);
        ocrVerdict.encoding = null; // OCR output is Unicode by construction
        ocrVerdict.reason = "ocr";
        return ocrVerdict;
      } catch (error) {
        // A missing tesseract model must degrade to the scan verdict, not fail.
        verdict.reason = `scanned (ocr unavailable: ${error?.message ?? error})`;
      }
    }
    return verdict;
  } catch (error) {
    return { ...baseVerdict(input), category: "error", reason: error?.message ?? String(error), ms: Date.now() - startedAt };
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[parse-bridge] ${error.message}`);
    process.exit(2);
  }
  if (!args.outFile || !args.files.length) {
    console.error("usage: node parse-bridge.mjs --out RESULT.json [--ocr] PDF [PDF ...]");
    process.exit(2);
  }

  let Manager;
  try {
    ({ Manager } = await import(PARSER_FRONT_DOOR));
  } catch (error) {
    console.error(`[parse-bridge] cannot load Parser front door at ${PARSER_FRONT_DOOR}: ${error.message}`);
    process.exit(1);
  }

  const manager = new Manager();
  try {
    const verdicts = [];
    for (const file of args.files) {
      verdicts.push(await classifyOne(manager, file, { ocr: args.ocr }));
    }
    // Result JSON always lands in a file: stdout/stderr stay diagnostic because
    // the Parser's logger (and its worker threads) write through console.log.
    fs.writeFileSync(args.outFile, JSON.stringify(verdicts, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    for (const v of verdicts) {
      console.error(`[parse-bridge] ${v.filename} -> ${v.category} (${v.reason ?? ""})`);
    }
    // old/scanned are successful terminal classifications: always exit 0.
    process.exit(0);
  } finally {
    await manager.close().catch(() => {});
  }
}

const isMain = process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href;
if (isMain) main();
