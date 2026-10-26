import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCookie, encodeCookie } from './codec.js';
test('authenticated cookie codec round-trips objects with fresh nonces', () => {
  const data = { id: 'USER-123', ip: '127.0.0.1', country: null };
  const first = encodeCookie(data);
  const second = encodeCookie(data);
  assert.notEqual(first, second);
  assert.deepEqual(decodeCookie(first), data);
  assert.deepEqual(decodeCookie(second), data);
});
test('authenticated cookie codec rejects tampering and malformed values', () => {
  const valid = encodeCookie({ id: 'USER-123' });
  const parts = valid.split('.');
  const encrypted = Buffer.from(parts[2], 'base64url');
  encrypted[0] ^= 1;
  parts[2] = encrypted.toString('base64url');
  assert.equal(decodeCookie(parts.join('.')), null);
  assert.equal(decodeCookie('not-a-cookie'), null);
  assert.equal(decodeCookie('x'.repeat(8193)), null);
});