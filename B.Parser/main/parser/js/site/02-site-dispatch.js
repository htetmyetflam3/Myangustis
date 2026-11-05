import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { decideForCaller } from "../../../extend/caller-policy.js";
import { classifyScraperSource } from "../shared/codepage/classify.js";
import { MAX_INPUT_BYTES, MAX_INPUT_MB, WORKER_TIMEOUT_MS, MAX_OCR_PAGES, ocrTimeoutMs } from "../shared/core/limits.js";
import { appendRecord, note, registerPath } from "../shared/core/provenance.js";
import { finishManualPdf } from "../shared/worker/manual-pdf.js";
import { finishManualDocx } from "../shared/worker/manual-docx.js";

export class SiteDispatch {
  #laneTails;
  #pending;
  #seq;
  #workers;
  outputDir;

  constructor({ outputDir, quiet } = {}) {
    this.outputDir = outputDir;
  }

  #workerSlot(lane, owner) {
    return owner ? (lane === "ocr" ? "ownerOcr" : "ownerExtract") : lane;
  }

  #submit(lane, payload, budget, owner) {
    // wiring deferred — placeholder
  }

  #outPathFor(job, out) {
    if (job.outPath) return job.outPath;
    return path.join(this.outputDir, `${crypto.randomUUID()}.${out}`);
  }

  async #dispatch(job, caller, owner, identity = null) {
    const who = caller;
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
    // wiring deferred — placeholder
  }

  async #finishManualDocx(reply, job, outPath, owner) {
    // wiring deferred — placeholder
  }

  async dispatch(job, caller = "site", identity = null) {
    return this.#dispatch(job, caller, ownerAccess(identity), identity);
  }
}

function ownerAccess(identity) {
  if (identity === undefined || identity === null) return false;
  if (typeof identity !== "object" || Array.isArray(identity) ||
      typeof identity.userId !== "string" || !identity.userId.trim()) {
    throw new Error("A trusted user ID is required");
  }
  return true;
}

function readManagerPayload(job) { return job; }
function route(job) { return "extract"; }
function resolveOutput(job) { return "txt"; }
function countOcrPages(job) { return 0; }
function echoMeta(job) { return {}; }
function inferInputKind(job) { return "pdf"; }
const crypto = require("node:crypto");
