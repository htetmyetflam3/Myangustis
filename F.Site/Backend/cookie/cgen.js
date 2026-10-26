import logger from '../../../Bridge/logen/site.js';
import crypto from 'node:crypto';
import { createOrUpdateCookie } from '../db/cookie.js';
import { decodeCookie } from './codec.js';
import { setIdentityCookie } from './emit.js';
function hashFingerprint(ip, ua, country) {
  const raw = `${ip}::${ua}::${country}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}
export const cookieGenerator = async (req, res, next) => {
  try {
    const cfHeader =
      req.edge?.ip || req.trustedIp || req.ip || req.socket?.remoteAddress || 'unknown';
    const cfCountry = req.edge?.country || null;
    const userAgent = req.headers['user-agent'] || 'unknown';
    const nowIso = new Date().toISOString();
    let cookieData;
    if (!req.cookies.userData) {
      const localStorageToken = crypto.randomBytes(16).toString('hex');
      const visitorId = crypto.randomUUID();
      cookieData = {
        userId: visitorId,
        cfHeader,
        cfCountry,
        userAgent,
        timestamp: nowIso,
        localStorageToken,
      };
    } else {
      try {
        cookieData = decodeCookie(req.cookies.userData);
        if (!cookieData || !cookieData.userId) throw new Error('bad');
        cookieData.timestamp = nowIso;
      } catch {
        const localStorageToken = crypto.randomBytes(16).toString('hex');
        const visitorId = crypto.randomUUID();
        cookieData = {
          userId: visitorId,
          cfHeader,
          cfCountry,
          userAgent,
          timestamp: nowIso,
          localStorageToken,
        };

      }
    }
    const deviceFingerprint = hashFingerprint(cfHeader, userAgent, cfCountry);
    cookieData.deviceFingerprint = deviceFingerprint;
    const dbUserId = await createOrUpdateCookie({
      ...cookieData,
      deviceFingerprint,
      localStorageToken: cookieData.localStorageToken,
    });
    cookieData.dbUserId = dbUserId;
    setIdentityCookie(res, cookieData);
    res.setHeader('X-Visitor-Token', cookieData.localStorageToken);
    req.visitorHash = cookieData.userId;
    req.cookieData = cookieData;
    next();
  } catch (err) {
    logger.log('ERROR:', '[CookieGenerator]', err);
    res.status(500).json({ status: 'error', reason: 'Cookie handling failed' });
  }
};
