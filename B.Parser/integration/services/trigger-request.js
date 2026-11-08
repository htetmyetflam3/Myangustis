/*
(Support 16) Shared support, no chain position - the trigger contract in one place.
This module defines which callers exist (public, owner, scraper), which worker profile and limits each caller gets, and the keys and outputs a trigger request may carry.
*/
export const TRIGGER_CALLERS = Object.freeze({
  PUBLIC: "public",
  OWNER: "owner",
  SCRAPER: "scraper",
});

// One place to control which worker profile a caller/service gets. Change the
// limit here (e.g. scraper -> 3) and every queue-sent trigger request follows.
export const CALLER_WORKERS = Object.freeze({
  public: "publicworker",
  owner: "privateworker",
  scraper: "serviceworker",
});

export const CALLER_LIMITS = Object.freeze({
  public: 1,
  owner: 0,
  scraper: 3,
});

// The trigger also names which parser worker script should receive the job:
//   converter -> core/worker/converter.js (auto-detects PDF vs DOCX)
//   ocr       -> core/worker/ocr.js
export const TRIGGER_KEYS = Object.freeze({
  OCR: "ocr",
  CONVERTER: "converter",
});

// Requested output file type. This is independent of the input: the
// converter detects whether the input is PDF or DOCX by itself.
export const TRIGGER_OUTPUTS = Object.freeze({
  PDF: "pdf",
  DOCX: "docx",
  TXT: "txt",
});

export function normalizeTriggerCaller(caller) {
  const who = String(caller ?? TRIGGER_CALLERS.PUBLIC).trim().toLowerCase();
  return Object.hasOwn(CALLER_WORKERS, who) ? who : null;
}

export function workerForCaller(caller) {
  const who = normalizeTriggerCaller(caller);
  return who ? CALLER_WORKERS[who] : null;
}

export function limitForCaller(caller) {
  const who = normalizeTriggerCaller(caller);
  return who ? CALLER_LIMITS[who] : null;
}

export function keyForJob(job) {
  return String(job ?? "").trim().toLowerCase() === TRIGGER_KEYS.OCR
    ? TRIGGER_KEYS.OCR
    : TRIGGER_KEYS.CONVERTER;
}

export function normalizeTriggerKey(key, job) {
  if (key === undefined || key === null || key === "") return keyForJob(job);
  const normalized = String(key).trim().toLowerCase();
  if (!Object.values(TRIGGER_KEYS).includes(normalized)) {
    throw new Error(`unknown trigger key: ${key} (use "ocr" or "converter")`);
  }
  return normalized;
}

export function normalizeTriggerOutput(output) {
  if (output === undefined || output === null || output === "") return TRIGGER_OUTPUTS.TXT;
  const normalized = String(output).trim().toLowerCase().replace(/^\./, "");
  if (!Object.values(TRIGGER_OUTPUTS).includes(normalized)) {
    throw new Error(`unknown trigger output: ${output} (use "pdf", "docx", or "txt")`);
  }
  return normalized;
}

export function buildTriggerRequest({
  job,
  caller = TRIGGER_CALLERS.PUBLIC,
  key,
  output,
  ...rest
} = {}) {
  const who = normalizeTriggerCaller(caller);
  if (!who) throw new Error(`unknown trigger caller: ${caller}`);
  if (typeof job !== "string" || !job.trim()) throw new Error("trigger request requires job");
  const normalizedJob = job.trim();
  return {
    ...rest,
    job: normalizedJob,
    caller: who,
    limit: CALLER_LIMITS[who],
    worker: CALLER_WORKERS[who],
    key: normalizeTriggerKey(key, normalizedJob),
    output: normalizeTriggerOutput(output ?? rest.outputFormat ?? rest.outputType),
  };
}

// Validate only — the request is forwarded to the parser as-is, so job,
// caller, limit, worker profile, worker key, and output type all reach the
// dispatcher. A queued Site request may also carry `object`, the file
// object produced by the queue's file reader.
export function normalizeTriggerRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("trigger request must be an object");
  }
  const { job, caller, limit, worker, key, output, object } = request;
  if (object !== undefined && (!object || typeof object !== "object" || Array.isArray(object))) {
    throw new Error("trigger object must be an object when supplied");
  }
  const who = normalizeTriggerCaller(caller);
  if (!who) throw new Error(`unknown trigger caller: ${caller}`);
  if (typeof job !== "string" || !job.trim()) throw new Error("trigger request requires job");
  if (limit !== CALLER_LIMITS[who]) {
    throw new Error(`trigger limit mismatch for caller ${who}: expected ${CALLER_LIMITS[who]}`);
  }
  if (worker !== CALLER_WORKERS[who]) {
    throw new Error(`trigger worker mismatch for caller ${who}: expected ${CALLER_WORKERS[who]}`);
  }
  // New requests send key and output explicitly; older four-field requests
  // are still accepted by deriving the worker key from the job and the
  // output as txt.
  normalizeTriggerKey(key, job);
  normalizeTriggerOutput(output);
  return request;
}
