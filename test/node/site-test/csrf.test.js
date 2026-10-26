import test from 'node:test';
import assert from 'node:assert/strict';
import { csrfCheck } from './csrf.js';
function run(req) {
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let next = false;
  csrfCheck(req, response, () => { next = true; });
  return { response, next };
}
test('CSRF gate allows safe methods and matching header/cookie tokens', () => {
  assert.equal(run({ method: 'GET' }).next, true);
  const accepted = run({
    method: 'POST',
    headers: { 'x-csrf-token': 'secure-token' },
    cookies: { csrf_token: 'secure-token' },
  });
  assert.equal(accepted.next, true);
});
test('CSRF gate rejects cross-origin browser requests even with a valid token', () => {
  const crossSite = run({
    method: 'POST',
    protocol: 'https',
    get: () => 'site.example',
    headers: {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'x-csrf-token': 'secure-token',
    },
    cookies: { csrf_token: 'secure-token' },
  });
  assert.equal(crossSite.response.statusCode, 403);
});
test('CSRF gate rejects body-only and mismatched tokens', () => {
  const bodyOnly = run({
    method: 'POST',
    headers: {},
    body: { csrfToken: 'secure-token' },
    cookies: { csrf_token: 'secure-token' },
  });
  assert.equal(bodyOnly.response.statusCode, 403);
  const mismatch = run({
    method: 'POST',
    headers: { 'x-csrf-token': 'other-token' },
    cookies: { csrf_token: 'secure-token' },
  });
  assert.equal(mismatch.response.statusCode, 403);
});