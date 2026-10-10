import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { createDpopProof, jwkThumbprint, publicJwkFromPrivateKeyPem, sha256Hex } from '../../core/index.js';
import { createTokenHandler } from '../token.js';

const PUBLIC = 'https://example.test/openrwp';
const TOKEN_URL = `${PUBLIC}/token`;
const newKey = () => generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });

class FakeDeviceStore {
  constructor() { this.devices = new Map(); this.jtis = new Set(); this.tokens = new Map(); }
  addDevice(pem, extra = {}) {
    const jkt = jwkThumbprint(publicJwkFromPrivateKeyPem(pem));
    this.devices.set(jkt, { id: this.devices.size + 1, namespace: 'ns', label: 'test', revokedAt: null, namespaceStatus: 'active', ...extra });
  }
  async getDeviceByJkt(jkt) { return this.devices.get(jkt) ?? null; }
  async recordDpopJti(jkt, jti) {
    const k = `${jkt}/${jti}`;
    if (this.jtis.has(k)) return false;
    this.jtis.add(k);
    return true;
  }
  async createToken(deviceId, tokenHash, ttl) { this.tokens.set(tokenHash, { deviceId, ttl }); }
}

async function start() {
  const store = new FakeDeviceStore();
  const handler = createTokenHandler({ store, config: { publicBaseUrl: PUBLIC } });
  const server = http.createServer((req, res) => handler(req, res).catch(() => { res.writeHead(500); res.end(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (headers = {}, body = 'grant_type=client_credentials') =>
    fetch(`${base}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body });
  return { store, post, base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('a registered device receives a DPoP-bound access token', async (t) => {
  const s = await start(); t.after(s.close);
  const pem = newKey();
  s.store.addDevice(pem);
  const res = await s.post({ DPoP: createDpopProof({ privateKeyPem: pem, method: 'POST', url: TOKEN_URL }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.token_type, 'DPoP');
  assert.equal(body.expires_in, 600);
  assert.match(body.access_token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(s.store.tokens.get(sha256Hex(body.access_token)), { deviceId: 1, ttl: 600 });
  assert.equal(s.store.tokens.size, 1);
});

test('a proof cannot be used twice (replay)', async (t) => {
  const s = await start(); t.after(s.close);
  const pem = newKey();
  s.store.addDevice(pem);
  const headers = { DPoP: createDpopProof({ privateKeyPem: pem, method: 'POST', url: TOKEN_URL }) };
  assert.equal((await s.post(headers)).status, 200);
  const again = await s.post(headers);
  assert.equal(again.status, 400);
  const body = await again.json();
  assert.equal(body.error, 'invalid_dpop_proof');
  assert.match(body.error_description, /jti/);
  assert.equal(s.store.tokens.size, 1);
});

test('unknown, revoked and suspended devices get invalid_client; no jti is stored', async (t) => {
  const s = await start(); t.after(s.close);
  const proofFor = (pem) => ({ DPoP: createDpopProof({ privateKeyPem: pem, method: 'POST', url: TOKEN_URL }) });
  let res = await s.post(proofFor(newKey()));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'invalid_client');

  const revoked = newKey();
  s.store.addDevice(revoked, { revokedAt: new Date() });
  assert.equal((await s.post(proofFor(revoked))).status, 401);

  const suspended = newKey();
  s.store.addDevice(suspended, { namespaceStatus: 'suspended' });
  assert.equal((await s.post(proofFor(suspended))).status, 401);

  assert.equal(s.store.jtis.size, 0);
  assert.equal(s.store.tokens.size, 0);
});

test('invalid requests are rejected with OAuth error codes', async (t) => {
  const s = await start(); t.after(s.close);
  const pem = newKey();
  s.store.addDevice(pem);
  const proof = (extra = {}) => ({ DPoP: createDpopProof({ privateKeyPem: pem, method: 'POST', url: TOKEN_URL, ...extra }) });

  let res = await s.post({});
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_dpop_proof');

  res = await s.post(proof(), 'grant_type=password');
  assert.equal((await res.json()).error, 'unsupported_grant_type');

  res = await s.post({ ...proof(), 'Content-Type': 'application/json' }, '{"grant_type":"client_credentials"}');
  assert.equal((await res.json()).error, 'invalid_request');

  res = await s.post({ DPoP: createDpopProof({ privateKeyPem: pem, method: 'GET', url: TOKEN_URL }) });
  assert.equal((await res.json()).error, 'invalid_dpop_proof');

  res = await s.post({ DPoP: createDpopProof({ privateKeyPem: pem, method: 'POST', url: `${PUBLIC}/other` }) });
  assert.equal((await res.json()).error, 'invalid_dpop_proof');

  res = await s.post({ DPoP: createDpopProof({ privateKeyPem: pem, method: 'POST', url: TOKEN_URL, iat: Math.floor(Date.now() / 1000) - 3600 }) });
  assert.equal((await res.json()).error, 'invalid_dpop_proof');

  res = await s.post(proof(), 'x'.repeat(5000));
  assert.equal((await res.json()).error, 'invalid_request');
  assert.equal(s.store.tokens.size, 0);
});