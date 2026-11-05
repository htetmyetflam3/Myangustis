import { Worker } from "node:worker_threads";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { TextDecoder } from "node:util";
import { DEFAULT_OUTPUT_DIR, REGISTER_LOG } from "../../../_path.js";
import { writeOutput } from "./emit.js";
import { finishManualPdf } from "./manual-pdf.js";
import { finishManualDocx } from "./manual-docx.js";
import { appendRecord, note, registerPath } from "./provenance.js";
import {
  WORKER_HEAP_MB,
  WORKER_TIMEOUT_MS,
  MAX_OCR_PAGES,
  MAX_INPUT_BYTES,
  MAX_INPUT_MB,
  ocrTimeoutMs,
} from "../limits/local.js";
import { decideForCaller, normalizeCaller } from "../../../extend/caller-policy.js";
import { classifyScraperSource } from "../../../extend/classify.js";
import { advisoryOnce, muteAdvisories } from "../../../../Architecture/host/advisory.js";

const EXTRACT_URL = new URL("../worker/extract.entry.js", import.meta.url);
const OCR_URL = new URL("../worker/ocr.entry.js", import.meta.url);

const OUTPUT_TYPES = new Set(["txt", "docx", "pdf"]);
const JOBS = new Set(["extracting", "ocr", "null"]);
const METHODS = new Set(["default", "manual", "null"]);
const SOURCE_ENCODINGS = new Set(["auto", "unicode", "zawgyi-one"]);

const IDENTITY_FIELDS = [
  "jobToken", "formId", "submitId", "userId", "sessionId", "extension", "task",
];

export { EXTRACT_URL, OCR_URL, OUTPUT_TYPES, JOBS, METHODS, SOURCE_ENCODINGS, IDENTITY_FIELDS };

export class ManagerCore {
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

  async run(jobs, caller = "site", identity = null) {
    const out = [];
    for (const job of jobs) out.push(await this.dispatch(job, caller, identity));
    return out;
  }
}
