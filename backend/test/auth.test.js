import test from 'node:test';
import assert from 'node:assert/strict';
import { createDpopProof } from '../../core/index.js';
import { startServer, versionsPath, newKeyPem, ACCESS_TOKEN, PUBLIC } from './helpers.js';

const missing = `${versionsPath()}/${'b'.repeat(64)}`; // authenticated requests to it end with 404

test('a valid DPoP request is accepted', async (t) => {
  const s = await startServer(); t.after(s.close);
  assert.equal((await s.request(missing)).status, 404);
});

test('without credentials: 401 with a DPoP challenge', async (t) => {
  const s = await startServer(); t.after(s.close);
  const res = await s.request(missing, { token: null });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('www-authenticate'), 'DPoP algs="EdDSA"');
  assert.equal((await res.json()).error, 'unauthorized');
});

test('the Bearer scheme is not accepted for DPoP-bound tokens', async (t) => {
  const s = await startServer(); t.after(s.close);
  assert.equal((await s.request(missing, { scheme: 'Bearer' })).status, 401);
});

test('unknown token, expired token and proof from another key are rejected as invalid_token', async (t) => {
  const s = await startServer(); t.after(s.close);
  let res = await s.request(missing, { token: 'not-a-known-token' });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /error="invalid_token"/);

  res = await s.request(missing, { key: newKeyPem() });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'invalid_token');

  for (const entry of s.store.tokens.values()) entry.expiresAt = Date.now() - 1;
  assert.equal((await s.request(missing)).status, 401);
});

test('proof problems: missing, replayed, wrong method, wrong URL, no ath', async (t) => {
  const s = await startServer(); t.after(s.close);
  const make = (extra = {}) => createDpopProof({
    privateKeyPem: s.devicePem, method: 'GET', url: `${PUBLIC}${missing}`, accessToken: ACCESS_TOKEN, ...extra,
  });
  const expectProofError = async (opts) => {
    const res = await s.request(missing, opts);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'invalid_dpop_proof');
  };

  await expectProofError({ proof: '' });

  const once = make();
  assert.equal((await s.request(missing, { proof: once })).status, 404);
  await expectProofError({ proof: once });

  await expectProofError({ proof: make({ method: 'POST' }) });
  await expectProofError({ proof: make({ url: `${PUBLIC}/records/other` }) });
  await expectProofError({ proof: make({ accessToken: undefined }) });
  await expectProofError({ proof: make({ iat: Math.floor(Date.now() / 1000) - 3600 }) });
});

test('a revoked device is rejected immediately', async (t) => {
  const s = await startServer(); t.after(s.close);
  assert.equal((await s.request(missing)).status, 404);
  s.store.devices.get(1).revokedAt = new Date();
  const res = await s.request(missing);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'invalid_token');
});

test('a device may only use its own namespace', async (t) => {
  const s = await startServer(); t.after(s.close);
  const other = '11111111-1111-4111-8111-111111111111';
  const res = await s.request(versionsPath(other) + `/${'b'.repeat(64)}`);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'forbidden');
  // a device registered for another (active) namespace may not use NS
  s.store.namespaces.set(other, { namespace: other, authorPublicKey: 'k', status: 'active' });
  s.store.devices.get(1).namespace = other;
  assert.equal((await s.request(missing)).status, 403);
});

test('public routes need no authentication', async (t) => {
  const s = await startServer(); t.after(s.close);
  assert.equal((await s.request('/health', { token: null })).status, 200);
});