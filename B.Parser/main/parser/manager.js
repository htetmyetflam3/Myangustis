import { Worker } from "node:worker_threads";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { DEFAULT_OUTPUT_DIR, REGISTER_LOG } from "../../_path.js";
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
  constructor({ outputDir = DEFAULT_OUTPUT_DIR } = {}) {
    this.outputDir = outputDir;
    this.workers = { extract: null, ocr: null };
    this.pending = new Map();
    this.laneTails = { extract: Promise.resolve(), ocr: Promise.resolve() };
    this.seq = 0;
  }

  _failLane(lane, error, worker) {
    if (this.workers[lane] === worker) this.workers[lane] = null;
    for (const [id, entry] of this.pending) {
      if (entry.lane !== lane) continue;
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(error);
    }
  }
  _worker(lane) {
    if (this.workers[lane]) return this.workers[lane];
    const url = lane === "ocr" ? OCR_URL : EXTRACT_URL;
    const w = new Worker(url, {
      resourceLimits: {
        maxOldGenerationSizeMb: WORKER_HEAP_MB,
        stackSizeMb: 8,
      },
    });
    w.on("message", (m) => {
      const entry = this.pending.get(m.id);
      if (!entry) return;
      this.pending.delete(m.id);
      clearTimeout(entry.timer);
      if (m.ok) entry.resolve(m);
      else entry.reject(errorFromWorker(lane, m.error));
    });
    w.on("error", (error) => this._failLane(lane, error, w));
    w.on("exit", (code) => {
      if (code !== 0) this._failLane(lane, new Error(`${lane} worker exited (${code})`), w);
      else if (this.workers[lane] === w) this.workers[lane] = null;
    });
    this.workers[lane] = w;
    return w;
  }


  _outPathFor(job, out) {
    if (job.outPath) return job.outPath;



    return path.join(this.outputDir, `${crypto.randomUUID()}.${out}`);
  }


  async dispatch(job, caller = "site") {
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

    const previous = this.laneTails[lane];
    let releaseLane;
    const laneDone = new Promise((resolve) => { releaseLane = resolve; });
    this.laneTails[lane] = previous.catch(() => {}).then(() => laneDone);
    await previous.catch(() => {});

    try {
      const worker = this._worker(lane);
      const outPath = this._outPathFor(job, out);
      const id = ++this.seq;
      const payload =
        lane === "ocr"
          ? { id, op: "ocr", inPath: job.inPath, data: job.data, source: job.filename, outPath,
              includeText: job.includeText === true }
          : {
              id,
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
      if (lane === "ocr") {
        const pages = await countOcrPages(job);
        if (pages > MAX_OCR_PAGES) {
          throw new Error(
            `Scanned PDF has ${pages} pages; the OCR lane accepts at most ${MAX_OCR_PAGES} at a time`,
          );
        }
        budget = ocrTimeoutMs(pages);
      }

      let reply = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${lane} worker exceeded ${budget} ms`));
          if (this.workers[lane] === worker) this.workers[lane] = null;
          worker.terminate().catch(() => {});
        }, budget);
        timer.unref();
        this.pending.set(id, { resolve, reject, lane, timer });
        try {
          worker.postMessage(payload);
        } catch (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });

      if (manualPdf) reply = await this._finishManualPdf(reply, job, outPath);

      if (jobField === "null" && Array.isArray(reply.imageFiles) && reply.imageFiles.length) {
        try {
          const ocr = await this.dispatchImages(reply.imageFiles);
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

  async _finishManualPdf(reply, job, outPath) {
    if (!reply.deferredOutput || !Array.isArray(reply.pagesData)) {
      throw new Error("Manual PDF extraction did not return page data");
    }
    const pages = reply.pagesData;
    const scanned = [];
    let source;
    let pageHasRasterImage;
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      if (String(page?.text ?? "").trim()) continue;
      let hasImage = Boolean(page?.hasImg);
      if (!hasImage) {
        if (!pageHasRasterImage) {
          ({ pageHasRasterImage } = await import("./read/pdf-render.js"));
          source = job.inPath ? await fs.readFile(job.inPath) : job.data;
          if (!source) throw new Error("Manual PDF input is missing");
        }
        hasImage = await pageHasRasterImage(source, index + 1);
      }
      if (hasImage) scanned.push(index);
    }
    if (scanned.length > MAX_OCR_PAGES) {
      throw new Error(`PDF has ${scanned.length} image-only pages; the OCR lane accepts at most ${MAX_OCR_PAGES} at a time`);
    }
    for (const index of scanned) {
      const text = await this._dispatchOcr({
        type: "ocrPage", inPath: job.inPath, data: job.data, pageNumber: index + 1,
      }, 1);
      if (typeof text !== "string") throw new Error(`OCR did not return text for page ${index + 1}`);
      pages[index] = { ...pages[index], text, lines: [], hasImg: true };
    }
    const written = await writeOutput(outPath, pages, {
      counts: reply.counts, source: job.filename ?? reply.filename ?? "",
      includeText: job.includeText === true,
    });
    const ocrPages = scanned.map((index) => index + 1);
    note(reply.provenance, { ocr: { pages: ocrPages } });
    appendRecord(reply.provenance, { file: registerPath(REGISTER_LOG) });
    return { ...reply, ...written, pages: pages.length, ocrPages };
  }

  async _dispatchOcr(payload, count) {
    const lane = "ocr";
    const previous = this.laneTails[lane];
    let releaseLane;
    const laneDone = new Promise((resolve) => { releaseLane = resolve; });
    this.laneTails[lane] = previous.catch(() => {}).then(() => laneDone);
    await previous.catch(() => {});
    try {
      const worker = this._worker(lane);
      const id = ++this.seq;
      const budget = ocrTimeoutMs(count);
      const reply = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`ocr worker exceeded ${budget} ms`));
          if (this.workers[lane] === worker) this.workers[lane] = null;
          worker.terminate().catch(() => {});
        }, budget);
        timer.unref();
        this.pending.set(id, { resolve, reject, lane, timer });
        try {
          worker.postMessage({ id, ...payload });
        } catch (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
      return reply.result;
    } finally {
      releaseLane();
    }
  }

  async dispatchImages(files) {
    if (!Array.isArray(files) || files.length === 0) return [];
    return (await this._dispatchOcr({ op: "ocr-images", files }, files.length)) ?? [];
  }

  async startOcr() {
    return this._dispatchOcr({ type: "init" }, 1);
  }

  async dispatchOcrImageDetailed(data) {
    if (!(data instanceof Uint8Array) || data.byteLength > MAX_INPUT_BYTES) {
      throw new Error(`OCR image must be bytes within the ${MAX_INPUT_MB} MB cap`);
    }
    return this._dispatchOcr({ type: "ocrImageDetailed", data }, 1);
  }

  // Formatting existing text does not recover a lost font or encoding.
  async renderPlainText({ inPath, outPath }) {
    if (!inPath || !outPath || path.extname(outPath).toLowerCase() !== ".docx") {
      throw new Error("Plain text rendering requires an input file and a .docx output path");
    }
    const info = await fs.stat(inPath);
    if (info.size > MAX_INPUT_BYTES) throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    const bytes = await fs.readFile(inPath);
    if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return writeOutput(outPath, [{ text }], { source: path.basename(inPath) });
  }

  async run(jobs, caller = "site") {
    const out = [];
    for (const job of jobs) out.push(await this.dispatch(job, caller));
    return out;
  }

  async close() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Parser manager is shutting down"));
    }
    this.pending.clear();
    const live = Object.values(this.workers).filter(Boolean);
    this.workers = { extract: null, ocr: null };
    await Promise.all(live.map((w) => w.terminate()));
  }
}
