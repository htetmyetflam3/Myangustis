import test from 'node:test';
import assert from 'node:assert/strict';
import { createEdgeGuard, edgeContext } from './edge.js';
function response() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}
test('direct hosting ignores forgeable edge identity headers', () => {
  const req = {
    path: '/api/submit',
    headers: {
      'cf-connecting-ip': '203.0.113.99',
      'cf-ipcountry': 'MM',
      'x-forwarded-for': '203.0.113.98',
    },
    ip: '198.51.100.4',
    socket: { remoteAddress: '198.51.100.4' },
    protocol: 'http',
  };
  const res = response();
  createEdgeGuard({ secret: '' })(req, res, () => {});
  edgeContext(req, res, () => {});
  assert.equal(req.edge.verified, false);
  assert.equal(req.edge.ip, '198.51.100.4');
  assert.equal(req.edge.country, null);
  assert.equal(req.edge.viaWorker, false);
});
test('edge identity is trusted only after constant-time secret verification', () => {
  const rejected = {
    path: '/api/submit',
    headers: { 'x-edge-secret': 'wrong' },
  };
  const rejectedResponse = response();
  createEdgeGuard({ secret: 'correct-secret' })(rejected, rejectedResponse, () => {
    throw new Error('invalid secret reached next middleware');
  });
  assert.equal(rejectedResponse.statusCode, 403);
  const accepted = {
    path: '/api/submit',
    headers: {
      'x-edge-secret': 'correct-secret',
      'cf-connecting-ip': '203.0.113.10',
      'cf-ipcountry': 'MM',
      'x-edge-worker': '1',
    },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    protocol: 'http',
  };
  const acceptedResponse = response();
  createEdgeGuard({ secret: 'correct-secret' })(accepted, acceptedResponse, () => {});
  edgeContext(accepted, acceptedResponse, () => {});
  assert.equal(accepted.edge.verified, true);
  assert.equal(accepted.edge.ip, '203.0.113.10');
  assert.equal(accepted.edge.country, 'MM');
  assert.equal(accepted.edge.viaWorker, true);
});