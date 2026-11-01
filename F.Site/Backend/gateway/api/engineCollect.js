import crypto from 'crypto';
import fs from 'fs';
import { Router } from 'express';
import express from 'express';
import { OUTPUT_DIR, abs } from '../../file/paths.js';
import { ENGINE_KEY_RE } from '../generator/engine.js';
import { QueueRejection } from '../queue/processingQueue.js';
import {
  RESULT_MIME,
  acceptsAnalysisResultExtension,
  finalizeAnalysisArtifact,
} from '../queue/analysisFinalize.js';
const SAFE_RESULT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,250}$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const DEFAULT_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_RESULT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TRANSFER_TIMEOUT_MS = 60_000;
function keyMatches(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function refuse(res, status = 403) {
  res.status(status).json({ error: 'Refused' });
  res.socket?.destroy();
}
export function createEngineQueueRouter({
  queue,
  engineToSiteKey = '',
  maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES,
  maxResultBytes = DEFAULT_MAX_RESULT_BYTES,
  transferTimeoutMs = DEFAULT_TRANSFER_TIMEOUT_MS,
  outputDir = abs(`${OUTPUT_DIR}/final`),
  log = console.warn,
} = {}) {
  const router = Router();
  const keyUsable = ENGINE_KEY_RE.test(engineToSiteKey);
  if (!keyUsable) {
    log(
      '[engine-queue] ENGINE_TO_SITE_KEY is not set to 32 hex characters — every Engine ' +
        'call will be refused. The route stays mounted.',
    );
  }
  function keyRefused(req, res) {
    if (keyUsable && keyMatches(req.headers['x-api-key'], engineToSiteKey)) return false;
    refuse(res);
    return true;
  }
  function rejected(res, error) {
    if (!(error instanceof QueueRejection)) return false;
    switch (error.kind) {
      case 'expired':
        res.status(410).json({ error: 'Job token has expired' });
        return true;
      case 'state':
        res.status(409).json({ error: 'Illegal job state for this call' });
        return true;
      default:
        refuse(res);
        return true;
    }
  }
  const JOB_META_FIELDS = [
    'jobToken',
    'formId',
    'submitId',
    'userId',
    'sessionId',
    'filename',
    'extension',
  ];
  function readBodyMeta(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const meta = {};
    for (const field of JOB_META_FIELDS) {
      const value = body[field];
      if (typeof value !== 'string' || !value || value.length > 512) return null;
      meta[field] = value;
    }
    return meta;
  }
  router.post('/', express.json({ limit: '16kb', strict: true }), async (req, res) => {
    if (keyRefused(req, res)) return;
    const meta = readBodyMeta(req.body);
    if (!meta) return res.status(400).json({ error: 'Job metadata is required' });
    let job;
    try {
      job = queue.beginAnalysis(meta);
    } catch (error) {
      if (rejected(res, error)) return;
      throw error;
    }
    let stat;
    try {
      stat = await fs.promises.stat(job.rawPath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      queue.failAnalysis(job.formId, 'Analysis failed');
      return res.status(404).json({ error: 'Source is unavailable' });
    }
    if (stat.size > maxSourceBytes) {
      return res.status(413).json({ error: 'Source exceeds the queue limit' });
    }
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(stat.size),
      'X-Job-Token': job.jobToken,
      'X-Form-Id': job.formId,
      'X-Submit-Id': job.submitId,
      'X-User-Id': job.userId,
      'X-Session-Id': job.sessionId,
      'X-Filename': encodeURIComponent(job.uploadName),
      'X-Requested-Extension': job.requestedExtension,
      'X-Content-Bytes': String(job.rawBytes ?? stat.size),
      'X-Content-SHA256': job.rawSha256 || '',
    });
    const stream = fs.createReadStream(job.rawPath);
    let served = 0;
    const guard = setTimeout(() => {
      stream.destroy(new Error('transfer-time limit reached'));
    }, transferTimeoutMs);
    stream.on('data', (chunk) => {
      served += chunk.length;
      if (served > maxSourceBytes) stream.destroy(new Error('file-size limit reached'));
    });
    stream.on('error', (error) => {
      clearTimeout(guard);
      console.error('[engine-queue] source stream failed', error.message);
      res.socket?.destroy();
    });
    res.on('close', () => clearTimeout(guard));
    stream.pipe(res);
  });
  router.post(
    '/result',
    express.raw({ type: () => true, limit: maxResultBytes }),
    async (req, res) => {
      if (keyRefused(req, res)) return;
      const h = req.headers;
      const meta = {
        jobToken: h['x-job-token'],
        formId: h['x-form-id'],
        submitId: h['x-submit-id'],
        userId: h['x-user-id'],
        sessionId: h['x-session-id'],
        filename: h['x-filename'],
        extension: h['x-extension'],
      };
      for (const value of Object.values(meta)) {
        if (typeof value !== 'string' || !value || value.length > 512) {
          return res.status(400).json({ error: 'Job metadata is required' });
        }
      }
      let job;
      try {
        job = queue.beginAnalysisResult(meta);
      } catch (error) {
        if (rejected(res, error)) return;
        throw error;
      }
      const fail = (message) => {
        queue.failAnalysis(job.formId, 'Analysis failed');
        return res.status(400).json({ error: message });
      };
      const returnedExtension = meta.extension.toLowerCase();
      const requestedExtension = String(job.requestedExtension || '').toLowerCase();
      if (!acceptsAnalysisResultExtension({
        returned: returnedExtension,
        requested: requestedExtension,
        staged: String(job.managerFormat || '').toLowerCase(),
      })) {
        return fail('Result extension does not match the requested extension');
      }
      const declaredName = decodeURIComponent(meta.filename);
      if (!SAFE_RESULT_NAME_RE.test(declaredName) || declaredName.includes('..')) {
        return fail('Invalid result filename');
      }
      const nameExt = declaredName.split('.').pop().toLowerCase();
      if (nameExt !== returnedExtension) {
        return fail('Result filename does not carry the result extension');
      }
      const mime = String(h['x-mime-type'] || '').toLowerCase();
      if (RESULT_MIME.get(returnedExtension) !== mime) {
        return fail('Unsupported result content type');
      }
      if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
        return fail('Empty result body');
      }
      const declaredBytes = Number.parseInt(String(h['x-bytes']), 10);
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes !== req.body.byteLength) {
        return fail('Result byte count mismatch');
      }
      if (req.body.byteLength > maxResultBytes) {
        return fail('Result exceeds the queue limit');
      }
      const digest = crypto.createHash('sha256').update(req.body).digest('hex');
      const declaredSha = String(h['x-sha256'] || '');
      if (!SHA256_RE.test(declaredSha) || declaredSha.toLowerCase() !== digest) {
        return fail('Result digest mismatch');
      }
      let stored;
      try {
        stored = await finalizeAnalysisArtifact({
          job,
          bytes: req.body,
          filename: declaredName,
          returnedExtension,
          outputDir,
        });
      } catch (error) {
        console.error('[engine-queue] artifact store failed', error);
        queue.failAnalysis(job.formId, 'Analysis failed');
        return res.status(500).json({ error: 'Result could not be stored' });
      }
      try {
        queue.completeAnalysis(job.formId, {
          file: stored.file,
          filename: stored.filename,
          mimeType: stored.mimeType || mime,
          bytes: stored.bytes,
          sha256: stored.sha256,
        });
      } catch (error) {
        if (rejected(res, error)) return;
        throw error;
      }
      return res.status(200).json({ ok: true, state: 'FINISHED' });
    },
  );
  return router;
}