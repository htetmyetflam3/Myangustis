// Manager payload helpers (shared)
// Extracted from: B.Parser/main/parser/manager.js
// Contains: ownerAccess, echoMeta, errorFromWorker, inferInputKind,
// countOcrPages, readManagerPayload, route, resolveOutput.
// Not wired into manager.js yet; file names only.

const IDENTITY_FIELDS = [
  "jobToken", "formId", "submitId", "userId", "sessionId", "extension", "task",
];

export function ownerAccess(identity) {
  if (identity === undefined || identity === null) return false;
  if (typeof identity !== "object" || Array.isArray(identity) ||
      typeof identity.userId !== "string" || !identity.userId.trim()) {
    throw new Error("A trusted user ID is required");
  }
  return true;
}

export function echoMeta(job) {
  const identity = {};
  for (const field of IDENTITY_FIELDS) {
    if (job?.[field] !== undefined) identity[field] = job[field];
  }
  return { ...identity, ...(job?.meta && typeof job.meta === "object" ? job.meta : {}) };
}

export function errorFromWorker(lane, payload) {
  if (!payload || typeof payload === "string") {
    return new Error(payload || `${lane} worker failed`);
  }
  const error = new Error(payload.message || `${lane} worker failed`);
  if (payload.name) error.name = String(payload.name);
  if (payload.stack) error.stack = String(payload.stack);
  return error;
}

export function inferInputKind(job) {
  if (job?.inputKind) return String(job.inputKind).toLowerCase();
  const name = job?.filename || (job?.inPath ? path.basename(job.inPath) : "");
  return String(name).toLowerCase().endsWith(".docx") ? "docx" : "pdf";
}

export async function countOcrPages(job) {
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
