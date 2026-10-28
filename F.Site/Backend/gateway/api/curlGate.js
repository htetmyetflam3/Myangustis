import crypto from 'node:crypto';
























export function curlEndpointPath() {
  const raw = String(process.env.CURL_ENDPOINT ?? '').trim();
  if (!raw) return null;
  const suffix = `/${raw.replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return suffix === '/' ? null : suffix;
}


export function curlKeySha256() {
  return String(process.env.CURL_KEY_SHA256 ?? '').trim().toLowerCase();
}


export function curlKey() {
  return String(process.env.CURL_KEY ?? '').trim();
}


function curlSecretConfigured() {
  return curlKeySha256().length > 0 || curlKey().length > 0;
}


export function curlEndpointEnabled() {
  return Boolean(curlEndpointPath()) && curlSecretConfigured();
}





export function keyMatches(presented) {
  if (typeof presented !== 'string' || presented.length === 0) return false;
  const stored = curlKeySha256();
  const expected = stored || curlKey();
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(presented, 'utf8').digest();


  const b = stored ? Buffer.from(stored, 'hex') : crypto.createHash('sha256').update(expected, 'utf8').digest();
  return b.length === a.length && crypto.timingSafeEqual(a, b);
}


export function presentedKey(req) {
  const header = req.get('x-curl-key');
  if (header) return header.trim();
  const auth = req.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const query = req.query?.key;
  return typeof query === 'string' ? query.trim() : '';
}



export function endpointUrl(req, suffix) {
  const host = req.get('host');
  if (!host) return suffix;
  const scheme = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${scheme}://${host}${suffix}`;
}


export function curlEndpointBanner() {
  const suffix = curlEndpointPath();
  if (!suffix) return null;
  if (!curlSecretConfigured()) {
    return '[curl] CURL_ENDPOINT is set but no CURL_KEY_SHA256 / CURL_KEY -- the off-path is NOT mounted.';
  }
  return `[curl] off-path mounted at <this-host>${suffix} -- key required, conversion only.`;
}
