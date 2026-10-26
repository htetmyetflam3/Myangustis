import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createParser } from '../../file/parser.js';
import { createPdfParser, createDocxParser } from '../../file/praser.js';
import {
  createPdfAnalysisParser,
  createDocxAnalysisParser,
} from '../../file/pdfanalysis.js';
import { createSaveOriginal, deleteStoredFile } from '../../file/saveOriginfile.js';
import { OUTPUT_DIR, QUARANTINE_DIR, abs } from '../../file/paths.js';
import { createTextHolder } from '../text/content.js';
import { createRawSaver, cleanupRawResult } from '../generator/rawSaver.js';
import { createInputHandler } from '../proxy/requestHandler.js';
import {
  readUploadMetadata,
  validateUploadedFileSignature,
} from './uploadMetadata.js';
import {
  createProcessingQueue,
  publicQueueStatus,
  taskComplete,
} from '../queue/processingQueue.js';

/** Bounds how many parses (text extraction or OCR) run at once. The upload
 *  endpoint accepts and answers immediately, so the parse work is bounded
 *  here instead of by the request-concurrency middleware. */
export function createSlotLimiter(max) {
  const limit = Number.isSafeInteger(max) && max >= 1 ? max : 2;
  let active = 0;
  const waiting = [];
  return {
    acquire: () =>
      new Promise((resolve) => {
        if (active < limit) {
          active += 1;
          return resolve();
        }
        waiting.push(resolve);
      }),
    release: () => {
      const next = waiting.shift();
      if (next) return next(); // the slot is handed over, occupancy unchanged
      active = Math.max(0, active - 1);
    },
  };
}

export const MAX_TEXT_INPUT_CHARS = Number.parseInt(
  process.env.MAX_TEXT_INPUT_CHARS || '1000000',
  10,
);
if (
  !Number.isSafeInteger(MAX_TEXT_INPUT_CHARS) ||
  MAX_TEXT_INPUT_CHARS < 1 ||
  MAX_TEXT_INPUT_CHARS > 10_000_000
) {
  throw new Error('MAX_TEXT_INPUT_CHARS must be an integer from 1 to 10000000');
}


export const JSON_BODY_LIMIT_BYTES = MAX_TEXT_INPUT_CHARS * 4 + 64 * 1024;

