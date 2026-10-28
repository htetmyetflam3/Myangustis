#!/usr/bin/env node






































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
const REPO = path.resolve(HERE, "..", "..");
const PARSER_FRONT_DOOR = url.pathToFileURL(
  path.join(REPO, "D.Parser", "main", "parser", "index.js"),
).href;


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


    v.category = "old";
    v.reason = result.reason ?? "legacy-font-not-convertible";
    return v;
  }
  if (result.lane === "ocr") {
    v.category = "convertable";
    v.outputFile = result.file ?? null;
    v.reason = "ocr";
    return v;
  }
  if (!result.file || !v.textChars) {

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


    if (ocr && verdict.category === "scanned") {
      const ocrStarted = Date.now();
      try {
        const ocrResult = await manager.dispatch(
          { ...job, job: "ocr", method: "default" },
          "scraper",
        );
        const ocrVerdict = mapResult(input, ocrResult, ocrStarted);
        ocrVerdict.encoding = null;
        ocrVerdict.reason = "ocr";
        return ocrVerdict;
      } catch (error) {

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


    fs.writeFileSync(args.outFile, JSON.stringify(verdicts, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    for (const v of verdicts) {
      console.error(`[parse-bridge] ${v.filename} -> ${v.category} (${v.reason ?? ""})`);
    }

    process.exit(0);
  } finally {
    await manager.close().catch(() => {});
  }
}

const isMain = process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href;
if (isMain) main();
