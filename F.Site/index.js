import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { createMirrorGuard, robotsTxt } from "./Backend/gateway/mirrorGuard.js";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { db, ensureSchema, closeDb, secureDbFiles } from "./Backend/db/db.js";
import { SchemaDriftError } from "./Backend/db/migrate.js";
import { createSessionMiddleware } from "./Backend/db/session.js";
import { headerCheck } from "./Backend/cookie/header.js";
import { cookieGenerator } from "./Backend/cookie/cgen.js";
import { cookieDBCheck } from "./Backend/cookie/sanitized.js";
import { csrfCheck } from "./Backend/cookie/csrf.js";
import { createRequest, dailyLimit } from "./Backend/db/request.js";
import {
  createIncomingRouter,
  createSlotLimiter,
  JSON_BODY_LIMIT_BYTES,
} from "./Backend/gateway/api/incoming.js";
import { createHiddenProcessor } from "./Backend/gateway/api/hidden.js";
import { createEngineQueueRouter } from "./Backend/gateway/api/engineCollect.js";
import { createCurlRouter, curlEndpointBanner } from "./Backend/gateway/api/curl.js";
import { createHttpConsoleLogger } from "./Backend/gateway/proxy/httpLog.js";
import { installPassiveLog, checksEnabled } from "../Bridge/logen/site.js";
import { runSelfTests } from "./site_logen/selftest.js";
import {
  engineConfig,
  createEngineDispatcher,
} from "./Backend/gateway/generator/engine.js";
import { createProcessingQueue } from "./Backend/gateway/queue/processingQueue.js";
import { closePraserManager } from "./Backend/file/praser.js";
import { cleanupExpiredRuntimeFiles } from "./Backend/file/runtimeCleanup.js";
import {
  DB_FILE,
  FRONTEND_DIR,
  FRONTEND_REACT_DIR,
  abs,
  inputDirFor,
  ensurePraserDirs,
  validatePraserAssets,
} from "./Backend/file/paths.js";
import {
  trustProxyValue,
  trustProxyBanner,
  createEdgeGuard,
  edgeContext,
  cookieSecureEnabled,
  cookieSameSite,
  cookieSecurityBanner,
} from "./Backend/gateway/edge.js";
const app = express();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const FRONTEND = abs(FRONTEND_DIR);
const REACT_FRONTEND = abs(FRONTEND_REACT_DIR);
const ARTIFACT_TTL_MS =
  positiveInteger("ARTIFACT_TTL_HOURS", 24, 720) * 60 * 60 * 1000;
function requiredSecret(name) {
  const value = String(process.env[name] || "");
  if (value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters`);
  }
  return value;
}
function positiveInteger(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}
function createConcurrencyGate(maximum) {
  let active = 0;
  return function concurrencyGate(_req, res, next) {
    if (active >= maximum) {
      res.set("Retry-After", "5");
      return res.status(503).json({ error: "Upload service is busy; retry shortly" });
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
    };
    res.once("finish", release);
    res.once("close", release);
    return next();
  };
}
const cookieSecret = requiredSecret("COOKIE_SECRET");
const sessionSecret = requiredSecret("SESSION_SECRET");
if (cookieSecret === sessionSecret) {
  throw new Error("COOKIE_SECRET and SESSION_SECRET must be different values");
}
validatePraserAssets();
ensurePraserDirs();
const runArtifactCleanup = () =>
  cleanupExpiredRuntimeFiles({ maxAgeMs: ARTIFACT_TTL_MS })
    .then((removed) => {
      if (removed) console.log(`[cleanup] removed ${removed} expired runtime artifact(s)`);
    })
    .catch((error) => console.error("[cleanup] runtime artifact cleanup failed", error));
runArtifactCleanup();
const cleanupTimer = setInterval(runArtifactCleanup, 60 * 60 * 1000);
cleanupTimer.unref();

const frontendIndex = path.join(FRONTEND, "index.html");
const reactIndex = path.join(REACT_FRONTEND, "index.html");
for (const [label, file] of [
  ["Bootstrap frontend", frontendIndex],
  ["React frontend", reactIndex],
]) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${label} is missing at ${file}. Run "npm run build" before "npm start".`,
    );
  }
}
for (const line of [cookieSecurityBanner(), curlEndpointBanner()]) {
  if (line) console.log(line);
}
const TRUST_PROXY = trustProxyValue();
if (TRUST_PROXY !== false) app.set("trust proxy", TRUST_PROXY);
const proxyBanner = trustProxyBanner();
if (proxyBanner) console.log(proxyBanner);

