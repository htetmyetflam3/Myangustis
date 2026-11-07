import { curlKey, curlKeySha256, keyMatches } from '../../../../curl-key.js';

export { curlKey, curlKeySha256, keyMatches };
























export function curlEndpointPath() {
  const raw = String(process.env.CURL_ENDPOINT ?? '').trim();
  if (!raw) return null;
  const suffix = `/${raw.replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return suffix === '/' ? null : suffix;
}


function curlSecretConfigured() {
  return curlKeySha256().length > 0 || curlKey().length > 0;
}


export function curlEndpointEnabled() {
  return Boolean(curlEndpointPath()) && curlSecretConfigured();
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
