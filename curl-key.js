import crypto from 'node:crypto';

export function curlKeySha256() {
  return String(process.env.CURL_KEY_SHA256 ?? '').trim().toLowerCase();
}

export function curlKey() {
  return String(process.env.CURL_KEY ?? '').trim();
}

// The hash takes precedence, matching the Site's private conversion route.
export function keyMatches(presented) {
  if (typeof presented !== 'string' || presented.length === 0) return false;
  const stored = curlKeySha256();
  const expected = stored || curlKey();
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(presented, 'utf8').digest();
  const b = stored ? Buffer.from(stored, 'hex') : crypto.createHash('sha256').update(expected, 'utf8').digest();
  return b.length === a.length && crypto.timingSafeEqual(a, b);
}
