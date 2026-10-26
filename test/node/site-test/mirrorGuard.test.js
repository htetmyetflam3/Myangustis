import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMirrorGuard,
  createBanStore,
  isDownloaderAgent,
  isFriendlyAgent,
  isDocumentRequest,
  robotsTxt,
  HONEYPOT_PATH,
} from './mirrorGuard.js';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

function run(guard, req) {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    type() { return this; },
    send(body) { this.body = body; return this; },
  };
  let passed = false;
  guard({ ip: '1.2.3.4', path: '/', headers: {}, ...req }, res, () => { passed = true; });
  return { res, passed };
}

const browserGet = (path = '/') => ({
  path,
  headers: {
    'user-agent': CHROME,
    accept: 'text/html,application/xhtml+xml',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
  },
});

test('a real browser navigation passes untouched', () => {
  const guard = createMirrorGuard({ onEvent: () => {} });
  assert.equal(run(guard, browserGet()).passed, true);
});

test('agents that name themselves are refused and remembered', () => {
  const seen = [];
  const guard = createMirrorGuard({ onEvent: (e) => seen.push(e.reason) });

  const httrack = run(guard, { path: '/', headers: { 'user-agent': 'Mozilla/4.5 (compatible; HTTrack 3.0x; Windows 98)' } });
  assert.equal(httrack.passed, false);
  assert.equal(httrack.res.statusCode, 403);
  assert.deepEqual(seen, ['downloader-agent']);

  // the ban outlives the user agent: the same IP is refused even once it
  // starts claiming to be Chrome, which is what a cloner does next
  const retry = run(guard, browserGet());
  assert.equal(retry.passed, false);
  assert.equal(retry.res.statusCode, 403);
});

test('wget, curl and the scripted clients are covered too', () => {
  for (const ua of [
    'Wget/1.21.3',
    'curl/8.4.0',
    'SiteSucker/5.0',
    'Cyotek WebCopy/1.9',
    'python-requests/2.31.0',
    'Go-http-client/1.1',
    'Scrapy/2.11 (+https://scrapy.org)',
  ]) {
    assert.equal(isDownloaderAgent(ua), true, ua);
  }
  assert.equal(isDownloaderAgent(CHROME), false);
});

test('the honeypot bans anything that walks it, including a convincing agent', () => {
  const seen = [];
  const guard = createMirrorGuard({ onEvent: (e) => seen.push(e.reason) });
  const trapped = run(guard, { ...browserGet(HONEYPOT_PATH) });
  assert.equal(trapped.passed, false);
  assert.equal(trapped.res.statusCode, 403);
  assert.deepEqual(seen, ['honeypot']);
  assert.equal(run(guard, browserGet('/')).passed, false);
});

test('search crawlers are never blocked, even with no Sec-Fetch headers', () => {
  const guard = createMirrorGuard({ strict: true, onEvent: () => {} });
  const googlebot = run(guard, {
    path: '/',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', accept: 'text/html' },
  });
  assert.equal(googlebot.passed, true);
  assert.equal(isFriendlyAgent('Mozilla/5.0 (compatible; bingbot/2.0)'), true);
});

test('a document request with no Sec-Fetch only reports until strict is on', () => {
  const quiet = [];
  const reporting = createMirrorGuard({ strict: false, onEvent: (e) => quiet.push(e.reason) });
  const tolerated = run(reporting, { path: '/', headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0)', accept: 'text/html' } });
  assert.equal(tolerated.passed, true, 'older Safari predates Sec-Fetch and must still load');
  assert.equal(quiet.length, 1);

  const strict = createMirrorGuard({ strict: true, onEvent: () => {} });
  const refused = run(strict, { path: '/', headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0)', accept: 'text/html' } });
  assert.equal(refused.passed, false);
});

test('assets are judged on the agent only, never on Sec-Fetch', () => {
  const guard = createMirrorGuard({ strict: true, onEvent: () => {} });
  const asset = run(guard, { path: '/assets/app.css', headers: { 'user-agent': CHROME, accept: 'text/css' } });
  assert.equal(asset.passed, true);
});

test('the API and health check keep their own guards', () => {
  const guard = createMirrorGuard({ strict: true, onEvent: () => {} });
  assert.equal(run(guard, { path: '/healthz', headers: {} }).passed, true);
  assert.equal(run(guard, { path: '/api/submit', headers: {} }).passed, true);
});

test('the guard can be switched off entirely', () => {
  const guard = createMirrorGuard({ enabled: false, onEvent: () => {} });
  assert.equal(run(guard, { path: '/', headers: { 'user-agent': 'HTTrack 3.49' } }).passed, true);
});

test('bans expire and the store stays bounded', () => {
  const store = createBanStore({ ttlMs: 1_000, max: 3 });
  store.ban('a', 0);
  assert.equal(store.banned('a', 500), true);
  assert.equal(store.banned('a', 1_500), false, 'ban must lapse, never be permanent');

  for (const ip of ['1', '2', '3', '4', '5']) store.ban(ip, 0);
  assert.equal(store.size, 3);
  assert.equal(store.banned('5', 10), true, 'newest ban survives eviction');
});

test('isDocumentRequest prefers Sec-Fetch-Dest and falls back to Accept', () => {
  assert.equal(isDocumentRequest({ headers: { 'sec-fetch-dest': 'document' } }), true);
  assert.equal(isDocumentRequest({ headers: { 'sec-fetch-dest': 'style' } }), false);
  assert.equal(isDocumentRequest({ headers: { accept: 'text/html' } }), true);
  assert.equal(isDocumentRequest({ headers: { accept: 'image/avif' } }), false);
});

test('robots.txt names the bulk tools and hides the trap', () => {
  const body = robotsTxt();
  assert.match(body, /User-agent: HTTrack\nDisallow: \//);
  assert.match(body, new RegExp(`Disallow: ${HONEYPOT_PATH}`));
  assert.match(body, /Disallow: \/api\//);
});