const DAILY_UPLOAD_LIMIT = dailyLimit();
console.log(
  DAILY_UPLOAD_LIMIT === 0
    ? "[quota] DAILY_UPLOAD_LIMIT=0 — no per-visitor daily limit. " +
      `Uploads stay bounded by UPLOAD_RATE_MAX per IP and PARSER_MAX_CONCURRENCY.`
    : `[quota] ${DAILY_UPLOAD_LIMIT} uploads per visitor per day.`,
);
console.log(`[db] sqlite ${abs(DB_FILE)} — applying schema`);
try {
  ensureSchema();
} catch (error) {
  if (error instanceof SchemaDriftError) {
    throw new Error(`Cannot open ${abs(DB_FILE)}.\n${error.message}`, { cause: error });
  }
  throw error;
}
secureDbFiles();

const engineCfg = engineConfig();
const engineDispatcher = createEngineDispatcher({
  jobUrl: engineCfg.jobUrl,
  key: engineCfg.siteToEngineKey,
  acceptTimeoutMs: engineCfg.acceptTimeoutMs,
});
const request = createRequest({ db });
const processingQueue = createProcessingQueue({
  metadataStore: request,
  ttlMs: ARTIFACT_TTL_MS,
  // Until an Engine is configured, analysis closes on the site artifact.
  // The queue records that choice as engineRound:'unwired'.
  engineWired: () => engineDispatcher.configured,
});
const hiddenProcessor = createHiddenProcessor({
  queue: processingQueue,
  dispatcher: engineDispatcher,
  jobTimeoutMs: engineCfg.jobTimeoutMs,
});

/* HTTP logging. createHttpConsoleLogger() has existed in
   backend/gateway/proxy/httpLog.js since it was written and was never
   mounted -- index.js imported morgan and then never called it, so every
   request went unlogged while a finished colour formatter sat unused. It is
   mounted first so a request is logged even when a guard rejects it. */
/* The passive half of the log: one listener for every stage that emits,
   installed once. Stages emit counts; this decides console and disk. */
installPassiveLog({
  file: process.env.LOG_FILE || "",
  // LOG_CHECKS=1 runs the chain invariants against real traffic, in this
  // process. Off by default: no check subscriber is attached at all.
  checks: /^(1|true|on|yes)$/i.test(String(process.env.LOG_CHECKS ?? "")),
});

/* With checks on, the pure half of the suite runs here, before the first
   request, so `npm test` is not a separate step for day-to-day work. It is
   deliberately not awaited: a self-test must not delay the port opening,
   and must never take the server down. The database and server suites are
   NOT run -- see logen/selftest.js for why. */
if (checksEnabled()) {
  runSelfTests().catch((error) => console.error("[selftest]", error.message));
}

app.use(createHttpConsoleLogger());

app.use(createEdgeGuard());
app.use(edgeContext);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
      },
    },
    strictTransportSecurity: cookieSecureEnabled()
      ? { maxAge: 15_552_000, includeSubDomains: true }
      : false,
  }),
);
/* The off-path. Mounted here, ahead of every gate, because it is not an
   exemption inside the gate -- it is a different door. See
   backend/gateway/api/curl.js. Unset CURL_ENDPOINT/CURL_KEY and nothing
   below happens at all. */
const curlOffPath = createCurlRouter();
if (curlOffPath) app.use(curlOffPath.path, curlOffPath.router);

app.get("/healthz", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    web: "site",
    port: PORT,
    parser: "ready",
    engine: engineDispatcher.configured ? "configured" : "not-wired",
    cloudflare: "not-wired",
    proxy: TRUST_PROXY !== false ? TRUST_PROXY : false,
  });
});
app.use(cookieParser());
app.use(
  createSessionMiddleware({
    secret: sessionSecret,
    maxAge: 24 * 60 * 60 * 1000,
  }),
);
/* Refuse to be the origin for somebody else's mirror. Sits ahead of the
   static mount so a recursive sweep is cut off before it costs us a file
   read, and behind edgeContext so it bans the real client IP. */
