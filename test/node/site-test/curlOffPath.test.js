import test from 'node:test';
import assert from 'node:assert/strict';

const load = async () => {
  const mod = await import(`./api/curlGate.js?v=${Math.random()}`);
  return mod;
};

function withEnv(vars, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('the route does not exist unless BOTH the suffix and the key are set', async () => {
  const { curlEndpointEnabled } = await load();
  withEnv({ CURL_ENDPOINT: undefined, CURL_KEY: undefined }, () => {
    assert.equal(curlEndpointEnabled(), false);
  });
  withEnv({ CURL_ENDPOINT: '/secret', CURL_KEY: undefined }, () => {
    assert.equal(curlEndpointEnabled(), false, 'a suffix with no key must not mount');
  });
  withEnv({ CURL_ENDPOINT: undefined, CURL_KEY: 'k' }, () => {
    assert.equal(curlEndpointEnabled(), false, 'a key with no suffix must not mount');
  });
  withEnv({ CURL_ENDPOINT: '/secret', CURL_KEY: 'k' }, () => {
    assert.equal(curlEndpointEnabled(), true);
  });
});

test('the suffix is normalised, and the domain is never part of it', async () => {
  const { curlEndpointPath } = await load();
  for (const raw of ['/uchihaItachiismyfavcharcter', 'uchihaItachiismyfavcharcter',
    '//uchihaItachiismyfavcharcter', '/uchihaItachiismyfavcharcter/']) {
    withEnv({ CURL_ENDPOINT: raw }, () => {
      assert.equal(curlEndpointPath(), '/uchihaItachiismyfavcharcter', `from ${JSON.stringify(raw)}`);
    });
  }
  // A bare slash is not an endpoint: it would mount on the site root.
  withEnv({ CURL_ENDPOINT: '/' }, async () => {
    assert.equal(curlEndpointPath(), null);
  });
  withEnv({ CURL_ENDPOINT: '   ' }, () => {
    assert.equal(curlEndpointPath(), null);
  });
});

test('no host, scheme or port is ever read from configuration', async () => {
  const source = await (await import('node:fs/promises'))
    .readFile(new URL('./api/curlGate.js', import.meta.url), 'utf8');
  // The host must come from the request. Anything else is a hardcoded domain.
  assert.match(source, /req\.get\('host'\)/u);
  assert.equal(/process\.env\.(?:HOST|PORT|DOMAIN|SITE_URL)/u.test(source), false);
});

const hasExpress = await import('express').then(() => true, () => false);

test('createCurlRouter returns null when unconfigured, and a mount when armed', { skip: !hasExpress && 'express not installed' }, async () => {
  const { createCurlRouter } = await import('./api/curl.js');
  withEnv({ CURL_ENDPOINT: undefined, CURL_KEY: undefined }, () => {
    assert.equal(createCurlRouter(), null);
  });
  withEnv({ CURL_ENDPOINT: '/uchihaItachiismyfavcharcter', CURL_KEY: 'abc' }, () => {
    const mounted = createCurlRouter();
    assert.equal(mounted.path, '/uchihaItachiismyfavcharcter');
    assert.equal(typeof mounted.router, 'function');
  });
});

test('a wrong or missing key gets 404, never 403 — the path must not confirm itself', { skip: !hasExpress && 'express not installed' }, async () => {
  const { createCurlRouter } = await import('./api/curl.js');
  await withEnv({ CURL_ENDPOINT: '/secret', CURL_KEY: 'right-key' }, async () => {
    const { router } = createCurlRouter();

    const call = (headers) => new Promise((resolve) => {
      const req = {
        method: 'POST', url: '/', originalUrl: '/secret', query: {},
        headers, get(name) { return this.headers[String(name).toLowerCase()]; },
      };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ status: this.statusCode, body }); return this; },
        set() { return this; }, type() { return this; }, send() { return this; },
      };
      router(req, res, () => resolve({ status: 'passed-through' }));
    });

    assert.equal((await call({})).status, 404, 'missing key');
    assert.equal((await call({ 'x-curl-key': 'wrong' })).status, 404, 'wrong key');
    assert.equal((await call({ 'x-curl-key': 'right-ke' })).status, 404, 'prefix of the key');
    assert.equal((await call({ 'x-curl-key': 'right-keyy' })).status, 404, 'key plus a char');
  });
});

test('the key is accepted from a header, a bearer token, or ?key=', { skip: !hasExpress && 'express not installed' }, async () => {
  const { createCurlRouter } = await import('./api/curl.js');
  await withEnv({ CURL_ENDPOINT: '/secret', CURL_KEY: 'right-key' }, async () => {
    const { router } = createCurlRouter();

    const reached = (headers, query = {}) => new Promise((resolve) => {
      const req = {
        method: 'POST', url: '/nope', originalUrl: '/secret/nope', query,
        headers, get(name) { return this.headers[String(name).toLowerCase()]; },
      };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        // Past the gate, the catch-all 404 answers. A gate rejection logs
        // first; both are 404, so distinguish by whether multer ran at all.
        json() { resolve(true); return this; },
        set() { return this; }, type() { return this; }, send() { return this; },
      };
      router(req, res, () => resolve(true));
    });

    assert.equal(await reached({ 'x-curl-key': 'right-key' }), true);
    assert.equal(await reached({ authorization: 'Bearer right-key' }), true);
    assert.equal(await reached({}, { key: 'right-key' }), true);
  });
});

test('the off-path never imports the engine', async () => {
  const source = await (await import('node:fs/promises'))
    .readFile(new URL('./api/curl.js', import.meta.url), 'utf8');
  for (const forbidden of ['engine', 'processingQueue', 'engineCollect', 'engineDispatcher']) {
    assert.equal(
      new RegExp(`from\\s+'[^']*${forbidden}`, 'iu').test(source),
      false,
      `curl.js must not import ${forbidden}: it is conversion only`,
    );
  }
});
