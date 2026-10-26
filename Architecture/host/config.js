// standalone-web configuration — all Gen2 knobs, env-driven, no secrets in code.
//
// Env vocab mirrors Site/Backend/gateway/generator/engine.js + engineCollect.js:
//   PORT                     listen port (default 9000), bound on 0.0.0.0
//   FSM_MOUNT                legacy handshake mount (default /fsm)
//   SITE_PORT                caller Site web port (default 3000)
//   SITE_TO_ENGINE_KEY       32-hex key Site sends as x-api-key on POST /job
//   ENGINE_TO_SITE_KEY       32-hex key this service sends back to the Site queue
//   SITE_QUEUE_URL           Site engine-queue base (mounted at
//                            /api/internal/engine/queue in the Site branch)
//   ENGINE_ACCEPT_TIMEOUT_MS how long Site waits for the /job accept (Site default 3000)
//   ENGINE_JOB_TIMEOUT_MS    jobToken TTL on the Site side (Site default 120000)
//   ENGINE_PULL_RETRY_MS     wait between 404 "source not ready" retries
//   ENGINE_MAX_CONCURRENT    in-process pipeline slots (Site upload side uses 2)
//   ENGINE_ALLOWED_IPS       comma list of socket IPs admitted past the gate;
//                            unset = loopback only (explicit value wins verbatim)
//   ENGINE_ALLOWED_ORIGINS   comma list of Origin/Referer hosts; checked only
//                            when the caller sends one (s2s fetches send none)
//   JOB_STORE_MAX            bound on retained job records
import crypto from 'node:crypto';

const int = (raw, fallback, min, max) => {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isSafeInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const csvList = (raw) =>
  String(raw ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const LOOPBACK_IPS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

// Site-side gate: ENGINE_KEY_RE = /^[0-9a-f]{32}$/i
export const ENGINE_KEY_RE = /^[0-9a-f]{32}$/i;
export const keyShape = (key) => (ENGINE_KEY_RE.test(String(key ?? '')) ? 'ok' : key ? 'shape' : 'missing');

const SITE_QUEUE_URL = String(process.env.SITE_QUEUE_URL || '').replace(/\/$/, '');

export const config = {
  port: int(process.env.PORT, 9000, 1, 65535),
  // Legacy /fsm handshake mount and caller Site port (api/flags.js endpoint
  // block); env-overridable, defaults match the old hardcoded values.
  fsmMount: process.env.FSM_MOUNT || '/fsm',
  sitePort: int(process.env.SITE_PORT, 3000, 1, 65535),
  siteToEngineKey: String(process.env.SITE_TO_ENGINE_KEY || '').trim(),
  engineToSiteKey: String(process.env.ENGINE_TO_SITE_KEY || '').trim(),
  siteQueueUrl: SITE_QUEUE_URL,
  sourceUrl: SITE_QUEUE_URL, // router POST '/' — source pull
  resultUrl: SITE_QUEUE_URL ? `${SITE_QUEUE_URL}/result` : '', // router POST '/result'
  acceptTimeoutMs: int(process.env.ENGINE_ACCEPT_TIMEOUT_MS, 3000, 100, 30000),
  jobTimeoutMs: int(process.env.ENGINE_JOB_TIMEOUT_MS, 120000, 1000, 600000),
  pullRetryMs: int(process.env.ENGINE_PULL_RETRY_MS, 500, 50, 10000),
  transferTimeoutMs: int(process.env.ENGINE_TRANSFER_TIMEOUT_MS, 60000, 1000, 300000),
  maxConcurrent: int(process.env.ENGINE_MAX_CONCURRENT, 2, 1, 16),
  // Validating layer ported from the staging api-server.js: IP + origin
  // allowlists alongside the inbound key (key check itself lives in
  // server.mjs). Explicit ENGINE_ALLOWED_IPS wins verbatim; otherwise
  // loopback only. Origins are checked only when the caller sends one.
  allowedIps: new Set(
    process.env.ENGINE_ALLOWED_IPS ? csvList(process.env.ENGINE_ALLOWED_IPS) : LOOPBACK_IPS,
  ),
  allowedOrigins: new Set(
    process.env.ENGINE_ALLOWED_ORIGINS
      ? csvList(process.env.ENGINE_ALLOWED_ORIGINS)
      : ['localhost:3000', 'localhost', '127.0.0.1:3000'],
  ),
  jobStoreMax: int(process.env.JOB_STORE_MAX, 500, 10, 10000),
  // Public API: express-session. SESSION_SECRET is mandatory when
  // NODE_ENV=production; absent in dev we use a loud, insecure fallback.
  sessionSecret: String(process.env.SESSION_SECRET || '').trim(),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'lingux.sid',
  sessionTtlMs: int(process.env.SESSION_TTL_MS, 8 * 60 * 60 * 1000, 60_000, 7 * 24 * 60 * 60 * 1000),
  cookieSecure: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
  // Public API guards (rate-limit.mjs), fixed windows per client IP.
  // The handshake mints the session hash, so it gets a much tighter budget.
  handshakeWindowMs: int(process.env.HANDSHAKE_RATE_WINDOW_MS, 10 * 60_000, 1_000, 24 * 60 * 60_000),
  handshakeMax: int(process.env.HANDSHAKE_RATE_MAX, 10, 1, 1_000),
  apiWindowMs: int(process.env.API_RATE_WINDOW_MS, 60_000, 1_000, 60 * 60_000),
  apiMax: int(process.env.API_RATE_MAX, 120, 1, 10_000),
  // Site caps both transfers at 64 MB; accept the same ceiling.
  maxSourceBytes: int(process.env.ENGINE_MAX_SOURCE_BYTES, 64 * 1024 * 1024, 1024, 256 * 1024 * 1024),
  maxResultBytes: int(process.env.ENGINE_MAX_RESULT_BYTES, 64 * 1024 * 1024, 1024, 256 * 1024 * 1024),
};

export function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
