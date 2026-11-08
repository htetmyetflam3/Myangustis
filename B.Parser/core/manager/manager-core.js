/*
(Support 22) Shared support, no chain position - the worker pool and Manager.
This module creates worker threads (converter and OCR), submits payloads to them, and terminates them. All routing logic lives in the API dispatcher (Support 19).
*/
// Manager — thin worker pool + dispatch wrapper.
// Job/method normalization and caller-based routing live in ../api/dispatcher.js.
// This module only creates workers, submits payloads, and terminates workers.
import { Worker } from "node:worker_threads";
import fs from "node:fs/promises";
import path from "node:path";
import { dispatch } from "../api/dispatcher.js";
import { BindInput } from "../api/input-dispatcher.js";
import { writeOutput } from "../io/write.js";

const CONVERTER_URL = new URL("../worker/converter.js", import.meta.url);
const OCR_URL = new URL("../worker/ocr.js", import.meta.url);

export class WorkerPool {
  #workers = new Map();
  #pending = new Map();
  #seq = 0;

  #rejectPendingFor(worker, error) {
    for (const [id, entry] of this.#pending) {
      if (entry.worker !== worker) continue;
      this.#pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  // There are only two worker slots in the whole parser: one converter
  // thread and one OCR thread. The caller assigns the profile/limit for the
  // next job; if that assignment changes, the same worker script is
  // recreated with the new profile instead of spawning another worker type.
  createWorker(workerKey, owner = false, { limit = null, worker: workerName = null } = {}) {
    if (workerKey !== "ocr" && workerKey !== "converter") {
      throw new TypeError(`Unsupported worker key "${workerKey}" (use "ocr" or "converter")`);
    }
    const profile = workerName || (owner ? "owner" : "site");
    const existing = this.#workers.get(workerKey);
    if (existing) {
      if (existing.owner === owner && existing.profile === profile && existing.limit === limit) {
        return existing.worker;
      }
      this.#workers.delete(workerKey);
      this.#rejectPendingFor(
        existing.worker,
        new Error("Parser worker profile changed before the job finished"),
      );
      existing.worker.terminate().catch(() => {});
    }
    const url = workerKey === "ocr" ? OCR_URL : CONVERTER_URL;
    const options = {
      workerData: {
        parserOwner: owner,
        parserWorker: workerName,
        parserLimit: limit,
        parserKey: workerKey,
      },
      env: {
        ...process.env,
        CURL_KEY: "__parser_worker_disabled__",
        CURL_KEY_SHA256: "__parser_worker_disabled__",
        MYANGUSTIS_CHAIN_DOOR: "ParserManager",
      },
    };
    // The trigger limit drives the thread limits: 0 = no resource limits,
    // any positive limit = capped; no limit sent falls back to owner/site.
    const capped = limit === null ? !owner : limit > 0;
    if (capped) {
      options.resourceLimits = { maxOldGenerationSizeMb: 256, stackSizeMb: 8 };
    }
    const worker = new Worker(url, options);
    worker.on("message", (message) => this.handleReply(message));
    worker.on("error", (error) => {
      if (this.#workers.get(workerKey)?.worker === worker) {
        this.#workers.delete(workerKey);
      }
      this.#rejectPendingFor(worker, error);
    });
    worker.on("exit", () => {
      if (this.#workers.get(workerKey)?.worker === worker) {
        this.#workers.delete(workerKey);
      }
      this.#rejectPendingFor(worker, new Error("Parser worker exited"));
    });
    this.#workers.set(workerKey, { worker, owner, profile, limit });
    return worker;
  }

  submit(worker, payload, budget = 300000) {
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      // budget null/Infinity = no cap (limit 0): no timer at all.
      const timer = Number.isFinite(budget)
        ? setTimeout(() => {
            this.#pending.delete(id);
            reject(new Error(`Worker exceeded ${budget} ms`));
            this.terminate(worker);
          }, budget)
        : null;
      timer?.unref();
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
    else entry.reject(new Error(message.error?.message ?? message.error ?? "Worker error"));
    return true;
  }

  terminate(worker) {
    for (const [workerKey, entry] of this.#workers) {
      if (entry.worker === worker) {
        this.#workers.delete(workerKey);
        worker.terminate().catch(() => {});
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
    for (const { worker } of this.#workers.values()) {
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
      object = await BindInput({ path: job.inPath });
    }
    if (!object) {
      throw new TypeError("Manager.dispatch: job needs an object or inPath");
    }
    return dispatch({
      object,
      method: job.method ?? "default",
      caller,
      identity,
      job,
      key: job.key ?? null,
      limit: job.limit ?? null,
      worker: job.worker ?? null,
      output: job.output ?? job.outputFormat ?? job.outputType ?? null,
    });
  }

  async dispatchStream(source, job = {}) {
    const object = await BindInput({ object: source });
    return dispatch({
      object,
      method: job.method ?? "default",
      caller: "local",
      identity: job.identity ?? null,
      job,
      key: job.key ?? null,
      limit: job.limit ?? null,
      worker: job.worker ?? null,
      output: job.output ?? job.outputFormat ?? job.outputType ?? null,
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
