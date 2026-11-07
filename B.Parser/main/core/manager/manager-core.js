// Manager — thin worker pool + dispatch wrapper.
// Job/method normalization and caller-based routing live in ../api/dispatcher.js.
// This module only creates workers, submits payloads, and terminates workers.
import { Worker } from "node:worker_threads";
import fs from "node:fs/promises";
import path from "node:path";
import { dispatch } from "../api/dispatcher.js";
import { streamReader, streamReaderStream } from "../api/stream-reader.js";
import { writeOutput } from "../io/write.js";

const EXTRACT_URL = new URL("../worker/extract.entry.js", import.meta.url);
const OCR_URL = new URL("../worker/ocr.entry.js", import.meta.url);

export class WorkerPool {
  #workers = new Map();
  #pending = new Map();
  #seq = 0;

  #workerKey(lane, owner) {
    return owner ? `owner${lane[0].toUpperCase()}${lane.slice(1)}` : lane;
  }

  createWorker(lane, owner = false) {
    const key = this.#workerKey(lane, owner);
    if (this.#workers.has(key)) return this.#workers.get(key);
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
      options.resourceLimits = { maxOldGenerationSizeMb: 256, stackSizeMb: 8 };
    }
    const worker = new Worker(url, options);
    worker.on("exit", () => {
      this.#workers.delete(key);
    });
    this.#workers.set(key, worker);
    return worker;
  }

  submit(worker, payload, budget = 300000) {
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Worker exceeded ${budget} ms`));
        this.terminate(worker);
      }, budget);
      timer.unref();
      this.#pending.set(id, { resolve, reject, timer, worker });
      try {
        worker.postMessage({ ...payload, id });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  handleReply(message) {
    const entry = this.#pending.get(message.id);
    if (!entry) return false;
    this.#pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result ?? message);
    else entry.reject(new Error(message.error ?? "Worker error"));
    return true;
  }

  terminate(worker) {
    for (const [key, w] of this.#workers) {
      if (w === worker) {
        worker.terminate().catch(() => {});
        this.#workers.delete(key);
        return;
      }
    }
  }

  async close() {
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Worker pool is shutting down"));
    }
    this.#pending.clear();
    for (const worker of this.#workers.values()) {
      worker.terminate().catch(() => {});
    }
    this.#workers.clear();
  }
}

export const pool = new WorkerPool();

// Thin Manager wrapper for existing callers (python-entry, scraper-entry).
// Delegates routing/normalization to dispatcher; pool handles worker lifecycle.
export class Manager {
  constructor({ outputDir, quiet } = {}) {
    this.outputDir = outputDir;
  }

  async dispatch(job, caller = "site", identity = null) {
    let { object } = job;
    if (!object && job.inPath) {
      object = await streamReader({ path: job.inPath });
    }
    if (!object) {
      throw new TypeError("Manager.dispatch: job needs an object or inPath");
    }
    return dispatch({
      object,
      method: job.method ?? "extracting",
      caller,
      identity,
      job,
    });
  }

  async dispatchStream(source, job = {}) {
    const object = await streamReaderStream(source);
    return dispatch({
      object,
      method: job.method ?? "extracting",
      caller: "local",
      identity: job.identity ?? null,
      job,
    });
  }

  async renderPlainText(job = {}) {
    const { inPath, outPath, source = "", owner = false } = job;
    if (!inPath || !outPath || path.extname(outPath).toLowerCase() !== ".docx") {
      throw new Error("Plain text rendering requires an input file and a .docx output path");
    }
    const bytes = await fs.readFile(inPath);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return writeOutput(outPath, [{ text }], { source, owner });
  }

  async close() {
    await pool.close();
  }
}
