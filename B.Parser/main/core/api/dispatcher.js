// Dispatcher — caller routing and job normalization.
// Decides which worker thread to use based on caller type (site/local).
// Manager pool is only a worker lifecycle helper; all routing logic lives here.
import { BindParser } from "./bind-parser.js";
import { pool } from "../manager/manager-core.js";
import { normalizeCaller } from "../../../extend/caller-policy.js";

export const JOBS = new Set(["extracting", "ocr", "null"]);
export const METHODS = new Set(["default", "manual", "null"]);
export const SOURCE_ENCODINGS = new Set(["auto", "unicode", "zawgyi-one"]);

function normalizeJob(job = {}) {
  const jobType = String(job.job ?? "extracting").toLowerCase();
  const method = String(job.method ?? "extracting").toLowerCase();
  const encoding = String(job.sourceEncoding ?? "auto").toLowerCase();
  if (!JOBS.has(jobType)) throw new TypeError(`Unsupported job "${jobType}"`);
  if (!METHODS.has(method)) throw new TypeError(`Unsupported method "${method}"`);
  if (!SOURCE_ENCODINGS.has(encoding)) throw new TypeError(`Unsupported encoding "${encoding}"`);
  return { ...job, job: jobType, method, sourceEncoding: encoding };
}

function ownerForCaller(caller) {
  const who = normalizeCaller(caller);
  // Site callers are non-owner workers; local/scraper callers are owner workers.
  return { who, owner: who !== "site" };
}

function laneForJob(jobType) {
  return jobType === "ocr" ? "ocr" : "extract";
}

function budgetFor(owner) {
  return owner ? Infinity : 300000;
}

// Single entry point. Normalizes job/method, decides worker from caller,
// submits to manager pool, returns the worker result.
export async function dispatch({ object, method, caller = "site", identity, job = {} }) {
  if (!object || typeof object !== "object") {
    throw new TypeError("dispatcher: object is required");
  }
  const normalized = normalizeJob(job);
  const m = String(method ?? "").toLowerCase();
  if (!METHODS.has(m)) throw new TypeError(`Unsupported method "${m}"`);
  const { who, owner } = ownerForCaller(caller);
  const lane = laneForJob(normalized.job);
  const worker = pool.createWorker(lane, owner);
  const payload = {
    ...normalized,
    method: m,
    object,
    caller: who,
    identity,
    owner,
  };
  return pool.submit(worker, payload, budgetFor(owner));
}

export async function dispatchSite({ object, method, identity, job = {} }) {
  return dispatch({ object, method, caller: "site", identity, job });
}

export async function dispatchLocal({ object, method, identity, job = {} }) {
  return dispatch({ object, method, caller: "local", identity, job });
}

export { normalizeJob, ownerForCaller, laneForJob };
