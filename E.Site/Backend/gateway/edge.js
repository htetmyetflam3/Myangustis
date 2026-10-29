
import crypto from 'node:crypto';


function asList(v) {
  if (!v) return [];
  return String(v)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function trustProxyValue() {
  const raw = (process.env.TRUST_PROXY || '').trim();
  if (!raw || raw === 'false' || raw === '0') return false;
  if (raw === 'true') return 'loopback'; 
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  const list = asList(raw);
  return list.length > 1 ? list : raw;
}


export function trustProxyBanner() {
  const v = trustProxyValue();
  if (v === false) return null;
  return `[edge] TRUST_PROXY=${JSON.stringify(v)} — req.ip/req.protocol come from X-Forwarded-* on trusted hops.`;
}


export function createEdgeGuard({
  secret = process.env.EDGE_SECRET,
  headerName = (process.env.EDGE_SECRET_HEADER || 'x-edge-secret').toLowerCase(),
  openPaths = asList(process.env.EDGE_GUARD_OPEN_PATHS || '/healthz'),
} = {}) {
  if (!secret) {
    return function edgeGuardDisabled(req, _res, next) {
      req.edgeVerified = false;
      next();
    };
  }
  const expected = Buffer.from(String(secret));
  return function edgeGuard(req, res, next) {
    if (openPaths.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
      req.edgeVerified = false;
      return next();
    }
    const got = typeof req.headers[headerName] === 'string'
      ? Buffer.from(req.headers[headerName])
      : Buffer.alloc(0);
    
    
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
      return res.status(403).json({
        status: 'rejected',
        reason: 'Direct origin access denied — request must arrive through the edge',
      });
    }
    req.edgeVerified = true;
    next();
  };
}


export function edgeContext(req, res, next) {
  const verified = req.edgeVerified === true;
  req.edge = {
    verified,
    ip: verified
      ? req.headers['cf-connecting-ip'] ||
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.ip ||
        req.socket?.remoteAddress ||
        'unknown'
      : req.ip || req.socket?.remoteAddress || 'unknown',
    country: verified
      ? req.headers['cf-ipcountry'] || req.headers['x-verified-country'] || null
      : null,
    ray: verified ? req.headers['cf-ray'] || null : null,
    requestId: verified
      ? req.headers['x-request-id'] || req.headers['cf-ray'] || null
      : null,
    viaWorker: verified && req.headers['x-edge-worker'] === '1',
    proto: verified ? req.headers['x-forwarded-proto'] || req.protocol : req.protocol,
  };
  
  
  if (req.edge.requestId) res.setHeader('X-Request-Id', req.edge.requestId);
  next();
}


export function cookieSecureEnabled() {
  const raw = (process.env.COOKIE_SECURE || '').trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  
  
  
  return true;
}


export function cookieSameSite() {
  const raw = (process.env.COOKIE_SAMESITE || '').trim().toLowerCase();
  return ['strict', 'lax', 'none'].includes(raw) ? raw : 'strict';
}


export function cookieSecurityBanner() {
  const lines = [];
  const explicitSecure = (process.env.COOKIE_SECURE || '').trim();
  if (explicitSecure === 'false') {
    lines.push(
      '[security] COOKIE_SECURE=false — session and identity ' +
        'cookies are sent WITHOUT the Secure flag. Correct for a plain-HTTP ' +
        'preproduction run; a credential downgrade on any HTTPS host. ' +
        'Set COOKIE_SECURE=true (or unset it to auto-detect) before publishing.',
    );
  }
  if (cookieSameSite() !== 'strict') {
    lines.push(
      `[security] COOKIE_SAMESITE=${cookieSameSite()} — weaker than the 'strict' ` +
        'default. A cross-site top-level navigation will carry these cookies.',
    );
  }
  return lines.length ? lines.join('\n') : null;
}
