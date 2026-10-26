import crypto from 'node:crypto';

/*
  THE OFF-PATH GATE -- policy only.

  Deliberately imports nothing but node:crypto. Deciding whether the door
  exists and whether a caller may come through is a rule, not plumbing, and a
  rule should be testable without a web framework installed. curl.js holds the
  express/multer half and calls in here for every decision.

  CONFIGURATION (.env)

      CURL_ENDPOINT=/uchihaItachiismyfavcharcter
      CURL_KEY=<secret>

  Only the SUFFIX is configured. The host is whichever domain served the
  request, so the same build answers on localhost in development and on the
  real domain in production with nothing hardcoded and no second setting:

      myanmargrammar.com/uchihaItachiismyfavcharcter

  Unset either variable and the route is never mounted.
*/

/** The configured suffix, normalised to exactly one leading slash, or null. */
export function curlEndpointPath() {
  const raw = String(process.env.CURL_ENDPOINT ?? '').trim();
  if (!raw) return null;
  const suffix = `/${raw.replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return suffix === '/' ? null : suffix;
}

/** The stored digest, if the key is kept hashed (what env:regenerate writes). */
export function curlKeySha256() {
  return String(process.env.CURL_KEY_SHA256 ?? '').trim().toLowerCase();
}

/** The raw key, for setups that keep it in the clear instead. */
export function curlKey() {
  return String(process.env.CURL_KEY ?? '').trim();
}

/** Either form arms the door. */
function curlSecretConfigured() {
  return curlKeySha256().length > 0 || curlKey().length > 0;
}

/** Both halves present, or the route does not exist. */
export function curlEndpointEnabled() {
  return Boolean(curlEndpointPath()) && curlSecretConfigured();
}

/**
 * Constant-time compare. Digest first so two different lengths cannot be told
 * apart by how long the comparison takes.
 */
export function keyMatches(presented) {
  if (typeof presented !== 'string' || presented.length === 0) return false;
  const stored = curlKeySha256();
  const expected = stored || curlKey();
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(presented, 'utf8').digest();
  // A stored digest is compared as-is; a raw key is digested the same way, so
  // both forms take the same constant-time path.
  const b = stored ? Buffer.from(stored, 'hex') : crypto.createHash('sha256').update(expected, 'utf8').digest();
  return b.length === a.length && crypto.timingSafeEqual(a, b);
}

/** Header, bearer token, or ?key= -- whichever is least annoying to curl. */
export function presentedKey(req) {
  const header = req.get('x-curl-key');
  if (header) return header.trim();
  const auth = req.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const query = req.query?.key;
  return typeof query === 'string' ? query.trim() : '';
}

/** The absolute URL this request arrived on. Host from the request, never
 *  from configuration, so nothing in the code has to know the domain. */
export function endpointUrl(req, suffix) {
  const host = req.get('host');
  if (!host) return suffix;
  const scheme = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${scheme}://${host}${suffix}`;
}

/** Boot line. The suffix only: the host is not known until a request arrives. */
export function curlEndpointBanner() {
  const suffix = curlEndpointPath();
  if (!suffix) return null;
  if (!curlSecretConfigured()) {
    return '[curl] CURL_ENDPOINT is set but no CURL_KEY_SHA256 / CURL_KEY -- the off-path is NOT mounted.';
  }
  return `[curl] off-path mounted at <this-host>${suffix} -- key required, conversion only.`;
}
