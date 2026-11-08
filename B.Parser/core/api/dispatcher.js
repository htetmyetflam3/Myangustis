/*
(Support 19) Shared support, no chain position - caller routing and job normalization.
This module decides which worker a job goes to based on the caller, and normalizes job, method, source encoding and output before the Manager pool (Support 23) submits it.
*/
// Dispatcher — caller routing and job normalization.
// Decides which worker thread to use based on caller type (site/local).
// Manager pool is only a worker lifecycle helper; all routing logic lives here.
import { pool } from "../manager/manager-core.js";
import { normalizeCaller } from "../../extend/caller-policy.js";

export const JOBS = new Set(["extracting", "ocr", "null"]);
export const METHODS = new Set(["default", "manual", "null"]);
export const SOURCE_ENCODINGS = new Set(["auto", "unicode", "zawgyi-one"]);
export const OUTPUTS = new Set(["pdf", "docx", "txt"]);

function normalizeJob(job = {}) {
  // One shape only: a job object { job, method?, sourceEncoding?, ... }.
  // Callers that hold a plain-string job (the trigger/lazy boundary) build
  // this object themselves; the dispatcher does not accept both forms.
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new TypeError("dispatcher: job must be an object");
  }
  const jobType = String(job.job ?? "extracting").toLowerCase();
  const encoding = String(job.sourceEncoding ?? "auto").toLowerCase();
  if (!JOBS.has(jobType)) throw new TypeError(`Unsupported job "${jobType}"`);
  if (job.method !== undefined && job.method !== null
      && !METHODS.has(String(job.method).toLowerCase())) {
    throw new TypeError(`Unsupported method "${job.method}"`);
  }
  if (!SOURCE_ENCODINGS.has(encoding)) throw new TypeError(`Unsupported encoding "${encoding}"`);
  return { ...job, job: jobType, sourceEncoding: encoding };
}

function ownerForCaller(caller) {
  const who = normalizeCaller(caller);
  // Site callers are non-owner workers; local/scraper callers are owner workers.
  return { who, owner: who !== "site" };
}

export const WORKER_KEYS = Object.freeze({
  OCR: "ocr",
  CONVERTER: "converter",
});

function keyForJob(jobType) {
  return String(jobType ?? "").toLowerCase() === WORKER_KEYS.OCR
    ? WORKER_KEYS.OCR
    : WORKER_KEYS.CONVERTER;
}

function normalizeWorkerKey(key, jobType) {
  if (key === undefined || key === null || key === "") return keyForJob(jobType);
  const normalized = String(key).trim().toLowerCase();
  if (!Object.values(WORKER_KEYS).includes(normalized)) {
    throw new TypeError(`Unsupported worker key "${key}" (use "ocr" or "converter")`);
  }
  return normalized;
}

function normalizeOutput(output) {
  if (output === undefined || output === null || output === "") return "txt";
  const normalized = String(output).trim().toLowerCase().replace(/^\./, "");
  if (!OUTPUTS.has(normalized)) {
    throw new TypeError(`Unsupported output "${output}" (use "pdf", "docx", or "txt")`);
  }
  return normalized;
}

// limit 0 means no worker budget cap; any positive limit uses the capped
// budget. The limit arrives on the trigger request and must reach the pool —
// it is never re-derived or dropped here.
function budgetFor(limit, owner) {
  if (limit === 0) return null;
  if (Number.isInteger(limit) && limit > 0) return 300000;
  return owner ? null : 300000;
}

// Single entry point. Normalizes job/method, decides worker from caller,
// submits to manager pool, returns the worker result.
export async function dispatch({
  object,
  method,
  caller = "site",
  identity,
  job = {},
  limit = null,
  worker: workerName = null,
  key = null,
  output = null,
}) {
  if (!object || typeof object !== "object") {
    throw new TypeError("dispatcher: object is required");
  }
  const normalized = normalizeJob(job);
  const m = String(method ?? "").toLowerCase();
  if (!METHODS.has(m)) throw new TypeError(`Unsupported method "${m}"`);
  const effectiveLimit = limit ?? normalized.limit ?? null;
  if (effectiveLimit !== null && (!Number.isInteger(effectiveLimit) || effectiveLimit < 0)) {
    throw new TypeError(`Unsupported worker limit "${effectiveLimit}"`);
  }
  const effectiveWorker = workerName ?? normalized.worker ?? null;
  // `key` is the fifth trigger param and picks the actual worker script:
  // ocr -> worker/ocr.js, converter -> worker/converter.js.
  const effectiveKey = normalizeWorkerKey(key ?? normalized.key ?? null, normalized.job);
  const effectiveOutput = normalizeOutput(
    output ?? normalized.output ?? normalized.outputFormat ?? normalized.outputType,
  );
  const { who, owner } = ownerForCaller(caller);
  const worker = pool.createWorker(effectiveKey, owner, {
    limit: effectiveLimit,
    worker: effectiveWorker,
  });
  const payload = {
    ...normalized,
    method: m,
    object,
    // The two worker scripts consume the file directly. Expose the stream
    // reader's object in that shape as well, so converter.js can detect
    // PDF vs DOCX from the bytes/path without a caller-side format split.
    filename: normalized.filename
      ?? object.filename
      ?? (typeof object.path === "string" ? object.path.split(/[\\/]/).pop() : null),
    inPath: normalized.inPath ?? object.path ?? null,
    data: normalized.data ?? object.bytes ?? null,
    caller: who,
    identity,
    owner,
    // The trigger's params, carried into the worker untouched. `key` picks
    // one of the only two worker scripts; `output` is the requested file
    // type for that worker to produce.
    limit: effectiveLimit,
    worker: effectiveWorker,
    key: effectiveKey,
    output: effectiveOutput,
  };
  return pool.submit(worker, payload, budgetFor(effectiveLimit, owner));
}

export async function dispatchSite(request = {}) {
  return dispatch({ ...request, caller: "public" });
}

export async function dispatchLocal(request = {}) {
  return dispatch({ ...request, caller: "owner" });
}

export async function dispatchServices(request = {}) {
  return dispatch({ ...request, caller: "scraper" });
}

export {
  normalizeJob,
  ownerForCaller,
  keyForJob,
  normalizeWorkerKey,
  normalizeOutput,
};
