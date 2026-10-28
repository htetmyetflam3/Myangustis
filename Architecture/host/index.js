#!/usr/bin/env node












import '../../index-path.js';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';


const [{ config, keyShape }, { createApp: createSiteApp }, { publicRouter }] = await Promise.all([
  import('./config.js'),
  import('./server.js'),
  import('./api/public-api.js'),
]);

export function createServer() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);


  app.use(helmet());


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


  app.use('/api/public', publicRouter);



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
