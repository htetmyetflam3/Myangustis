import { Worker } from "node:worker_threads";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { TextDecoder } from "node:util";
import { DEFAULT_OUTPUT_DIR, REGISTER_LOG } from "../../_path.js";
import { writeOutput } from "./write/emit.js";
import { finishManualPdf } from "./worker/manual-pdf.js";
import { finishManualDocx } from "./worker/manual-docx.js";
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
import { advisoryOnce, muteAdvisories } from "../../../Architecture/host/advisory.js";

const EXTRACT_URL = new URL("./worker/extract.entry.js", import.meta.url);
const OCR_URL = new URL("./worker/ocr.entry.js", import.meta.url);

const OUTPUT_TYPES = new Set(["txt", "docx", "pdf"]);
const JOBS = new Set(["extracting", "ocr", "null"]);
const METHODS = new Set(["default", "manual", "null"]);
const SOURCE_ENCODINGS = new Set(["auto", "unicode", "zawgyi-one"]);

// Identity is a trusted in-process handoff, not a password. Network callers
// must authenticate before supplying it, and job metadata cannot select it.
function ownerAccess(identity) {
  if (identity === undefined || identity === null) return false;
  if (typeof identity !== "object" || Array.isArray(identity) ||
      typeof identity.userId !== "string" || !identity.userId.trim()) {
    throw new Error("A trusted user ID is required");
  }
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
    const source = job.data ?? job.inPath ?? null;
    if (!source) return 0;
    return (await pdfPageCount(source)) || 0;
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

  constructor({ outputDir = DEFAULT_OUTPUT_DIR, quiet = false } = {}) {
    if (typeof quiet !== "boolean") throw new TypeError("quiet must be a boolean");
    if (quiet) muteAdvisories();
    advisoryOnce('parser', '[Parser] Manager.dispatchStream pulls an opened PDF or DOCX through a private temporary file. Parsed pages are spooled, then checked with hash-free POS; unknown contexts are saved beside the output as .unknown.txt. --quiet mutes advisories for 24 hours.');
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
      env: {
        ...process.env,
        CURL_KEY: "__parser_worker_disabled__",
        CURL_KEY_SHA256: "__parser_worker_disabled__",
        MYANGUSTIS_CHAIN_DOOR: "ParserManager",
      },
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


  async dispatch(job, caller = "site", identity = null) {
    return this.#dispatch(job, caller, ownerAccess(identity), identity);
  }

  async #dispatch(job, caller, owner, identity = null) {
    const who = normalizeCaller(caller);
    const { job: jobField, method } = readManagerPayload(job);
    const lane = route(job);
    const out = resolveOutput(job);
    const meta = { ...echoMeta(job), ...(identity?.userId ? { userId: identity.userId } : {}) };
    const inputKind = inferInputKind(job);
    const manualPdf = lane === "extract" && jobField === "extracting"
      && method === "manual" && inputKind === "pdf";
    const manualDocxImages = lane === "extract" && inputKind === "docx"
      && (method === "manual" || jobField === "null");
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
        const size = typeof source === "string" ? (await fs.stat(source)).size : source.byteLength;
        if (!owner && Number.isFinite(size) && size > MAX_INPUT_BYTES) {
          throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
        }
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

    let workDir = null;
    try {
      const outPath = this.#outPathFor(job, out);
      const fileBackedPdf = lane === "extract" && inputKind === "pdf"
        && (method === "default" || method === "manual");
      const fileBackedOcr = lane === "ocr";
      if (fileBackedPdf || fileBackedOcr) {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "linga-pdf-job-"));
      }
      const payload =
        lane === "ocr"
          ? { op: "ocr", inPath: job.inPath, data: job.data, source: job.filename, outPath,
              includeText: job.includeText === true, ...(fileBackedOcr ? { workDir } : {}) }
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
              ...(manualDocxImages ? { deferImageOutput: true, job: jobField } : {}),
              ...(fileBackedPdf ? { workDir, deferManualOcr: manualPdf } : {}),
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

      if (reply.deferredDocx) reply = await this.#finishManualDocx(reply, job, outPath, owner);

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
        ...(reply.posScan ? { posScan: reply.posScan } : {}),
        ...(job.includePreview ? { metadata: reply.metadata ?? {}, changes: reply.changes ?? [] } : {}),

        ...meta,
      };
      if (typeof reply.text === "string") result.text = reply.text;
      return result;
    } finally {
      try {
        if (workDir) await fs.rm(workDir, { recursive: true, force: true });
      } finally {
        releaseLane();
      }
    }
  }

  async #finishManualPdf(reply, job, outPath, owner) {
    try {
      if (!reply.deferredOutput || !reply.pageStore || !reply.internalPdf?.path) {
        throw new Error("Manual PDF extraction did not return a file-backed page store");
      }
      const written = await finishManualPdf({
        pageStore: reply.pageStore,
        sourcePath: reply.internalPdf.path,
        directory: reply.internalPdf.dir,
        outPath,
        source: job.filename ?? reply.filename ?? "",
        counts: reply.counts,
        includeText: job.includeText === true,
        owner,
        maxOcrPages: MAX_OCR_PAGES,
        pageHasImage: async (file, number) => (await import("./read/pdf-render.js")).pageHasRasterImage(file, number),
        ocrPage: (file, number) => this.#dispatchOcr({ type: "ocrPage", inPath: file, pageNumber: number }, 1, owner),
        ocrRegion: (file, number, bbox) => this.#dispatchOcr({ type: "ocrRegion", inPath: file, pageNumber: number, bbox }, 1, owner),
      });
      note(reply.provenance, { ocr: { pages: written.ocrPages } });
      appendRecord(reply.provenance, { file: registerPath(REGISTER_LOG) });
      return { ...reply, ...written };
    } finally {
      if (reply.internalPdf?.dir) await fs.rm(reply.internalPdf.dir, { recursive: true, force: true });
    }
  }

  async #finishManualDocx(reply, job, outPath, owner) {
    try {
      if (!reply.internalDocx?.pageStore || !reply.internalDocx?.directory || !reply.imageFiles?.length) {
        throw new Error("Manual DOCX extraction did not return image and paragraph spools");
      }
      const ocr = (await this.#dispatchOcr({ op: "ocr-images", files: reply.imageFiles }, reply.imageFiles.length, owner)) ?? [];
      const written = await finishManualDocx({
        pageStore: reply.internalDocx.pageStore,
        directory: reply.internalDocx.directory,
        outPath,
        source: job.filename ?? reply.filename ?? "",
        counts: reply.counts,
        includeText: job.includeText === true,
        owner,
        imageFiles: reply.imageFiles,
        ocr,
      });
      note(reply.provenance, { ocr: { images: reply.imageFiles.length } });
      appendRecord(reply.provenance, { file: registerPath(REGISTER_LOG) });
      return { ...reply, ...written };
    } finally {
      try {
        if (reply.imageDir) await fs.rm(reply.imageDir, { recursive: true, force: true });
      } finally {
        if (reply.internalDocx?.directory) await fs.rm(reply.internalDocx.directory, { recursive: true, force: true });
      }
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

  async dispatchImages(files, identity = null) {
    const owner = ownerAccess(identity);
    if (!Array.isArray(files) || files.length === 0) return [];
    return (await this.#dispatchOcr({ op: "ocr-images", files }, files.length, owner)) ?? [];
  }

  async startOcr(identity = null) {
    return this.#dispatchOcr({ type: "init" }, 1, ownerAccess(identity));
  }

  async dispatchOcrImageDetailed(data, identity = null) {
    const owner = ownerAccess(identity);
    if (!(data instanceof Uint8Array) || (!owner && data.byteLength > MAX_INPUT_BYTES)) {
      throw new Error(`OCR image must be bytes within the ${MAX_INPUT_MB} MB cap`);
    }
    return this.#dispatchOcr({ type: "ocrImageDetailed", data }, 1, owner);
  }

  // Formatting existing text does not recover a lost font or encoding.
  async renderPlainText({ inPath, outPath }, identity = null) {
    const owner = ownerAccess(identity);
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

  // For PDF/DOCX transfer, local callers open a readable byte stream. Manager
  // pulls it to a private temporary file and never opens their source path.
  // PDF workers use that file; DOCX input is still parsed from a byte buffer.
  async dispatchStream(source, job = {}) {
    if (!source || typeof source[Symbol.asyncIterator] !== "function") {
      throw new TypeError("A readable byte stream is required");
    }
    if (!job || typeof job !== "object" || Array.isArray(job)) {
      throw new TypeError("A local Manager job object is required");
    }
    if ("inPath" in job || "data" in job) {
      throw new TypeError("Supply the source stream, not an input path or buffer");
    }
    const name = typeof job.filename === "string" ? path.basename(job.filename) : "";
    const inputKind = job.inputKind === undefined
      ? (name.toLowerCase().endsWith(".pdf") ? "pdf" : name.toLowerCase().endsWith(".docx") ? "docx" : "")
      : String(job.inputKind).toLowerCase();
    if (inputKind !== "pdf" && inputKind !== "docx") {
      throw new Error("Local stream input must be a PDF or DOCX");
    }
    const localJob = {
      job: "extracting", method: "default", ...job,
      output: job.output ?? job.outputType ?? "txt",
      inputKind, filename: name || `input.${inputKind}`,
    };
    readManagerPayload(localJob);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linga-parser-input-"));
    const inPath = path.join(directory, `input.${inputKind}`);
    async function* byteChunks() {
      for await (const chunk of source) {
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Local stream must yield bytes");
        // A provider may reuse its buffer when the iterator advances.
        yield Buffer.from(chunk);
      }
    }
    try {
      await pipeline(byteChunks(), createWriteStream(inPath, { flags: "wx", mode: 0o600 }));
      return await this.#dispatch({ ...localJob, inPath }, "local", true);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }

  async run(jobs, caller = "site", identity = null) {
    const out = [];
    for (const job of jobs) out.push(await this.dispatch(job, caller, identity));
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
