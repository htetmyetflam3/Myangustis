import crypto from 'crypto';

function timingSafeMatch(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function csrfCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    return res.status(403).json({ error: 'Cross-origin request denied' });
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      
      
      
      if (new URL(origin).host !== String(req.get('host') || '').toLowerCase()) {
        return res.status(403).json({ error: 'Cross-origin request denied' });
      }
    } catch {
      return res.status(403).json({ error: 'Cross-origin request denied' });
    }
  }

  const token = req.headers['x-csrf-token'];
  const cookieToken = req.cookies?.csrf_token;

  if (!token || !cookieToken || !timingSafeMatch(token, cookieToken)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }

  next();
}