const mirrorGuard = createMirrorGuard();
app.get("/robots.txt", (_req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  res.type("text/plain").send(robotsTxt());
});
app.use(mirrorGuard);
app.use(express.static(FRONTEND, { index: false }));
app.get("/", (_req, res) => res.sendFile(frontendIndex));
app.get(["/react", "/react/"], (req, res) => {
  if (!req.path.endsWith("/")) return res.redirect(301, "/react/");
  return res.sendFile(reactIndex);
});
const identityRateLimit = rateLimit({
  windowMs: positiveInteger("IDENTITY_RATE_WINDOW_MINUTES", 60, 1440) * 60 * 1000,
  limit: positiveInteger("IDENTITY_RATE_MAX", 20, 10_000),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.edge?.ip || req.ip || "unknown"),
  handler: (_req, res) =>
    res.status(429).json({ error: "Too many identity requests; retry later" }),
});
app.get("/csrf-token", identityRateLimit, cookieGenerator, (req, res) => {
  const existing = req.cookies?.csrf_token;
  const token =
    typeof existing === "string" && /^[A-Za-z0-9_-]{43}$/.test(existing)
      ? existing
      : crypto.randomBytes(32).toString("base64url");
  res.cookie("csrf_token", token, {
    httpOnly: false,
    sameSite: cookieSameSite(),
    secure: cookieSecureEnabled(),
    path: "/",
    maxAge: 60 * 60 * 1000,
  });
  res.set("Cache-Control", "no-store");
  res.json({ csrfToken: token });
});
app.use("/api/submit", headerCheck);
app.use("/api/submit", csrfCheck);
const uploadRateLimit = rateLimit({
  windowMs: positiveInteger("UPLOAD_RATE_WINDOW_MINUTES", 60, 1440) * 60 * 1000,
  limit: positiveInteger("UPLOAD_RATE_MAX", 20, 10_000),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.edge?.ip || req.ip || "unknown"),
  handler: (_req, res) =>
    res.status(429).json({ error: "Too many submission attempts; retry later" }),
});
const uploadCapacity = createConcurrencyGate(
  positiveInteger("PARSER_MAX_CONCURRENCY", 2, 16),
);
app.post("/api/submit", uploadRateLimit, uploadCapacity);
app.use("/api/submit", cookieGenerator);
app.use("/api/submit", cookieDBCheck);
app.use("/api/submit", express.json({ limit: JSON_BODY_LIMIT_BYTES, strict: true }));
app.use(
  "/api/submit",
  express.urlencoded({ extended: false, limit: "64kb", parameterLimit: 20 }),
);
const UPLOAD_MAX_MB = positiveInteger("UPLOAD_MAX_MB", 64, 2048);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => cb(null, abs(inputDirFor(file.originalname))),
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  fileFilter: (_req, file, cb) => {
    const valid =
      file.originalname.length <= 255 &&
      /^\d{8}T\d{6}Z__[a-zA-Z0-9._-]+\.(pdf|docx)$/.test(file.originalname);
    cb(valid ? null : new multer.MulterError("LIMIT_UNEXPECTED_FILE", "file"), valid);
  },
  limits: {
    fileSize: UPLOAD_MAX_MB * 1024 * 1024,
    files: 1,
    fields: 4,
    parts: 5,
    fieldSize: 64 * 1024,
  },
});
app.use(
  "/api/submit",
  createIncomingRouter({
    upload,
    db,
    request,
    artifactTtlMs: ARTIFACT_TTL_MS,
    queue: processingQueue,
    hiddenProcessor,
    parseCapacity: createSlotLimiter(
      positiveInteger("PARSER_MAX_CONCURRENCY", 2, 16),
    ),
  }),
);
const engineQueueRateLimit = rateLimit({
  windowMs: positiveInteger("ENGINE_QUEUE_RATE_WINDOW_MINUTES", 60, 1440) * 60 * 1000,
  limit: positiveInteger("ENGINE_QUEUE_RATE_MAX", 240, 100_000),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.edge?.ip || req.ip || "unknown"),
  handler: (_req, res) => res.status(429).json({ error: "Too many queue calls; retry later" }),
});
app.use(
  "/api/internal/engine/queue",
  engineQueueRateLimit,
  createEngineQueueRouter({
    queue: processingQueue,
    engineToSiteKey: engineCfg.engineToSiteKey,
  }),
);
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("[http]", error);
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge ? "Uploaded file is too large" : "Invalid multipart upload",
    });
  }
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large" });
  }
  const declared = Number(error?.status ?? error?.statusCode);
  if (Number.isInteger(declared) && declared >= 400 && declared < 500) {
    return res.status(declared).json({
      error: declared === 404 ? "Not found" : "Request could not be processed",
    });
  }
  return res.status(500).json({ error: "Internal server error" });
});
export const server = app.listen(PORT, HOST, () => {
  console.log(`[site] listening at http://${HOST}:${PORT}`);
});
server.requestTimeout = positiveInteger("HTTP_REQUEST_TIMEOUT_MS", 120_000, 3_600_000);
server.headersTimeout = Math.min(30_000, server.requestTimeout);
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[site] ${signal} — shutting down`);
  clearInterval(cleanupTimer);
  processingQueue.dispose();
  await new Promise((resolve) => server.close(resolve));
  await closePraserManager().catch(() => {});
  try {
    closeDb();
  } catch {}
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((err) => {
        console.error("[site] shutdown failed", err);
        process.exit(1);
      });
  });
}
export default app;