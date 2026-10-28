

















const DOWNLOADER_AGENT =
  /(httrack|webcopier|cyotek|webcopy|teleport\s*pro|offline\s*explorer|webzip|sitesucker|website\s*downloader|webreaper|webstripper|getleft|pavuk|wpull|grab-site|httrack|wget|curl\/|libwww-perl|lwp::simple|python-requests|python-urllib|scrapy|go-http-client|okhttp|apache-httpclient|java\/\d|node-fetch|axios\/)/i;


const FRIENDLY_AGENT =
  /(googlebot|google-inspectiontool|bingbot|adidxbot|slurp|duckduckbot|baiduspider|yandexbot|applebot|facebookexternalhit|twitterbot|linkedinbot|discordbot|telegrambot|whatsapp|pinterestbot|ia_archiver|uptimerobot|pingdom)/i;

export const HONEYPOT_PATH = '/offline-archive-index';

function asList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envFlag(name, fallback = false) {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function envInt(name, fallback, max) {
  const parsed = Number.parseInt((process.env[name] || '').trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}




export function createBanStore({ ttlMs = 3_600_000, max = 5_000 } = {}) {
  const bans = new Map();
  function prune(now) {
    for (const [ip, expiry] of bans) {
      if (expiry <= now) bans.delete(ip);
      else break;
    }
  }
  return {
    ban(ip, now = Date.now()) {
      if (!ip) return;
      prune(now);
      bans.delete(ip);
      bans.set(ip, now + ttlMs);
      while (bans.size > max) bans.delete(bans.keys().next().value);
    },
    banned(ip, now = Date.now()) {
      if (!ip) return false;
      const expiry = bans.get(ip);
      if (expiry === undefined) return false;
      if (expiry <= now) {
        bans.delete(ip);
        return false;
      }
      return true;
    },
    get size() {
      return bans.size;
    },
    clear() {
      bans.clear();
    },
  };
}

export function isDownloaderAgent(userAgent) {
  return DOWNLOADER_AGENT.test(String(userAgent || ''));
}

export function isFriendlyAgent(userAgent) {
  return FRIENDLY_AGENT.test(String(userAgent || ''));
}



export function isDocumentRequest(req) {
  const dest = String(req.headers?.['sec-fetch-dest'] || '').toLowerCase();
  if (dest) return dest === 'document';
  return String(req.headers?.accept || '').includes('text/html');
}

export function robotsTxt({ honeypot = HONEYPOT_PATH } = {}) {
  return [
    'User-agent: HTTrack',
    'Disallow: /',
    '',
    'User-agent: wget',
    'Disallow: /',
    '',
    'User-agent: WebCopier',
    'Disallow: /',
    '',
    'User-agent: WebZIP',
    'Disallow: /',
    '',
    'User-agent: SiteSucker',
    'Disallow: /',
    '',
    'User-agent: *',
    `Disallow: ${honeypot}`,
    'Disallow: /api/',
    '',
  ].join('\n');
}

export function createMirrorGuard({
  enabled = envFlag('MIRROR_GUARD', true),
  strict = envFlag('MIRROR_GUARD_STRICT', false),
  honeypot = HONEYPOT_PATH,
  openPaths = asList(process.env.MIRROR_GUARD_OPEN_PATHS || '/healthz,/api,/robots.txt'),
  banTtlMs = envInt('MIRROR_GUARD_BAN_MINUTES', 60, 1440) * 60_000,
  store = createBanStore({ ttlMs: banTtlMs }),
  onEvent = null,
} = {}) {
  const report = (event) => {
    if (typeof onEvent === 'function') return onEvent(event);
    console.warn(`[mirror] ${event.reason} ip=${event.ip} ua=${JSON.stringify(event.userAgent.slice(0, 120))}`);
    return undefined;
  };

  function deny(res) {
    res.set('Cache-Control', 'no-store');
    return res.status(403).type('text/plain').send('Forbidden\n');
  }

  function guard(req, res, next) {
    if (!enabled) return next();

    const ip = req.edge?.ip || req.ip || '';
    const userAgent = String(req.headers['user-agent'] || '');
    const path = req.path || '';

    if (store.banned(ip)) return deny(res);





    if (path === honeypot) {
      store.ban(ip);
      report({ reason: 'honeypot', ip, userAgent, path });
      return deny(res);
    }

    if (openPaths.some((open) => path === open || path.startsWith(`${open}/`))) return next();

    if (isDownloaderAgent(userAgent)) {
      store.ban(ip);
      report({ reason: 'downloader-agent', ip, userAgent, path });
      return deny(res);
    }

    if (isDocumentRequest(req) && !isFriendlyAgent(userAgent)) {
      const browserish = req.headers['sec-fetch-mode'] || req.headers['sec-fetch-dest'];
      if (!browserish) {
        report({ reason: strict ? 'no-sec-fetch' : 'no-sec-fetch (report only)', ip, userAgent, path });
        if (strict) return deny(res);
      }
    }

    return next();
  }

  guard.store = store;
  guard.enabled = enabled;
  guard.strict = strict;
  return guard;
}
