import logger from '../../../Bridge/logen/site.js';
import { db } from '../db/db.js';
import { decodeCookie } from './codec.js';
export async function cookieDBCheck(req, res, next) {
  try {
    const rawCookie = req.cookies.userData;
    if (!rawCookie) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const parsed = decodeCookie(rawCookie);
    if (!parsed || !parsed.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const cookieHash = parsed.userId;
    const user = db
      .prepare(
        'SELECT id, cookie_hash, t, last_submission_date FROM users WHERE cookie_hash = ?',
      )
      .get(cookieHash);
    if (!user) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    parsed.timestamp = new Date().toISOString();
    req.userId = user.id;
    req.user = user;
    req.visitorHash = cookieHash;
    if (!req.cookieData) req.cookieData = parsed;
    next();
  } catch (err) {
    logger.log('ERROR:', '[cookieDBCheck]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}
