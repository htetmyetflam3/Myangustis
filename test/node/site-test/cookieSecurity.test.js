import test from 'node:test';
import assert from 'node:assert/strict';
import { cookieSecurityBanner, cookieSecureEnabled, cookieSameSite } from './edge.js';

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('COOKIE_SECURE=false is announced, not silently honoured', () => {
  withEnv({ COOKIE_SECURE: 'false', COOKIE_SAMESITE: 'strict' }, () => {
    // The override still applies — forcing it closed would break the
    // documented plain-HTTP preproduction run.
    assert.equal(cookieSecureEnabled(), false);
    const banner = cookieSecurityBanner();
    assert.match(banner, /COOKIE_SECURE=false/);
    assert.match(banner, /without the Secure flag/i);
    assert.match(banner, /before publishing/i);
  });
});

test('Secure cookies say nothing', () => {
  withEnv({ COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'strict' }, () => {
    assert.equal(cookieSecureEnabled(), true);
    assert.equal(cookieSecurityBanner(), null);
  });
});

test('COOKIE_SECURE=false is flagged for every caller, with no posture to hide behind', () => {
  // MODE is gone: there is no 'development' in which this warning is skipped.
  withEnv({ COOKIE_SECURE: 'false', COOKIE_SAMESITE: 'strict' }, () => {
    assert.match(cookieSecurityBanner(), /COOKIE_SECURE=false/);
  });
});

test('unset COOKIE_SECURE defaults to Secure, with or without a trusted proxy', () => {
  // Previously this depended on MODE: unset meant insecure in development.
  // With MODE gone the safe answer is the only answer.
  for (const trustProxy of [undefined, 'loopback', '']) {
    withEnv({ COOKIE_SECURE: undefined, TRUST_PROXY: trustProxy }, () => {
      assert.equal(cookieSecureEnabled(), true, `TRUST_PROXY=${JSON.stringify(trustProxy)}`);
    });
  }
});

test('a weakened SameSite is announced', () => {
  withEnv({ COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'lax' }, () => {
    assert.equal(cookieSameSite(), 'lax');
    assert.match(cookieSecurityBanner(), /COOKIE_SAMESITE=lax/);
  });
  withEnv({ COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'nonsense' }, () => {
    assert.equal(cookieSameSite(), 'strict');
    assert.equal(cookieSecurityBanner(), null);
  });
});
