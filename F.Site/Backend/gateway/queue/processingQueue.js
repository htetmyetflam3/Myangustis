import crypto from 'node:crypto';
import { emitEvent } from '../../../../Bridge/logen/site.js';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
const now = () => new Date().toISOString();
async function snapshot(filePath) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
}
function tokenMatches(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
export const QUEUE_STATES = [
  'RECEIVED',
  'SITE_PROCESSING',
  'SOURCE_READY',
  'ENGINE_ACCEPTED',
  'ANALYSING',
  'FINISHED',
  'FAILED',
  'EXPIRED',
];
/* The column, not the route. `source` says which vocabulary the record uses;
   `route` is the extracting/ocr/null value under whichever label the client
   sent it. Both are kept so nothing downstream has to re-derive either. */
export const isAnalysisRecord = (record) => record?.source === 'analysis';

/* A TASK IS A CIRCLE, AND THE QUEUE TRACKS THE CIRCLE -- NOT THE JOB.
   Upstream may say job:'ocr'; that only names the recovery route. How many
   legs the work has is the task:

     conversion  HALF circle   upload -> parse -> deliver
     analysis    FULL circle   upload -> parse -> Engine -> back -> finalize

   This matters because 'FINISHED' is reached TWICE on a full circle: once
   when the site parse is done (the Engine's source is ready) and again
   when the Engine's answer is stored. Read as a state those are identical;
   read as a leg, the first is PARTIAL and the second closes the circle.

   WHILE THE ENGINE IS NOT WIRED a full circle still has to end somewhere,
   and it ends on the site artifact. That is a decision this queue makes
   and records -- engineRound:'unwired' -- not something that leaks through
   because `state === 'FINISHED' && finalPath` happens to be true. The
   moment an Engine IS configured nothing here has to be undone: the leg is
   owed again instead of settled. */
export const TASK_LEGS = new Map([
  ['conversion', ['site']],
  ['analysis', ['site', 'engine']],
]);

export const taskLegs = (task) => TASK_LEGS.get(task) ?? ['site'];
export const taskCircle = (task) => (taskLegs(task).length > 1 ? 'full' : 'half');

/* How the Engine leg can settle on a full circle:
     'owed'     parsed, the Engine round has not started
     'running'  the Engine holds the source
     'done'     the Engine answered
     'skipped'  given up on; fall back to the site artifact
     'unwired'  no Engine configured, so the site artifact IS the answer
   On a half circle it is null: there is no second leg to settle. */
const ENGINE_SETTLED = new Set(['done', 'skipped', 'unwired']);
const ENGINE_LEG_STATES = new Set(['ENGINE_ACCEPTED', 'ANALYSING']);

/** Which leg this record is on, 1-based. */
export function taskLeg(record) {
  if (!record) return 0;
  if (taskCircle(record.task) === 'half') return 1;
  return ENGINE_LEG_STATES.has(record.state) || record.engineRound === 'done' ? 2 : 1;
}

/** Is the circle closed? A half circle closes at FINISHED; a full circle
 *  also needs the Engine leg settled. */
export function taskComplete(record) {
  if (!record || record.state !== 'FINISHED' || !record.finalPath) return false;
  if (taskCircle(record.task) === 'half') return true;
  return ENGINE_SETTLED.has(record.engineRound);
}

/** FINISHED, but the circle still owes a leg. */
export const taskPartial = (record) => Boolean(record)
  && record.state === 'FINISHED' && !taskComplete(record);
export class QueueRejection extends Error {
  constructor(kind, message) {
    super(message || kind);
    this.kind = kind;
  }
}
export function publicQueueStatus(record) {
  if (!record) return null;
  return {
    submitId: record.submitId,
    state: record.state,
    // The task view: one query answers "which leg of what, and is it closed".
    task: record.task,
    circle: taskCircle(record.task),
    leg: { index: taskLeg(record), of: taskLegs(record.task).length,
      name: taskLegs(record.task)[taskLeg(record) - 1] ?? null },
    partial: taskPartial(record),
    complete: taskComplete(record),
    engineRound: record.engineRound ?? null,
    finalFilename: record.finalFilename,
    finalBytes: record.finalBytes,
    // Only a closed circle is downloadable. On a full circle, FINISHED
    // after the site leg is an intermediate artifact, not the answer.
    downloadUrl:
      taskComplete(record) && record.submitId
        ? `/api/submit/file/${encodeURIComponent(record.submitId)}`
        : null,
    error: record.error,
  };
}

export function createProcessingQueue({
  max = 500,
  ttlMs = 24 * 60 * 60 * 1000,
  metadataStore = null,
  randomBytes = crypto.randomBytes,
  /* The composed parser (backend/file/parser.js), which resolves the saved
     path, the extension and the analysis variant before handing off to the
     manager. The QUEUE calls it: it owns the record, so it should own the
     transition that fills the record in. The HTTP route used to parse and
     then tell the queue what had happened, which let the two disagree.
     Nothing here touches a worker directly -- the manager owns the threads
     and the lanes; the queue only ever asks the manager. */
  parseFile = null,
  /* Asked once per finished parse, never cached: wiring an Engine must
     take effect for the next upload without restarting anything. */
  engineWired = () => false,
} = {}) {
  const records = new Map();
  const bySubmitId = new Map();
  function discard(id, record) {
    records.delete(id);
    if (record.submitId) bySubmitId.delete(record.submitId);
    if (record.engineTimer) clearTimeout(record.engineTimer);
    const files = new Set(
      [record.inputPath, record.rawPath, record.originalPath, record.finalPath].filter(Boolean),
    );
    for (const file of files) fs.unlink(file).catch(() => {});
  }
  function prune() {
    const cutoff = Date.now() - ttlMs;
    for (const [id, record] of records) {
      if (Date.parse(record.queuedAt) < cutoff) discard(id, record);
    }
    while (records.size >= max) {
      const [id, record] = records.entries().next().value;
      discard(id, record);
    }
  }
  function clone(record) {
    if (!record) return null;
    const snapshotFields = { ...record };
    delete snapshotFields.engineTimer;
    return structuredClone(snapshotFields);
  }
  async function enqueue({ formId, userId, sessionId, clientIp, intent, file, inputPath }) {
    prune();
    if (records.has(formId)) throw new Error('Processing queue already contains this formId');
    const measured = await snapshot(inputPath);
    const record = {
      formId,
      submitId: null,
      userId: String(userId),
      sessionId,
      clientIp: String(clientIp || ''),
      source: intent.source,
      /* Two different things both spelled "task", kept apart on purpose:
           task  the CIRCLE this queue tracks -- conversion or analysis
           mode  the analysis column's own label for default|manual, which
                 is what the client sent and what the Engine is told */
      task: intent.source === 'analysis' ? 'analysis' : 'conversion',
      mode: intent.source === 'analysis' ? (intent.task ?? null) : (intent.method ?? null),
      engineRound: intent.source === 'analysis' ? 'owed' : null,
      job: intent.job ?? null,
      method: intent.method ?? null,
      route: intent.source === 'analysis' ? intent.task : intent.job,
      outputFormat: intent.outputFormat,
      requestedExtension: intent.outputFormat,
      requestMetadata: structuredClone(intent),
      originalName: intent.originalName,
      uploadName: intent.uploadName,
      managerFilename: null,
      finalFilename: null,
      inputPath,
      inputMimeType: file.mimetype || 'application/octet-stream',
      inputFormat: intent.inputFormat,
      inputBytes: measured.bytes,
      inputSha256: measured.sha256,
      uploadedAt: intent.clickedAt || now(),
      queuedAt: now(),
      managerQueuedAt: null,
      managerStartedAt: null,
      managerFinishedAt: null,
      managerPath: null,
      managerMimeType: null,
      managerFormat: null,
      managerBytes: null,
      managerSha256: null,
      lineCount: null,
      textChars: null,
      textBytes: null,
      pageCount: null,
      encodingCounts: null,
      rawPath: null,
      rawBytes: null,
      rawSha256: null,
      originalPath: null,
      jobToken: null,
      engineAcceptedAt: null,
      engineExpiresAt: null,
      engineTimer: null,
      engineServed: false,
      analysisStartedAt: null,
      analysisFinishedAt: null,
      finalPath: null,
      finalMimeType: null,
      finalBytes: null,
      finalSha256: null,
      readyAt: null,
      deliveredAt: null,
      state: 'RECEIVED',
      error: null,
    };
    records.set(formId, record);
    return clone(record);
  }
  function recordFor(formId) {
    const record = records.get(formId);
    if (!record) throw new QueueRejection('unknown', 'Processing queue record not found');
    return record;
  }
  function mutate(formId, fn) {
    const record = recordFor(formId);
    fn(record);
    return clone(record);
  }
  
  function bindEngineCall(meta, { checkFilename = true, checkExtension = true } = {}) {
    const record = records.get(meta.formId);
    if (!record) throw new QueueRejection('unknown', 'Unknown processing job');
    if (Date.now() > Date.parse(record.engineExpiresAt || 0)) {
      if (record.state === 'ENGINE_ACCEPTED' || record.state === 'ANALYSING') {
        record.state = 'EXPIRED';
        record.error = 'Analysis job expired';
      }
      throw new QueueRejection('expired', 'Job token has expired');
    }
    const binds =
      tokenMatches(meta.jobToken, record.jobToken) &&
      String(meta.submitId) === String(record.submitId) &&
      String(meta.userId) === String(record.userId) &&
      String(meta.sessionId) === String(record.sessionId) &&
      (!checkFilename || String(meta.filename) === String(record.uploadName)) &&
      (!checkExtension || String(meta.extension) === String(record.requestedExtension));
    if (!binds) throw new QueueRejection('mismatch', 'Job metadata mismatch');
    return record;
  }
  const api = {
    enqueue,
    /**
     * Run the parse for a queued record, through the manager.
     *
     * One call owns the whole site leg: mark started, dispatch, record the
     * artifact. A failure marks the record failed before rethrowing, so the
     * visitor polling it always sees a terminal state.
     */
    useParser(fn) {
      parseFile = fn;
      return api;
    },
    async runManager(formId, { file, intent, savedPath }) {
      if (typeof parseFile !== 'function') {
        throw new QueueRejection('config', 'No parser wired to the queue');
      }
      api.managerStarted(formId);
      const handoff = {};
      try {
        const parsed = await parseFile(file, handoff, { intent, savedPath });
        if (!handoff.manager?.file) throw new Error('Parser completed without an artifact');
        await api.managerFinished(formId, handoff.manager);
        return { ...parsed, manager: handoff.manager };
      } catch (error) {
        error.artifactPath = handoff.manager?.file ?? null;
        throw error;
      }
    },
    managerQueued(formId) {
      return mutate(formId, (r) => {
        r.state = 'SITE_PROCESSING';
        r.managerQueuedAt = now();
      });
    },
    managerStarted(formId) {
      return mutate(formId, (r) => {
        r.state = 'SITE_PROCESSING';
        r.managerStartedAt = now();
      });
    },
    async managerFinished(formId, result) {
      const measured = await snapshot(result.file);
      return mutate(formId, (r) => {
        r.state = 'SOURCE_READY';
        r.managerFinishedAt = now();
        r.managerPath = result.file;
        r.managerFilename = result.filename || result.file.split(/[\\/]/).pop();
        r.managerMimeType = result.mimeType || 'application/octet-stream';
        r.managerFormat = result.output;
        r.managerBytes = measured.bytes;
        r.managerSha256 = measured.sha256;
        r.lineCount = result.lineCount ?? null;
        r.textChars = result.textChars ?? null;
        r.textBytes = result.textBytes ?? null;
        r.pageCount = result.pages ?? result.pageCount ?? null;
        r.encodingCounts = result.counts ? structuredClone(result.counts) : null;
        /* One event per document, carrying only what is not already on this
           record for a reader to look up. The praser stays silent otherwise:
           per-syllable logging is what made the old engine log unusable. */
        emitEvent('parsed', {
          file: r.managerFilename,
          originalName: r.originalName,
          chars: r.textChars,
          lines: r.lineCount,
        });
      });
    },
    
    /** The upload endpoint answers the visitor with a submitId BEFORE the
        parse runs; this makes the record pollable from the first moment.
        bindSavedResult later re-binds the same id when the raw file lands. */
    assignSubmitId(formId, submitId) {
      return mutate(formId, (r) => {
        if (r.submitId && r.submitId !== submitId) {
          throw new QueueRejection('state', 'Submit id already assigned');
        }
        r.submitId = submitId;
        bySubmitId.set(submitId, formId);
      });
    },
    async bindSavedResult(
      formId,
      { submitId, filename, bridgePath, originalPath = null },
    ) {
      const record = recordFor(formId);
      const raw = bridgePath ? await snapshot(bridgePath) : { bytes: null, sha256: null };
      if (metadataStore) {
        await metadataStore.finalizeUpload({
          userId: record.userId,
          visitorHash: record.sessionId,
          formId,
          submitId,
          filename,
          bridgePath,
          originalName: record.originalName,
        });
      }
      return mutate(formId, (r) => {
        r.submitId = submitId;
        r.rawPath = bridgePath || null;
        r.rawBytes = raw.bytes;
        r.rawSha256 = raw.sha256;
        r.originalPath = originalPath;
        r.state = 'SOURCE_READY';
        bySubmitId.set(submitId, formId);
      });
    },
    async ready(formId, { file, filename, mimeType }) {
      const measured = await snapshot(file);
      return mutate(formId, (r) => {
        /* The site leg is done. On a full circle the Engine leg is now
           owed -- unless there is no Engine, in which case the circle
           closes here, deliberately and on the record. */
        if (taskCircle(r.task) === 'full' && !engineWired()) {
          r.engineRound = 'unwired';
          r.engineNote = 'No Engine configured; the site artifact is the result.';
        }
        r.state = 'FINISHED';
        r.finalPath = file;
        r.finalFilename = filename || file.split(/[\\/]/).pop();
        r.finalMimeType = mimeType || 'application/octet-stream';
        r.finalBytes = measured.bytes;
        r.finalSha256 = measured.sha256;
        r.readyAt = now();
      });
    },
    delivered(formId) {
      return mutate(formId, (r) => {
        r.deliveredAt = now();
      });
    },
    fail(formId, publicMessage = 'Processing failed') {
      return mutate(formId, (r) => {
        if (r.engineTimer) clearTimeout(r.engineTimer);
        r.state = 'FAILED';
        r.error = String(publicMessage || 'Processing failed');
      });
    },
    
    mintAnalysisToken(formId, { ttlMs }) {
      const record = recordFor(formId);
      if (!isAnalysisRecord(record)) {
        throw new QueueRejection('state', 'Submission is not an analysis submission');
      }
      if (record.state !== 'FINISHED') {
        throw new QueueRejection(
          'state',
          `Job state ${record.state} cannot start an Engine round`,
        );
      }
      const token = randomBytes(16).toString('hex');
      record.jobToken = token;
      record.engineServed = false;
      record.engineAcceptedAt = now();
      record.engineExpiresAt = new Date(Date.now() + ttlMs).toISOString();
      record.analysisStartedAt = null;
      record.analysisFinishedAt = null;
      record.error = null;
      record.state = 'ENGINE_ACCEPTED';
      if (record.engineTimer) clearTimeout(record.engineTimer);
      record.engineTimer = setTimeout(() => {
        const current = records.get(formId);
        if (
          current &&
          (current.state === 'ENGINE_ACCEPTED' || current.state === 'ANALYSING')
        ) {
          current.state = 'EXPIRED';
          current.error = 'Analysis job expired';
        }
      }, ttlMs);
      record.engineTimer.unref();
      return token;
    },
    
    abortAnalysis(formId, message = 'Analysis service is unavailable') {
      const record = recordFor(formId);
      if (record.state === 'ENGINE_ACCEPTED') {
        if (record.engineTimer) clearTimeout(record.engineTimer);
        // Giving up on the Engine closes the circle on the site artifact.
        record.engineRound = 'skipped';
        record.state = 'FINISHED';
      }
      record.jobToken = null;
      record.error = String(message);
      return clone(record);
    },
    failAnalysis(formId, message = 'Analysis failed') {
      const record = recordFor(formId);
      if (record.state !== 'ENGINE_ACCEPTED' && record.state !== 'ANALYSING') {
        return clone(record);
      }
      if (record.engineTimer) clearTimeout(record.engineTimer);
      record.state = 'FAILED';
      record.error = String(message);
      return clone(record);
    },
    
    beginAnalysis(meta) {
      const record = bindEngineCall(meta);
      if (record.state !== 'ENGINE_ACCEPTED' || record.engineServed) {
        throw new QueueRejection('state', 'Source was already retrieved for this job');
      }
      record.state = 'ANALYSING';
      record.engineRound = 'running';
      record.engineServed = true;
      record.analysisStartedAt = now();
      return clone(record);
    },
    
    beginAnalysisResult(meta) {
      const record = bindEngineCall(meta, { checkFilename: false, checkExtension: false });
      if (record.state !== 'ANALYSING' || !record.engineServed) {
        throw new QueueRejection('state', 'Job is not awaiting an Engine result');
      }
      return clone(record);
    },
    
    completeAnalysis(formId, { file, filename, mimeType, bytes, sha256 }) {
      const record = recordFor(formId);
      if (record.state !== 'ANALYSING') {
        throw new QueueRejection('state', 'Job is not awaiting an Engine result');
      }
      if (record.engineTimer) clearTimeout(record.engineTimer);
      record.jobToken = null;
      record.finalPath = file;
      record.finalFilename = filename;
      record.finalMimeType = mimeType || 'application/octet-stream';
      record.finalBytes = bytes;
      record.finalSha256 = sha256;
      record.analysisFinishedAt = now();
      record.readyAt = now();
      record.error = null;
      record.engineRound = 'done';
      record.state = 'FINISHED';
      return clone(record);
    },
    getByFormId(formId) {
      return clone(records.get(formId));
    },
    getBySubmitId(submitId) {
      const formId = bySubmitId.get(submitId);
      return formId ? this.getByFormId(formId) : null;
    },
    dispose() {
      for (const record of records.values()) {
        if (record.engineTimer) clearTimeout(record.engineTimer);
      }
    },
  };
  return api;
}