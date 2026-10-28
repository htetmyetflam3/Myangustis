import express from 'express';
import { BindEngine } from '../../_index.js';
import { keyMatches } from '../../../curl-key.js';

// Like the Site's private route, this bypasses normal session and rate gates.
export function createDirectEngineRouter() {
  const router = express.Router();
  const maxMb = Number.parseInt(process.env.CURL_MAX_MB ?? '0', 10);
  const limit = Number.isSafeInteger(maxMb) && maxMb > 0 ? maxMb * 1024 * 1024 : Infinity;
  router.post('/UchihaItachiIsMyFavChar', (req, res, next) => {
    const auth = req.get('authorization') || '';
    const key = (req.get('x-curl-key') || (/^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '') : '')).trim();
    if (!keyMatches(key)) return res.status(404).json({ error: 'Not found' });
    return next();
  }, express.json({ limit, strict: true }), async (req, res, next) => {
    try {
      const { sourceText, flag } = req.body ?? {};
      if (typeof sourceText !== 'string' || (flag !== 'pos' && flag !== 'syllable')) {
        return res.status(400).json({ error: 'sourceText must be a string and flag must be pos or syllable' });
      }
      if (Object.hasOwn(req.body, 'hash') || Object.hasOwn(req.body, 'debug')) {
        return res.status(400).json({ error: 'hash and debug are not supported by this endpoint' });
      }
      const results = [];
      for await (const unit of BindEngine({ sourceText, flag })) results.push(unit);
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ flag, results });
    } catch (error) {
      return next(error);
    }
  });
  router.use((error, _req, res, _next) => {
    if (error?.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ error: 'Invalid request' });
    }
    return res.status(500).json({ error: 'Engine request failed' });
  });
  return router;
}