class ClientError extends Error {
  constructor(status, message, options) {
    super(message, options);
    this.status = status;
    this.publicMessage = message;
  }
}
function publicParserFailure(error) {
  let current = error;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.cause) {
    const message = String(current.message || '');
    const pageCap = message.match(/PDF exceeds the (\d+) page cap/i);
    if (pageCap) return `PDF exceeds the ${pageCap[1]}-page processing limit`;
    if (/worker exceeded \d+ ms/i.test(message)) {
      return 'Document processing timed out; split the file into smaller parts and try again';
    }
    if (/no text found/i.test(message)) {
      return 'No extractable text was found; the document may require OCR';
    }
    if (/heap|out of memory|allocation failed/i.test(message)) {
      return 'Document processing exceeded the memory limit; split the file into smaller parts';
    }
  }
  return 'Uploaded file could not be parsed';
}
const maybeUpload = (upload) => (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  ct.includes('multipart/form-data')
    ? upload.single('file')(req, res, next)
    : next();
};
function isInsideOutput(filePath) {
  const output = abs(OUTPUT_DIR);
  const relative = path.relative(output, path.resolve(filePath));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
export function createIncomingRouter({
  upload,
  db: _db,
  request,
  artifactTtlMs,
  queue = null,
  hiddenProcessor = null,
  parseCapacity = null,
}) {
  const processingQueue =
    queue ||
    createProcessingQueue({
      metadataStore: request,
      ...(artifactTtlMs ? { ttlMs: artifactTtlMs } : {}),
    });
  const parseSlots = parseCapacity || createSlotLimiter(2);
  const saveOriginal = createSaveOriginal({ quarantineDir: QUARANTINE_DIR });
  const parser = createParser({
    saveOriginal,
    pdfParser: createPdfParser().parse,
    docxParser: createDocxParser().parse,
    analysisPdfParser: createPdfAnalysisParser().parse,
    analysisDocxParser: createDocxAnalysisParser().parse,
  });
  // The queue is the one that calls the manager; it needs the composed parser.
  processingQueue.useParser?.(parser);
  const inputHandler = createInputHandler({
    textHolder: createTextHolder(),
    metadataGuard: request,
    rawSaver: createRawSaver(),
  });
  const router = Router();
  async function preBodyQuota(req, res, next) {
    try {
      const quota = await request.checkQuota({ userId: req.userId });
      if (!quota.allowed) {
        return res.status(429).json({ error: 'Quota exceeded', remaining: 0 });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  }
  router.post('/', preBodyQuota, maybeUpload(upload), async (req, res) => {
    let queueFormId = null;
    let quarantinePath = null;
    let rawResult = null;
    try {
      const source = req.file ? 'file' : 'text';
      let uploadMetadata = null;
      try {
        uploadMetadata = readUploadMetadata(req.body, req.file || null);
      } catch (error) {
        throw new ClientError(400, error.message, { cause: error });
      }
      if (req.file) {
        try {
          await validateUploadedFileSignature(req.file);
        } catch (error) {
          throw new ClientError(400, 'Uploaded file signature is invalid', { cause: error });
        }
      } else {
        const text = req.body?.text;
        if (typeof text !== 'string' || text.length === 0) {
          throw new ClientError(400, 'No text provided');
        }
        if (text.length > MAX_TEXT_INPUT_CHARS) {
          throw new ClientError(413, 'Text submission is too large');
        }
      }

      const consumed = await request.consumeQuota({ userId: req.userId });
      if (!consumed.allowed) {
        throw new ClientError(429, 'Quota exceeded');
      }
      
      

      const formId = await request.createUploadSession({
        userId: req.userId,
        visitorHash: req.visitorHash,
        source,
      });
      queueFormId = formId;
      if (req.file) {
        // ------------------------------------------------------------------
        // ACCEPT: save the original, enqueue the job under a submitId the
        // visitor can already poll, and answer NOW. Parsing a scanned
        // document can take minutes (OCR); no proxy or browser tolerates a
        // POST held open that long, so the heavy work continues detached
        // and the status endpoint tells the story.
        // ------------------------------------------------------------------
        const submitId = crypto.randomUUID();
        const savedPath = await saveOriginal(req.file);
        quarantinePath = savedPath;
        await processingQueue.enqueue({
          formId,
          userId: req.userId,
          sessionId: req.visitorHash,
          clientIp: req.edge?.ip || req.ip || req.socket?.remoteAddress,
          intent: uploadMetadata,
          file: req.file,
          inputPath: savedPath,
        });
        processingQueue.assignSubmitId(formId, submitId);
        processingQueue.managerQueued(formId);
        const publicProcessing = publicQueueStatus(processingQueue.getByFormId(formId));
        res.status(202).json({
          formId,
          submitId,
          remaining: consumed.remaining,
          ...(Number.isInteger(consumed.limit) ? { limit: consumed.limit } : {}),
          status: publicProcessing?.state ?? 'RECEIVED',
          ...(publicProcessing ? { processing: publicProcessing } : {}),
        });
        quarantinePath = null; // ownership moves to the detached task below
        // ------------------------------------------------------------------
        // PROCESS: detached. Every failure lands on the queue record the
        // visitor is already polling -- the upload itself was accepted.
        // ------------------------------------------------------------------
        (async () => {
          const praserJob = {};
          let artifactPath = null;
          let raw = null;
          let pendingQuarantine = savedPath;
          await parseSlots.acquire();
          try {
            // The queue calls the manager. This route no longer parses and
            // then reports; it asks the owner of the record to do both.
            let parsed;
            try {
              parsed = await processingQueue.runManager(formId, {
                file: req.file,
                intent: uploadMetadata,
                savedPath,
              });
            } catch (error) {
              artifactPath = error.artifactPath || null;
              throw new ClientError(422, publicParserFailure(error), { cause: error });
            }
            praserJob.manager = parsed.manager;
            artifactPath = parsed.manager.file;
            raw = await inputHandler({
              req,
              formId,
              parsedText: parsed.textContent,
              quarantinePath: parsed.savedPath,
              submitId,
            });
            pendingQuarantine = null; // rawSaver moved it into ORIGINAL_DIR
            await processingQueue.bindSavedResult(formId, {
              submitId: raw.submitId,
              filename: raw.filename,
              bridgePath: raw.rawPath,
              originalPath: raw.originalPath,
            });
            await processingQueue.ready(formId, {
              file: praserJob.manager.file,
              filename: `${path.parse(uploadMetadata.uploadName).name}.${praserJob.manager.output}`,
              mimeType: praserJob.manager.mimeType,
            });
            if (hiddenProcessor && uploadMetadata?.source === 'analysis') {
              Promise.resolve(hiddenProcessor({ formId })).catch((error) =>
                console.error('[incoming] hidden analysis invocation failed', error),
              );
            }
          } catch (error) {
            console.error('[incoming] background parse failed', error);
            await Promise.allSettled([
              deleteStoredFile(req.file?.path),
              deleteStoredFile(pendingQuarantine),
              deleteStoredFile(artifactPath),
              cleanupRawResult(raw),
            ]);
            if (processingQueue.getByFormId(formId)) {
              processingQueue.fail(formId, error.publicMessage || 'Processing failed');
            }
            try {
              await request.failUpload({
                userId: req.userId,
                formId,
              });
            } catch (dbError) {
              console.error('[incoming] failed to mark submission failed', dbError);
            }
          } finally {
            parseSlots.release();
          }
        })().catch((error) => console.error('[incoming] parse task crashed', error));
        return;
      }
      // Text submissions have no Praser round, but they still enter the same
      // metadata-backed queue record. The hidden Engine contract only accepts
      // jobs it can bind to queue metadata; a raw text body without metadata is
      // deliberately refused above.
      rawResult = await inputHandler({
        req,
        formId,
        parsedText: null,
        quarantinePath: null,
      });
      await processingQueue.enqueue({
        formId,
        userId: req.userId,
        sessionId: req.visitorHash,
        clientIp: req.edge?.ip || req.ip || req.socket?.remoteAddress,
        intent: uploadMetadata,
        file: { mimetype: 'text/plain' },
        inputPath: rawResult.rawPath,
      });
      processingQueue.assignSubmitId(formId, rawResult.submitId);
      processingQueue.managerQueued(formId);
      processingQueue.managerStarted(formId);
      await processingQueue.managerFinished(formId, {
        file: rawResult.rawPath,
        filename: rawResult.filename,
        output: 'txt',
        mimeType: 'text/plain; charset=utf-8',
        lineCount: String(req.body.text).split(/\r\n|\r|\n/).length,
        textChars: String(req.body.text).length,
        textBytes: Buffer.byteLength(String(req.body.text), 'utf8'),
      });
      await processingQueue.bindSavedResult(formId, {
        submitId: rawResult.submitId,
        filename: rawResult.filename,
        bridgePath: rawResult.rawPath,
      });
      await processingQueue.ready(formId, {
        file: rawResult.rawPath,
        filename: rawResult.filename,
        mimeType: 'text/plain; charset=utf-8',
      });
      if (hiddenProcessor && uploadMetadata?.source === 'analysis') {
        Promise.resolve(hiddenProcessor({ formId })).catch((error) =>
          console.error('[incoming] hidden analysis invocation failed', error),
        );
      }
      const publicProcessing = publicQueueStatus(processingQueue.getByFormId(formId));
      res.status(202).json({
        formId,
        submitId: rawResult.submitId,
        text: req.body.text,
        remaining: consumed.remaining,
        ...(Number.isInteger(consumed.limit) ? { limit: consumed.limit } : {}),
        status: publicProcessing?.state ?? 'FINISHED',
        ...(publicProcessing ? { processing: publicProcessing } : {}),
      });
      return;
    } catch (error) {
      console.error('[incoming]', error);
      await Promise.allSettled([
        deleteStoredFile(req.file?.path),
        deleteStoredFile(quarantinePath),
        cleanupRawResult(rawResult),
      ]);
      if (queueFormId && processingQueue.getByFormId(queueFormId)) {
        processingQueue.fail(queueFormId, 'Processing failed');
      }
      if (queueFormId) {
        try {
          await request.failUpload({
            userId: req.userId,
            formId: queueFormId,
          });
        } catch (dbError) {
          console.error('[incoming] failed to mark submission failed', dbError);
        }
      }
      const status = Number.isInteger(error.status) ? error.status : 500;
      const message = error.publicMessage || 'Submission processing failed';
      return res.status(status).json({ error: message });
    }
  });
  router.get('/status/:submitId', (req, res) => {
    const record = processingQueue.getBySubmitId(req.params.submitId);
    if (!record) return res.status(404).json({ error: 'Processing job not found' });
    if (record.userId !== String(req.userId) || record.sessionId !== req.visitorHash) {
      return res.status(403).json({ error: 'Processing job metadata mismatch' });
    }
    return res.json(publicQueueStatus(record));
  });
  router.get('/file/:submitId', (req, res, next) => {
    const record = processingQueue.getBySubmitId(req.params.submitId);
    if (!record) return res.status(404).json({ error: 'Processing job not found' });
    if (record.userId !== String(req.userId) || record.sessionId !== req.visitorHash) {
      return res.status(403).json({ error: 'Processing job metadata mismatch' });
    }
    // A full circle reaches FINISHED twice; only the closed one is the answer.
    if (!taskComplete(record)) {
      return res.status(409).json({ error: 'Processing file is not ready', state: record.state });
    }
    const filePath = path.resolve(record.finalPath);
    if (!isInsideOutput(filePath) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Processing file is unavailable' });
    }
    processingQueue.delivered(record.formId);
    const filename = path.basename(record.finalFilename || `${record.submitId}.txt`);
    return res.download(filePath, filename, { dotfiles: 'allow' }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });
  return router;
}