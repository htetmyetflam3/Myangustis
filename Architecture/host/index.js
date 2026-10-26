#!/usr/bin/env node
// standalone-web entry — one Express process, two APIs:
//
//   Site API   root paths /health, /job, /jobs  — x-api-key gate, server.mjs
//   Public API /api/public/...                  — helmet + express-session,
//                                                  tokenizer router (public-api.mjs)
//
// Environment resolution is centralized in secretloader.js (repo root).
// It checks process.env first, then any .env next to this file, then the
// repo root .env, then .data/.env. Real environment variables always win.
//
// Middleware order: helmet -> session -> public router -> site sub-app.
//
// Run:  node index.js   (from anywhere; .env resolves relative to this file)
import { loadSecrets } from '../../secretloader.js';
await loadSecrets(import.meta.url);
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Evaluated only after the .env has been applied.
const [{ config, keyShape }, { createApp: createSiteApp }, { publicRouter }] = await Promise.all([
  import('./config.js'),
  import('./server.js'),
  import('./api/public-api.js'),
]);

export function createServer() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // 1. helmet — security headers on every response, both APIs.
  app.use(helmet());

  // 2. session — holds the public side's engine-hash -> handle map.
  if (config.cookieSecure && !config.sessionSecret) {
    throw new Error('SESSION_SECRET is required when NODE_ENV=production');
  }
  if (!config.sessionSecret) {
    console.warn('[standalone-web] SESSION_SECRET unset — using ephemeral dev secret (do not ship this)');
  }
  app.use(
    session({
      name: config.sessionCookieName,
      secret: config.sessionSecret || `dev-${crypto.randomUUID()}`,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        maxAge: config.sessionTtlMs,
      },
    }),
  );

  // 3. public API — tokenizer router behind the session.
  app.use('/api/public', publicRouter);

  // 4. site API — the existing keyed /job worker contract (its own json parser,
  //    error and 404 handlers live in server.mjs).
  app.use(createSiteApp());

  return app;
}

export function startServer(port = config.port) {
  const app = createServer();
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[standalone-web] listening on http://0.0.0.0:${port}`);
    console.log('[standalone-web] site API:   GET /health (open) - POST /job (keyed) - GET /jobs (keyed)');
    console.log('[standalone-web] public API: /api/public/tokenizer (session cookie, handle-based)');
    console.log(
      keyShape(config.siteToEngineKey) === 'ok'
        ? '[standalone-web] inbound gate ON (SITE_TO_ENGINE_KEY 32 hex)'
        : '[standalone-web] inbound gate FAIL-CLOSED — set SITE_TO_ENGINE_KEY',
    );
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) startServer();
