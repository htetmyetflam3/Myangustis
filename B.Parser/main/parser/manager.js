import { Worker } from "node:worker_threads";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { DEFAULT_OUTPUT_DIR, REGISTER_LOG, getOwnerKeyMatcher } from "../../_path.js";
import { writeOutput } from "./write/emit.js";
import { appendRecord, note, registerPath } from "./core/provenance.js";
import {
  WORKER_HEAP_MB,
  WORKER_TIMEOUT_MS,
  MAX_OCR_PAGES,
  MAX_INPUT_BYTES,
  MAX_INPUT_MB,
  ocrTimeoutMs,
} from "./core/limits.js";
import { decideForCaller, normalizeCaller } from "../../extend/caller-policy.js";
import { classifyScraperSource } from "./codepage/classify.js";

const EXTRACT_URL = new URL("./worker/extract.entry.js", import.meta.url);
const OCR_URL = new URL("./worker/ocr.entry.js", import.meta.url);

const OUTPUT_TYPES = new Set(["txt", "docx", "pdf"]);
const JOBS = new Set(["extracting", "ocr", "null"]);
const METHODS = new Set(["default", "manual", "null"]);
const SOURCE_ENCODINGS = new Set(["auto", "unicode", "zawgyi-one"]);
const keyMatches = await getOwnerKeyMatcher();

// Credentials are passed separately from jobs, never to a worker or into metadata.
function ownerAccess(options) {
  const key = options?.ownerKey;
  if (key === undefined || key === null) return false;
  if (!keyMatches(key)) throw new Error("Invalid owner key");
  return true;
}

const IDENTITY_FIELDS = [
  "jobToken", "formId", "submitId", "userId", "sessionId", "extension", "task",
];

function echoMeta(job) {
  const identity = {};
  for (const field of IDENTITY_FIELDS) {
    if (job?.[field] !== undefined) identity[field] = job[field];
  }
  return { ...identity, ...(job?.meta && typeof job.meta === "object" ? job.meta : {}) };
}

function errorFromWorker(lane, payload) {
  if (!payload || typeof payload === "string") {
    return new Error(payload || `${lane} worker failed`);
  }
  const error = new Error(payload.message || `${lane} worker failed`);
  if (payload.name) error.name = String(payload.name);



  if (payload.stack) error.stack = String(payload.stack);
  return error;
}


function inferInputKind(job) {
  if (job?.inputKind) return String(job.inputKind).toLowerCase();
  const name = job?.filename || (job?.inPath ? path.basename(job.inPath) : "");
  return String(name).toLowerCase().endsWith(".docx") ? "docx" : "pdf";
}


async function countOcrPages(job) {
  try {
    const { pdfPageCount } = await import("./read/ocr.js");
    const bytes = job.data ?? (job.inPath ? await (await import("node:fs/promises")).readFile(job.inPath) : null);
    if (!bytes) return 0;
    return (await pdfPageCount(bytes)) || 0;
  } catch {
    return 0;
  }
}

export function readManagerPayload(job) {
  const jobField = String(job?.job ?? "").toLowerCase();
  const method = String(job?.method ?? "default").toLowerCase();
  const output = String(job?.output ?? job?.outputType ?? "txt").toLowerCase().replace(/^\./, "");

  if (!JOBS.has(jobField)) {
    throw new Error(`Unsupported job: ${JSON.stringify(job?.job)} (use ${[...JOBS].join("/")})`);
  }
  if (!METHODS.has(method)) {
    throw new Error(`Unsupported method: ${JSON.stringify(job?.method)} (use ${[...METHODS].join("/")})`);
  }
  if (!OUTPUT_TYPES.has(output)) {
    throw new Error(`Unsupported output type: ${JSON.stringify(job?.output)} (use txt/docx/pdf)`);
  }
  if (jobField === "ocr" && method !== "default") {

    throw new Error(`job:"ocr" only accepts method:"default" (got ${JSON.stringify(method)})`);
  }
  if (method === "null" && inferInputKind(job) !== "docx") {

    throw new Error('method:"null" is DOCX-only (no PDF path emits it)');
  }
  if (job?.applyCleanup !== undefined && typeof job.applyCleanup !== "boolean") {
    throw new TypeError("applyCleanup must be a boolean");
  }
  if (job?.sourceEncoding !== undefined && !SOURCE_ENCODINGS.has(job.sourceEncoding)) {
    throw new Error('sourceEncoding must be "auto", "unicode", or "zawgyi-one"');
  }

  return { job: jobField, method, output };
}





