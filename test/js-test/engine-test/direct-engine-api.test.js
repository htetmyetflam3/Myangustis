import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.CURL_KEY = 'private-test-only-key';
delete process.env.CURL_KEY_SHA256;
delete process.env.CURL_MAX_MB;
const { createServer } = await import('../../../Architecture/host/index.js');
const { createApp } = await import('../../../Architecture/host/server.js');

test('private engine API reuses Site key, bypasses sessions, and yields actual engine output', async t => {
  const listener = await new Promise(resolve => {
    const server = createServer().listen(0, '127.0.0.1', () => resolve(server));
  });
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const url = `http://127.0.0.1:${listener.address().port}/UchihaItachiIsMyFavChar`;
  const post = (body, headers = { 'x-curl-key': process.env.CURL_KEY }) => fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const request = { sourceText: 'ကောင်းကင် စမ်းသပ်။\n', flag: 'syllable' };
  assert.equal((await post(request, {})).status, 404);
  assert.equal((await post(request, { 'x-curl-key': 'wrong' })).status, 404);
  assert.equal((await fetch(`${url}?key=${process.env.CURL_KEY}`, { method: 'POST' })).status, 404);
  delete process.env.CURL_KEY;
  assert.equal((await post(request, { 'x-curl-key': 'private-test-only-key' })).status, 404);
  process.env.CURL_KEY = 'private-test-only-key';
  process.env.CURL_KEY_SHA256 = crypto.createHash('sha256').update('another-test-key').digest('hex');
  assert.equal((await post(request)).status, 404);
  const hashedKey = await post(request, { authorization: 'Bearer another-test-key' });
  assert.equal(hashedKey.status, 200);
  delete process.env.CURL_KEY_SHA256;
  for (const body of [{ sourceText: 'x' }, { flag: 'pos' }, { flag: 'raw', sourceText: 'x' },
    { ...request, hash: 'x'.repeat(72) }, { ...request, debug: true }]) {
    assert.equal((await post(body)).status, 400);
  }
  // The default private lane does not impose the normal 16 KiB JSON limit.
  assert.equal((await post({ sourceText: 'x'.repeat(17 * 1024) })).status, 400);
  const syllable = await post(request);
  assert.equal(syllable.status, 200);
  assert.equal(syllable.headers.get('cache-control'), 'no-store');
  assert.equal(syllable.headers.get('set-cookie'), null);
  const syllableBody = await syllable.json();
  assert.equal(syllableBody.flag, 'syllable');
  assert.equal(typeof syllableBody.results[0], 'string');
  assert.match(syllableBody.results[0], /ကောင်း/);
  const pos = await post({ ...request, flag: 'pos' });
  assert.equal(pos.status, 200);
  const posBody = await pos.json();
  assert.equal(posBody.flag, 'pos');
  assert.match(posBody.results[0].syllable, /ကောင်း/);
  assert.match(posBody.results[0].rawPos, /\{[^{}]+\}/);
  const malformed = await fetch(url, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-curl-key': process.env.CURL_KEY,
  }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await fetch(url)).status, 404);
});

test('standalone host app also exposes private engine route and honors optional Site size limit', async t => {
  process.env.CURL_MAX_MB = '1';
  const listener = await new Promise(resolve => {
    const server = createApp().listen(0, '127.0.0.1', () => resolve(server));
  });
  delete process.env.CURL_MAX_MB;
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const url = `http://127.0.0.1:${listener.address().port}/UchihaItachiIsMyFavChar`;
  const res = await fetch(url, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-curl-key': process.env.CURL_KEY,
  }, body: JSON.stringify({ flag: 'syllable', sourceText: 'x'.repeat(1024 * 1024) }) });
  assert.equal(res.status, 413);
});
