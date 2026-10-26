import { Worker } from "node:worker_threads";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_OUTPUT_DIR } from "./core/paths.mjs";
import {
  WORKER_HEAP_MB,
  WORKER_TIMEOUT_MS,
  MAX_OCR_PAGES,
  ocrTimeoutMs,
} from "./core/limits.mjs";
import { decideForCaller, normalizeCaller } from "../../extend/caller-policy.mjs";
import { classifyScraperSource } from "./codepage/classify.mjs";

const EXTRACT_URL = new URL("./worker/extract.entry.mjs", import.meta.url); 
const OCR_URL = new URL("./worker/ocr.entry.mjs", import.meta.url); 

const OUTPUT_TYPES = new Set(["txt", "docx", "pdf"]);
const JOBS = new Set(["extracting", "ocr", "null"]);
const METHODS = new Set(["default", "manual", "null"]);

// Identity/contract fields the wider API chain (Site queue, engine plugin)
// attaches to a job. The parser does not interpret them; it must echo every
// one back on BOTH normal and skip results so the caller can reconcile.
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
  // Worker errors used to be reduced to only their message. The replacement
  // Error was then born here, so every parser failure misleadingly pointed at
  // manager.mjs even when the actual fault was deep in PDF decoding.
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
    const { pdfPageCount } = await import("./read/ocr.mjs");
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

  return { job: jobField, method, output };
}


/* The lane is the route. It used to also depend on the fused
   "conversion-analysis" value; the site now sends the route unfused, and the
   caller asks for docx output when it wants an Engine source. */
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
    const inputKind = job.inputKind ?? inferInputKind(job);
    const fileInfo = {
      filename: job.filename ?? null,
      inputKind,
      output: out,
      method,
      lane,
    };

    // Scraper early gate: skip an old-font PDF BEFORE paying for a worker parse.
    // OCR lane and DOCX are never gated. Site never enters this branch (its
    // policy is parse-all). A skip returns the same contract fields as a parse.
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
            // file/contract echo — never dropped, even on a skip
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
          ? { id, op: "ocr", inPath: job.inPath, data: job.data, source: job.filename, outPath }
          : {
              id,
              op: "extract",
              method, 
              kind: job.inputKind, 
              filename: job.filename,
              inPath: job.inPath,
              data: job.data,
              outPath,
            };

      // default and manual both begin in the Praser extraction lane. Manual's
      // image pages are sent through dispatchImages afterward, where they get
      // their own OCR budget instead of extending the extraction timeout.
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

      const reply = await new Promise((resolve, reject) => {
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

      /* handling "null" is the mixed case: the text core reads the text and
         leaves a marker per image box, and the SECOND worker group (the OCR
         lane) reads the boxes. The manager owns that hand-off because it owns
         both lanes. It used to be gated on method "manual" + txt output,
         which is now exactly the case that has no images to read. */
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
        // The measured six-path verdict, surfaced straight from the worker.
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
        // identity/contract fields echoed last so they can never be lost
        ...meta,
      };
      if (out === "docx" && "text" in reply) result.text = reply.text;
      return result;
    } finally {
      releaseLane();
    }
  }

  async dispatchImages(files) {
    if (!Array.isArray(files) || files.length === 0) return [];
    const lane = "ocr";
    const previous = this.laneTails[lane];
    let releaseLane;
    const laneDone = new Promise((resolve) => { releaseLane = resolve; });
    this.laneTails[lane] = previous.catch(() => {}).then(() => laneDone);
    await previous.catch(() => {});
    try {
      const worker = this._worker(lane);
      const id = ++this.seq;
      const budget = ocrTimeoutMs(files.length);
      const reply = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`ocr worker exceeded ${budget} ms`));
          if (this.workers[lane] === worker) this.workers[lane] = null;
          worker.terminate().catch(() => {});
        }, budget);
        timer.unref();
        this.pending.set(id, { resolve, reject, lane, timer });
        worker.postMessage({ id, op: "ocr-images", files });
      });
      return reply.result ?? [];
    } finally {
      releaseLane();
    }
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