export function route(job) {
  return readManagerPayload(job).job === "ocr" ? "ocr" : "extract";
}


export function resolveOutput(job) {
  return readManagerPayload(job).output;
}

export class Manager {
  #workers = { extract: null, ocr: null, ownerExtract: null, ownerOcr: null };
  #pending = new Map();
  #laneTails = { extract: Promise.resolve(), ocr: Promise.resolve() };
  #seq = 0;

  constructor({ outputDir = DEFAULT_OUTPUT_DIR } = {}) {
    this.outputDir = outputDir;
  }

  #workerSlot(lane, owner) {
    return owner ? (lane === "ocr" ? "ownerOcr" : "ownerExtract") : lane;
  }

  #failLane(slot, error, worker) {
    if (this.#workers[slot] !== worker) return;
    this.#workers[slot] = null;
    for (const [id, entry] of this.#pending) {
      if (entry.slot !== slot) continue;
      clearTimeout(entry.timer);
      this.#pending.delete(id);
      entry.reject(error);
    }
  }

  #worker(lane, owner) {
    const slot = this.#workerSlot(lane, owner);
    if (this.#workers[slot]) return this.#workers[slot];
    const url = lane === "ocr" ? OCR_URL : EXTRACT_URL;
    const options = {
      workerData: { parserOwner: owner },
      // The root loader may read .env again in the worker. Nonempty sentinels
      // prevent it from importing either stored credential into that worker.
      env: { ...process.env, CURL_KEY: "__parser_worker_disabled__", CURL_KEY_SHA256: "__parser_worker_disabled__" },
    };
    if (!owner) {
      options.resourceLimits = { maxOldGenerationSizeMb: WORKER_HEAP_MB, stackSizeMb: 8 };
    }
    const worker = new Worker(url, options);
    worker.on("message", (m) => {
      const entry = this.#pending.get(m.id);
      if (!entry || entry.slot !== slot) return;
      this.#pending.delete(m.id);
      clearTimeout(entry.timer);
      if (m.ok) entry.resolve(m);
      else entry.reject(errorFromWorker(lane, m.error));
    });
    worker.on("error", (error) => this.#failLane(slot, error, worker));
    worker.on("exit", (code) => {
      this.#failLane(slot, new Error(`${lane} worker exited (${code})`), worker);
    });
    this.#workers[slot] = worker;
    return worker;
  }

  #submit(lane, payload, budget, owner) {
    const slot = this.#workerSlot(lane, owner);
    const worker = this.#worker(lane, owner);
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      const timer = owner ? null : setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${lane} worker exceeded ${budget} ms`));
        if (this.#workers[slot] === worker) this.#workers[slot] = null;
        worker.terminate().catch(() => {});
      }, budget);
      timer?.unref();
      this.#pending.set(id, { resolve, reject, slot, timer });
      try {
        worker.postMessage({ ...payload, id });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  #outPathFor(job, out) {
    if (job.outPath) return job.outPath;



    return path.join(this.outputDir, `${crypto.randomUUID()}.${out}`);
  }


  // Owner calls use dispatch(job, caller, { ownerKey }); an option flag alone
  // never changes the public limits. The key is checked for every call.
  async dispatch(job, caller = "site", options = {}) {
    const owner = ownerAccess(options);
    const who = normalizeCaller(caller);
    const { job: jobField, method } = readManagerPayload(job);
    const lane = route(job);
    const out = resolveOutput(job);
    const meta = echoMeta(job);
    const inputKind = inferInputKind(job);
    const manualPdf = lane === "extract" && jobField === "extracting"
      && method === "manual" && inputKind === "pdf";
    const fileInfo = {
      filename: job.filename ?? null,
      inputKind,
      output: out,
      method,
      lane,
    };




    if (who === "scraper" && lane === "extract" && inputKind === "pdf") {
      const source = job.data ?? (job.inPath ? job.inPath : null);
      if (source) {
        const verdict = await classifyScraperSource(source, inputKind);
        const decision = decideForCaller(who, { encodingPath: verdict.encodingPath, lane });
        if (decision.action === "skip") {
          return {
            skipped: true,
            action: "skip",
            caller: who,
            reason: decision.reason,
            encodingPath: decision.encodingPath ?? verdict.encodingPath ?? null,

            file: null,
            pages: 0,
            counts: null,
            lineCount: 0,
            textChars: 0,
            textBytes: 0,
            mimeType: null,
            ...fileInfo,
            ...meta,
          };
        }
      }
    }

    const previous = this.#laneTails[lane];
    let releaseLane;
    const laneDone = new Promise((resolve) => { releaseLane = resolve; });
    this.#laneTails[lane] = previous.catch(() => {}).then(() => laneDone);
    await previous.catch(() => {});

    try {
      const outPath = this.#outPathFor(job, out);
      const payload =
        lane === "ocr"
          ? { op: "ocr", inPath: job.inPath, data: job.data, source: job.filename, outPath,
              includeText: job.includeText === true }
          : {
              op: "extract",
              method,
              kind: inputKind,
              filename: job.filename,
              inPath: job.inPath,
              data: job.data,
              outPath,
              applyCleanup: job.applyCleanup,
              sourceEncoding: job.sourceEncoding,
              includeText: job.includeText === true,
              includePreview: job.includePreview === true,
              ...(manualPdf ? { deferOutput: true } : {}),
            };

      let budget = WORKER_TIMEOUT_MS;
      if (lane === "ocr" && !owner) {
        const pages = await countOcrPages(job);
        if (pages > MAX_OCR_PAGES) {
          throw new Error(
            `Scanned PDF has ${pages} pages; the OCR lane accepts at most ${MAX_OCR_PAGES} at a time`,
          );
        }
        budget = ocrTimeoutMs(pages);
      }
      let reply = await this.#submit(lane, payload, budget, owner);

      if (manualPdf) reply = await this.#finishManualPdf(reply, job, outPath, owner);

      if (jobField === "null" && Array.isArray(reply.imageFiles) && reply.imageFiles.length) {
        try {
          const ocr = (await this.#dispatchOcr({ op: "ocr-images", files: reply.imageFiles }, reply.imageFiles.length, owner)) ?? [];
          let text = await fs.readFile(reply.file, "utf8");
          for (const item of ocr) {
            const marker = `[[IMAGE_${item.id}]]`;
            text = text.split(marker).join(item.text || "");
          }
          await fs.writeFile(reply.file, text, { encoding: "utf8", mode: 0o600 });
        } finally {
          if (reply.imageDir) await fs.rm(reply.imageDir, { recursive: true, force: true });
        }
      }

      const result = {
        skipped: false,
        action: "parse",
        caller: who,
        file: reply.file,
        filename: job.filename ?? reply.filename ?? null,
        output: out,
        method,
        lane,

        encodingPath: reply.encodingPath ?? reply.scanPath ?? null,
        pages: reply.pages,
        counts: reply.counts,
        lineCount: reply.lineCount,
        textChars: reply.textChars,
        textBytes: reply.textBytes,
        mimeType: reply.mimeType,
        ...(reply.scanLog ? { scanLog: reply.scanLog } : {}),
        ...(reply.scanPath ? { scanPath: reply.scanPath } : {}),
        ...(reply.scanSummary?.length ? { scanSummary: reply.scanSummary } : {}),
        ...(reply.linearizationWarning ? { linearizationWarning: reply.linearizationWarning } : {}),
        ...(Array.isArray(reply.pageWarnings) ? { pageWarnings: reply.pageWarnings } : {}),
        ...(Array.isArray(reply.ocrPages) ? { ocrPages: reply.ocrPages } : {}),
        ...(job.includePreview ? { metadata: reply.metadata ?? {}, changes: reply.changes ?? [] } : {}),

        ...meta,
      };
      if (typeof reply.text === "string") result.text = reply.text;
      return result;
    } finally {
      releaseLane();
    }
  }

  async #finishManualPdf(reply, job, outPath, owner) {
    try {
      if (!reply.deferredOutput || !Array.isArray(reply.pagesData)) {
        throw new Error("Manual PDF extraction did not return page data");
      }
      const pages = reply.pagesData;
      const tasks = [];
      const sourcePath = reply.internalPdf?.path || job.inPath;
      const sourceData = sourcePath ? undefined : job.data;
      let source;
      let pageHasRasterImage;
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        const images = Array.isArray(page?.images) ? page.images : [];
        const wholePage = images.find((image) => image.pageSized);
        if (wholePage) {
          // A scanner footer must not prevent OCR of an almost-page-sized image.
          tasks.push({ index, type: "ocrPage", fullPage: true });
          continue;
        }
        if (images.length) {
          for (const image of images) tasks.push({ index, type: "ocrRegion", bbox: image.bbox, fullPage: false });
          continue;
        }
        if (String(page?.text ?? "").trim()) continue;
        let hasImage = Boolean(page?.hasImg);
        if (!hasImage) {
          if (!pageHasRasterImage) {
            ({ pageHasRasterImage } = await import("./read/pdf-render.js"));
            source = sourcePath ? await fs.readFile(sourcePath) : sourceData;
            if (!source) throw new Error("Manual PDF input is missing");
          }
          hasImage = await pageHasRasterImage(source, index + 1);
        }
        if (hasImage) tasks.push({ index, type: "ocrPage", fullPage: true });
      }
      const scanned = [...new Set(tasks.map((task) => task.index))];
      if (!owner && scanned.length > MAX_OCR_PAGES) {
        throw new Error(`PDF has ${scanned.length} image pages; the OCR lane accepts at most ${MAX_OCR_PAGES} at a time`);
      }
      for (const task of tasks) {
        const text = await this.#dispatchOcr({
          type: task.type, inPath: sourcePath, data: sourceData,
          pageNumber: task.index + 1, ...(task.bbox ? { bbox: task.bbox } : {}),
        }, 1, owner);
        if (typeof text !== "string") throw new Error(`OCR did not return text for page ${task.index + 1}`);
        const page = pages[task.index];
        const existing = String(page?.text ?? "");
        const seen = new Set(existing.split("\n").map((line) => line.trim().replace(/\s+/gu, " ")).filter(Boolean));
        const extra = text.split("\n").filter((line) => {
          const normalized = line.trim().replace(/\s+/gu, " ");
          return normalized && !seen.has(normalized);
        }).join("\n");
        if (extra) {
          const merged = task.fullPage ? [extra, existing] : [existing, extra];
          pages[task.index] = { ...page, text: merged.filter((part) => part.trim()).join("\n"), lines: [], hasImg: true };
        }
      }
      const written = await writeOutput(outPath, pages, {
        counts: reply.counts, source: job.filename ?? reply.filename ?? "",
        includeText: job.includeText === true, owner,
      });
      const ocrPages = scanned.map((index) => index + 1);
      note(reply.provenance, { ocr: { pages: ocrPages } });
      appendRecord(reply.provenance, { file: registerPath(REGISTER_LOG) });
      return { ...reply, ...written, pages: pages.length, ocrPages };
    } finally {
      if (reply.internalPdf?.dir) await fs.rm(reply.internalPdf.dir, { recursive: true, force: true });
    }
  }

  async #dispatchOcr(payload, count, owner) {
    const lane = "ocr";
    const previous = this.#laneTails[lane];
    let releaseLane;
    const laneDone = new Promise((resolve) => { releaseLane = resolve; });
    this.#laneTails[lane] = previous.catch(() => {}).then(() => laneDone);
    await previous.catch(() => {});
    try {
      const reply = await this.#submit(lane, payload, ocrTimeoutMs(count), owner);
      return reply.result;
    } finally {
      releaseLane();
    }
  }

  async dispatchImages(files, options = {}) {
    const owner = ownerAccess(options);
    if (!Array.isArray(files) || files.length === 0) return [];
    return (await this.#dispatchOcr({ op: "ocr-images", files }, files.length, owner)) ?? [];
  }

  async startOcr(options = {}) {
    return this.#dispatchOcr({ type: "init" }, 1, ownerAccess(options));
  }

  async dispatchOcrImageDetailed(data, options = {}) {
    const owner = ownerAccess(options);
    if (!(data instanceof Uint8Array) || (!owner && data.byteLength > MAX_INPUT_BYTES)) {
      throw new Error(`OCR image must be bytes within the ${MAX_INPUT_MB} MB cap`);
    }
    return this.#dispatchOcr({ type: "ocrImageDetailed", data }, 1, owner);
  }

  // Formatting existing text does not recover a lost font or encoding.
  async renderPlainText({ inPath, outPath }, options = {}) {
    const owner = ownerAccess(options);
    if (!inPath || !outPath || path.extname(outPath).toLowerCase() !== ".docx") {
      throw new Error("Plain text rendering requires an input file and a .docx output path");
    }
    const info = await fs.stat(inPath);
    if (!owner && info.size > MAX_INPUT_BYTES) throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    const bytes = await fs.readFile(inPath);
    if (!owner && bytes.byteLength > MAX_INPUT_BYTES) throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return writeOutput(outPath, [{ text }], { source: path.basename(inPath), owner });
  }

  async run(jobs, caller = "site", options = {}) {
    const out = [];
    for (const job of jobs) out.push(await this.dispatch(job, caller, options));
    return out;
  }

  async close() {
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Parser manager is shutting down"));
    }
    this.#pending.clear();
    const live = Object.values(this.#workers).filter(Boolean);
    this.#workers = { extract: null, ocr: null, ownerExtract: null, ownerOcr: null };
    await Promise.all(live.map((w) => w.terminate()));
  }
}
