// Public API — two guarded routers in front of the engine Bridge.
//
//   handshakeRouter (strict rate limit)  POST /handshake
//     Establishes the session<->engine binding: on success it GENERATES the
//     engine session hash (the YYYYMMDD_HHMMSS_mmm shape getDateTimeHash
//     mints in Bridge/logen.js) from this Express session and pairs it with
//     the signature 'public'. One handshake per session; repeats are 409.
//     No client-supplied hash is ever trusted.
//
//   guardedApi (standard rate limit)     /tokenizer/...
//     Handle-based read-back, valid only inside the session that minted it.
//     Each request calls the single BindEngine entry with the 'public'
//     signature string and { hash, mode }, and awaits the readback in the
//     SAME HTTP response:
//       GET    /tokenizer                 handles owned by this session
//       GET    /tokenizer/:handle         handle metadata
//       GET    /tokenizer/:handle/raw      bridge mode 'raw' (tagged text)
//       GET    /tokenizer/:handle/syllable bridge mode 'syllable' (positions)
//       DELETE /tokenizer/:handle         drop the mapping
//
// Every limiter buckets per client IP; the engine hash -> handle map lives
// ONLY in req.session, so a handle is meaningless outside its own session.
import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { BindEngine } from '../../architecture/bridge/bind-engine.js';

// The signature stamped on every call this API makes into the Bridge. The
// Bridge routes on this field; Site calls will carry signature 'site' plus
// their own (many) job fields.
const PUBLIC_SIGNATURE = 'public';

export const publicRouter = express.Router();
publicRouter.use(express.json({ limit: '16kb', strict: true }));

// Engine hash generator — same contract as Bridge/logen.js getDateTimeHash(),
// mirrored here because the plugin cannot import the (unwired) Bridge. Shape:
// YYYYMMDD_HHMMSS_mmm.
function mintEngineHash() {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const p3 = (n) => String(n).padStart(3, '0');
  return (
    `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
    `_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}_${p3(now.getMilliseconds())}`
  );
}

function sessionState(req) {
  if (!req.session.tokenizer) {
    req.session.tokenizer = { handshake: null, handles: {} };
  }
  return req.session.tokenizer;
}

function lookupHandle(req, res) {
  const entry = sessionState(req).handles[req.params.handle];
  if (!entry) {
    res.status(404).json({ error: 'unknown tokenizer handle for this session' });
    return null;
  }
  return entry;
}

// ── Guard 1: handshake, tight budget (mints the session hash). Route-scoped so
// the strict limiter only touches POST /handshake, never the tokenizer routes.
const handshakeLimit = createRateLimiter({
  windowMs: config.handshakeWindowMs,
  max: config.handshakeMax,
  name: 'handshake',
});

const handshakeRouter = express.Router();
handshakeRouter.post('/handshake', handshakeLimit, async (req, res, next) => {
  try {
    const state = sessionState(req);
    if (state.handshake) {
      return res.status(409).json({
        error: 'session already handshaken',
        handle: state.handshake.handle,
      });
    }

    const engineHash = mintEngineHash();
    const handle = crypto.randomBytes(16).toString('hex');
    const entry = { engineHash, signature: PUBLIC_SIGNATURE, createdAt: Date.now() };
    state.handles[handle] = entry;
    state.handshake = { handle, ...entry };
    return res.status(201).json({ handle, signature: PUBLIC_SIGNATURE, engineHash });
  } catch (err) {
    next(err);
  }
});

// ── Guard 2: tokenizer routes, standard budget. The limiter is mounted on the
// /tokenizer prefix only, so the handshake budget stays fully independent.
const apiLimit = createRateLimiter({
  windowMs: config.apiWindowMs,
  max: config.apiMax,
  name: 'api',
});

const guardedApi = express.Router();
guardedApi.use('/tokenizer', apiLimit);

guardedApi.get('/', (_req, res) =>
  res.status(200).json({ ok: true, api: 'public', endpoints: ['/handshake', '/tokenizer'] }),
);

guardedApi.get('/tokenizer', (req, res) =>
  res.status(200).json({ handshake: sessionState(req).handshake, handles: sessionState(req).handles }),
);

guardedApi.get('/tokenizer/:handle', (req, res) => {
  const entry = lookupHandle(req, res);
  if (!entry) return;
  return res.status(200).json({ handle: req.params.handle, ...entry });
});

// Single-request read-back: hand hash + signature to the Bridge and await its
// result; the Bridge invokes invokeWithHash inside the engine side.
guardedApi.get('/tokenizer/:handle/raw', async (req, res, next) => {
  try {
    const entry = lookupHandle(req, res);
    if (!entry) return;
    const result = await BindEngine(entry.signature, {
      hash: entry.engineHash,
      mode: 'raw',
    });
    return res.status(200).json({
      handle: req.params.handle,
      hash: entry.engineHash,
      signature: entry.signature,
      text: result.text,
    });
  } catch (err) {
    next(err);
  }
});

// Positional syllable read-back (the public contract tokenizer.js documents:
// positions, never finished segmented text).
guardedApi.get('/tokenizer/:handle/syllable', async (req, res, next) => {
  try {
    const entry = lookupHandle(req, res);
    if (!entry) return;
    const result = await BindEngine(entry.signature, {
      hash: entry.engineHash,
      mode: 'syllable',
    });
    return res.status(200).json({
      handle: req.params.handle,
      hash: entry.engineHash,
      signature: entry.signature,
      positions: result.positions,
    });
  } catch (err) {
    next(err);
  }
});

guardedApi.delete('/tokenizer/:handle', (req, res) => {
  const state = sessionState(req);
  if (!state.handles[req.params.handle]) {
    return res.status(404).json({ error: 'unknown tokenizer handle for this session' });
  }
  delete state.handles[req.params.handle];
  if (state.handshake?.handle === req.params.handle) state.handshake = null;
  return res.status(200).json({ deleted: req.params.handle });
});

// Order matters: the strict handshake guard runs before anything else, and all
// tokenizer routes sit behind the standard guard.
publicRouter.use(handshakeRouter);
publicRouter.use(guardedApi);

// Boundary failures arrive as quiet plain strings from BindEngine: at this
// layer they are REFUSALS of the request, never a stop of the web process.
// Engine seam failures (missing Bridge, missing output file) are 503/404,
// never a 200 with empty data.
publicRouter.use((err, _req, res, _next) => {
  if (typeof err === 'string') {
    const status = err.includes('not wired') ? 501 : 400;
    return res.status(status).json({ error: err });
  }
  if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
    return res.status(503).json({ error: 'tokenizer engine seam not wired (engine modules not copied into the plugin yet)' });
  }
  if (err?.code === 'ENOENT') {
    return res.status(404).json({ error: 'no engine output for the mapped hash' });
  }
  return res.status(err?.status ?? 500).json({ error: err?.message ?? 'tokenizer error' });
});
