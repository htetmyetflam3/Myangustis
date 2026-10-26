#!/usr/bin/env node
// standalone-web — self-contained express front for the native Engine/main.
//
// Gen2 job contract (Site/Backend/gateway/generator/engine.js dispatcher):
//
//   POST /job   x-api-key: SITE_TO_ENGINE_KEY (32 hex)
//               JSON: jobToken, formId, submitId, userId, sessionId, filename,
//                     extension, method, task, job
//               -> fast 2xx accept (Site's accept timeout is 3 s); the actual
//                  work happens on a background worker.
//   GET /health open liveness probe.
//
// Worker per accepted job (engine-initiated, Site queue is the authority):
//   pullSource -> native pipeline -> pushResult, see site-client.mjs.
//
// Run:  node Engine/host/server.mjs
// express resolves from the workspace root node_modules (root package.json
// already declares express; Engine/main/package.json does too).
import express from 'express';
import { config, keyShape, timingSafeEq } from './config.mjs';
import { JobStore, SlotLimiter, JOB_STATES } from './job-store.mjs';
import { pullSource, pushResult, SiteClientError } from './site-client.mjs';
import { runEngineJob } from './runner/engine-runner.mjs';

const DISPATCH_FIELDS = ['jobToken', 'formId', 'submitId', 'userId', 'sessionId', 'filename', 'extension', 'method', 'task', 'job'];
// The 7 fields the Site queue re-validates as non-empty strings on pull/push.
const META_FIELDS = ['jobToken', 'formId', 'submitId', 'userId', 'sessionId', 'filename', 'extension'];

const store = new JobStore({ max: config.jobStoreMax, ttlMs: config.jobTimeoutMs });
const slots = new SlotLimiter(config.maxConcurrent);

// ── validating layer (ported from the staging api-server.js gate) ──
// Three checks, fail closed: (1) a usable inbound key exists and the
// presented x-api-key matches it timing-safely; (2) the caller's socket IP
// is on config.allowedIps; (3) when the caller sends Origin/Referer its
// host must be on config.allowedOrigins — server-to-server fetches send
// neither, so key + IP alone gate them. /health stays open.
function originHost(req) {
  const raw = req.headers.origin || req.headers.referer || '';
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return String(raw).replace(/^https?:\/\//, '').split('/')[0];
  }
}

function gate(req) {
  if (keyShape(config.siteToEngineKey) !== 'ok') {
    return { ok: false, reason: 'engine has no usable SITE_TO_ENGINE_KEY configured (fail closed)' };
  }
  if (!timingSafeEq(req.headers['x-api-key'] ?? '', config.siteToEngineKey)) {
    return { ok: false, reason: 'Refused' };
  }
  const ip = req.socket?.remoteAddress || '';
  const ipOk = [...config.allowedIps].some((a) => ip === a || ip === `::ffff:${a}`);
  if (!ipOk) return { ok: false, reason: 'caller ip not allowed' };
  const host = originHost(req);
  if (host !== null && !config.allowedOrigins.has(host)) {
    return { ok: false, reason: 'origin/domain not allowed' };
  }
  return { ok: true };
}

function gated(req, res, next) {
  const g = gate(req);
  if (!g.ok) return res.status(403).json({ error: g.reason });
  next();
}

function validateJobBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'JSON job body required' };
  }
  const metadata = {};
  for (const field of DISPATCH_FIELDS) metadata[field] = body[field] ?? null;
  const badMeta = META_FIELDS.filter(
    (k) => typeof metadata[k] !== 'string' || !metadata[k] || metadata[k].length > 512,
  );
  if (badMeta.length) return { error: `missing or invalid job metadata: ${badMeta.join(', ')}` };
  if (store.get(metadata.jobToken)) return { error: 'jobToken already accepted', status: 409 };
  // One active engine round per file: refuse when a preceding request for the
  // same formId is still PENDING/RUNNING. Terminal rounds allow a fresh round
  // (the Site mints a new jobToken for it).
  const predecessor = store.activeByFormId(metadata.formId);
  if (predecessor) {
    return {
      error: `a preceding job for formId ${metadata.formId} is still ${predecessor.state}`,
      status: 409,
    };
  }
  return { metadata };
}

async function processJob(record) {
  await slots.acquire();
  try {
    store.update(record.jobToken, { state: JOB_STATES.RUNNING });
    const { text } = await pullSource(record);
    const artifact = await runEngineJob({ record, sourceText: text });
    const ack = await pushResult(record, artifact);
    store.update(record.jobToken, { state: JOB_STATES.DONE, finishedAt: Date.now(), siteAck: ack });
    console.log(`[standalone-web] DONE ${record.submitId} (${record.jobToken}) -> ${artifact.filename} ${artifact.bytes.length} B`);
  } catch (err) {
    const terminal = err instanceof SiteClientError ? err.terminal : true;
    store.update(record.jobToken, {
      state: JOB_STATES.FAILED,
      error: err.message,
      terminal,
      failedAt: Date.now(),
    });
    console.error(`[standalone-web] FAILED ${record.submitId} (${record.jobToken}): ${err.message}`);
  } finally {
    slots.release();
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb', strict: true }));

  app.get('/health', (_req, res) =>
    res.status(200).json({ ok: true, service: 'engine-standalone-web', port: config.port }),
  );

  // Fail closed: a gate that cannot validate must never open.
  app.post('/job', gated, (req, res) => {
    const { metadata, error, status } = validateJobBody(req.body);
    if (error) return res.status(status ?? 400).json({ error });

    const record = store.accept(metadata);
    // Fire-and-forget: the dispatcher only waits for this accept, never for
    // the pipeline. Results come back through the Site queue's /result route.
    processJob(record).catch((err) => {
      console.error('[standalone-web] worker crashed:', err);
      store.update(record.jobToken, { state: JOB_STATES.FAILED, error: err.message, terminal: true });
    });
    return res.status(202).json({ accepted: true, jobToken: record.jobToken, state: record.state });
  });

  // Diagnostics for the operator (same gate as /job); never exposed to the Site.
  app.get('/jobs', gated, (_req, res) => res.status(200).json({ jobs: store.snapshot() }));

  app.use((err, _req, res, _next) => res.status(err.status ?? 400).json({ error: err.message }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

export function startServer(port = config.port) {
  const app = createApp();
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[standalone-web] listening on http://0.0.0.0:${port}`);
    console.log('[standalone-web] routes: GET /health (open) - POST /job (keyed) - GET /jobs (keyed)');
    console.log(
      keyShape(config.siteToEngineKey) === 'ok'
        ? '[standalone-web] inbound gate ON (SITE_TO_ENGINE_KEY 32 hex)'
        : '[standalone-web] inbound gate FAIL-CLOSED — set SITE_TO_ENGINE_KEY',
    );
    console.log(
      `[standalone-web] gate allowlists — ips: ${[...config.allowedIps].join(' ') || '(none)'} | origins: ${[...config.allowedOrigins].join(' ') || '(none)'}`,
    );
    console.log(
      config.siteQueueUrl
        ? `[standalone-web] Site queue: ${config.siteQueueUrl} (key ${keyShape(config.engineToSiteKey)})`
        : '[standalone-web] SITE_QUEUE_URL unset — outbound pull/push dormant',
    );
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) startServer();
