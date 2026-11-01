import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.API_KEY = 'test-only-api-key';
process.env.ENGINE_ALLOWED_IPS = '127.0.0.1';
const { createApp } = await import('../../../tools-box/js/api-server.js');

test('tools API reads caller files and streams positional results through BindEngine', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-engine-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const file = path.join(tmp, 'source.txt');
  fs.writeFileSync(file, 'ကောင်းကင် စမ်းသပ်။\n');
  const server = await new Promise(resolve => {
    const listener = createApp().listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(`${base}/process`, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-api-key': 'test-only-api-key',
  }, body: JSON.stringify(body) });
  const result = await post({ srcPath: file });
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.hash.length, 72);
  assert.equal(data.syllable[0].index, 'က');
  assert.equal((await post({ srcPath: file, hash: 'short' })).status, 400);
  assert.equal((await post({ srcPath: path.join(tmp, 'missing') })).status, 404);
  assert.deepEqual(fs.readdirSync(tmp), ['source.txt']);
});
