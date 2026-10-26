import logger from '../../../Bridge/logen/site.js';
import session from 'express-session';
import { db } from './db.js';
import { SqliteSessionStore } from './sessionStore.js';
import { cookieSecureEnabled, cookieSameSite } from '../gateway/edge.js';
export function createSessionMiddleware({
  secret = process.env.SESSION_SECRET || 'super-secret-key',
  maxAge = 24 * 60 * 60 * 1000,
  checkExpirationInterval = 15 * 60 * 1000,
} = {}) {
  const store = new SqliteSessionStore({
    db,
    tableName: 'sessions',
    checkExpirationIntervalMs: checkExpirationInterval,
    expirationMs: maxAge,
  });
  store.on('error', (err) => {
    logger.log('ERROR:', '[SessionStore]', err.message);
  });
  return session({
    name: 'sid',
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge,
      httpOnly: true,
      sameSite: cookieSameSite(),
      secure: cookieSecureEnabled(),
    },
  });
}
