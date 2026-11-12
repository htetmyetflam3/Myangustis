/*
(integration/host) Site host parser entry — compatibility shim.

The host (B.Parser/host) was written against `integration/host/init.js`
(see SEPARATION.md §2/§4). The current converter lives behind
`B.Parser/index.js` (`convert` / `InitInput` / `parseDecoding` /
`writeOutputFile`). This shim bridges the old host contract to the
current converter so the host imports resolve without rewriting the
host:

  createPdfParser() / createDocxParser() -> { parse, bindIdentity }
  parse(filePath, out, options) -> text string; fills out.manager
  closePraserManager() -> no-op (the converter is stateless)

`parse` mirrors `convert.js`: InitInput prepares the file, parseDecoding
parses it, writeOutputFile writes the requested artifact inside the
site output dir (so `/api/submit/file/:submitId` can serve it), and
`out.manager` carries the artifact facts the queue records.
*/
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { InitInput } from "../../@entry/init.js";
import { parseDecoding } from "../../prised/@core/run.js";
import { writeOutputFile } from "../../prised/@core/requested.js";
import { stripMarkup } from "../../architecture/@output/helper/markup.js";
import { SITE_OUTPUT_DIR } from "../../public/_path.js";

const MIME_BY_EXT = {
  txt: "text/plain; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

function outputExtOf(options) {
  const ext = options?.trigger?.output
    ?? options?.intent?.outputFormat
    ?? options?.intent?.desired
    ?? "txt";
  const clean = String(ext).toLowerCase().replace(/^\./, "");
  return ["txt", "docx", "pdf"].includes(clean) ? clean : "txt";
}

function kindOf(filePath, options) {
  const ext = path.extname(String(filePath || "")).toLowerCase().replace(/^\./, "");
  if (ext === "pdf" || ext === "docx") return ext;
  const inputFormat = String(options?.intent?.inputFormat || "").toLowerCase();
  if (inputFormat === "pdf" || inputFormat === "docx") return inputFormat;
  return ext || "pdf";
}

async function parseWithConverter(filePath, out, options = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new TypeError("parse: file path is required");
  }
  const kind = kindOf(filePath, options);
  const to = outputExtOf(options);
  const filename = options?.intent?.originalName
    ?? options?.intent?.uploadName
    ?? path.basename(filePath);

  // Stage 1+2: prepare + parse (same order as convert.js).
  const prepared = await InitInput({ path: filePath }, "site");
  const preparedKind = prepared.kind === "ocr" ? "ocr" : kind;
  const parsed = await parseDecoding({
    kind: preparedKind,
    source: prepared.path ?? filePath,
    filename,
    log: options?.log ?? (() => {}),
  });

  // Stage 3: write the requested artifact inside the site output dir.
  const stem = path.parse(filename).name || "result";
  const safeStem = stem.replace(/[\\x00-\\x1f<>:\"/\\\\|?*]/g, "_") || "result";
  const outName = `${crypto.randomUUID()}__${safeStem}.${to}`;
  const outPath = path.join(SITE_OUTPUT_DIR, outName);
  fs.mkdirSync(SITE_OUTPUT_DIR, { recursive: true, mode: 0o700 });
  const written = await writeOutputFile(parsed.pages, outPath, {
    source: parsed.filename ?? filename,
    sourceKind: parsed.kind,
    counts: parsed.counts,
    log: options?.log ?? (() => {}),
  });

  const plainText = (parsed.pages ?? [])
    .map((p) => stripMarkup(typeof p === "string" ? p : (p?.text ?? "")))
    .join("\n");
  const lineCount = plainText ? plainText.split(/\r\n|\r|\n/).length : 0;

  if (out && typeof out === "object") {
    out.manager = {
      file: written.file,
      filename: path.basename(written.file),
      output: written.to,
      mimeType: written.mimeType ?? MIME_BY_EXT[written.to] ?? "application/octet-stream",
      lineCount,
      textChars: written.textChars ?? plainText.length,
      textBytes: Buffer.byteLength(plainText, "utf8"),
      pages: written.pages ?? (parsed.pages ?? []).length,
      counts: parsed.counts ?? {},
    };
  }
  return plainText;
}

function createParser(kind) {
  return {
    async parse(filePath, out = null, options = {}) {
      // `out` is the queue handoff object ({}); `options` carries
      // { intent, savedPath, executionTask, trigger } from runManager.
      return parseWithConverter(filePath, out, { ...options, intent: options?.intent ?? {} });
    },
    async bindIdentity() {
      // The current converter holds no per-file identity state.
      return undefined;
    },
  };
}

export function createPdfParser() {
  return createParser("pdf");
}

export function createDocxParser() {
  return createParser("docx");
}

export async function closePraserManager() {
  // Stateless converter: nothing to close.
  return undefined;
}
