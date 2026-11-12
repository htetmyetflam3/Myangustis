import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { publicRouter } from '../../../Architecture/host/api/public-api.js';

test('public API uses POST text, 72-character hashes and the POS placeholder', async t => {
  const sessions = new Map();
  const app = express();
  app.use((req, _res, next) => {
    const key = req.get('x-test-session') || 'one';
    if (!sessions.has(key)) sessions.set(key, {});
    req.session = sessions.get(key);
    next();
  });
  app.use('/api', publicRouter);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const req = (url, options = {}) => fetch(`${base}${url}`, options);
  const jsonPost = sourceText => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceText }) });

  const handshake = await req('/handshake', { method: 'POST' });
  assert.equal(handshake.status, 201);
  const { handle, engineHash } = await handshake.json();
  assert.equal(engineHash.length, 72);
  const url = `/tokenizer/${handle}`;
  const unsupported = await req(`${url}/syllable`);
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'POST');
  assert.equal((await req(`${url}/syllable`, jsonPost(123))).status, 400);
  const sourceText = 'ကောင်းကင် စမ်းသပ်။\n';
  const positions = await req(`${url}/syllable`, jsonPost(sourceText));
  assert.equal(positions.status, 200);
  assert.equal((await positions.json()).positions[0].index, 'က');
  const raw = await req(`${url}/raw`, jsonPost(sourceText));
  assert.equal(raw.status, 200);
  assert.equal((await raw.json()).message, 'pos tagging finish');
  assert.ok(!JSON.stringify(sessions.get('one')).includes(sourceText));
  const foreign = await req(`${url}/syllable`, { ...jsonPost(sourceText), headers: { 'content-type': 'application/json', 'x-test-session': 'two' } });
  assert.equal(foreign.status, 404);
});
