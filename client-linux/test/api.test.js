import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateEd25519KeyPair, jwkThumbprint, publicJwkFromPrivateKeyPem } from '../../core/index.js';
import { ApiClient, ApiError } from '../lib/api.js';
import { startFakeServer } from '../testlib/fake-server.js';

const NS = '4d3c45e8-1785-4f52-90f7-b9f5811935ad';
const REC = '28b91a20-f7cd-456b-a290-5d7088fdba74';
const H1 = 'a'.repeat(64);
const { privateKeyPem } = generateEd25519KeyPair();

const makeClient = (fake, extra = {}) => new ApiClient({ baseUrl: fake.baseUrl, privateKeyPem, ...extra });

async function withFake(options, fn) {
  const fake = await startFakeServer(options);
  try {
    await fn(fake, makeClient(fake));
  } finally {
    await fake.close();
  }
}

const gets = (fake) => fake.log.filter((l) => l.startsWith('GET')).length;

test('one token is reused; every request carries a fresh proof', async () => {
  await withFake({}, async (fake, api) => {
    fake.handler = () => ({ json: { ok: true } });
    await api.getRecord(NS, REC);
    await api.getRecord(NS, REC);
    await api.getRecord(NS, REC);
    assert.equal(fake.tokenRequests, 1);
    assert.equal(gets(fake), 3);
  });
});

test('token is renewed shortly before it expires', async () => {
  let t = 1_000_000;
  await withFake({ expiresIn: 600 }, async (fake) => {
    const api = makeClient(fake, { now: () => t });
    fake.handler = () => ({ json: {} });
    await api.getRecord(NS, REC);
    t += 569_000;
    await api.getRecord(NS, REC);
    assert.equal(fake.tokenRequests, 1);
    t += 2_000;
    await api.getRecord(NS, REC);
    assert.equal(fake.tokenRequests, 2);
  });
});

test('a 401 triggers one retry with a new token', async () => {
  await withFake({}, async (fake, api) => {
    fake.handler = () => ({ json: { ok: true } });
    await api.getRecord(NS, REC);
    fake.expireTokens();
    const record = await api.getRecord(NS, REC);
    assert.deepEqual(record, { ok: true });
    assert.equal(fake.tokenRequests, 2);
  });
});

test('a second 401 is reported as ApiError', async () => {
  await withFake({}, async (fake, api) => {
    fake.denyAuth = true;
    await assert.rejects(
      api.getRecord(NS, REC),
      (err) => err instanceof ApiError && err.status === 401 && err.code === 'invalid_token',
    );
    assert.equal(fake.tokenRequests, 2);
    assert.equal(gets(fake), 2);
  });
});

test('unknown or revoked device gives device-not-registered', async () => {
  await withFake({ devices: new Set() }, async (fake, api) => {
    await assert.rejects(api.getRecord(NS, REC), { code: 'device-not-registered' });
    assert.equal(gets(fake), 0);
  });
});

test('a registered device (by thumbprint) gets a token', async () => {
  const jkt = jwkThumbprint(publicJwkFromPrivateKeyPem(privateKeyPem));
  await withFake({ devices: new Set([jkt]) }, async (fake, api) => {
    fake.handler = () => ({ json: { ok: true } });
    assert.deepEqual(await api.getRecord(NS, REC), { ok: true });
  });
});

test('appendVersion: 201 is created, 200 is identical, 409 keeps the server code', async () => {
  await withFake({}, async (fake, api) => {
    const version = { versionHash: H1, state: 'draft', parents: [] };
    const result = { did: `did:rwp:${NS}:${REC}`, versionHash: H1, recordEndpoint: `${fake.baseUrl}/records/${NS}/${REC}` };
    let received;
    fake.handler = ({ method, path, json }) => {
      received = { method, path, json };
      return { status: 201, json: result };
    };
    assert.deepEqual(await api.appendVersion(NS, REC, version), { created: true, ...result });
    assert.deepEqual(received, { method: 'POST', path: `/records/${NS}/${REC}/versions`, json: version });

    fake.handler = () => ({ status: 200, json: result });
    assert.equal((await api.appendVersion(NS, REC, version)).created, false);

    fake.handler = () => ({ status: 409, json: { error: 'unknown-parent', versionHash: H1 } });
    await assert.rejects(
      api.appendVersion(NS, REC, version),
      (err) => err instanceof ApiError && err.status === 409 && err.code === 'unknown-parent' && err.body.versionHash === H1,
    );
  });
});

test('getContent returns the raw bytes', async () => {
  await withFake({}, async (fake, api) => {
    fake.handler = () => ({ buffer: Buffer.from([1, 2, 3, 255]) });
    const bytes = await api.getContent(NS, REC, H1);
    assert.ok(Buffer.isBuffer(bytes));
    assert.deepEqual([...bytes], [1, 2, 3, 255]);
  });
});

test('sync sends the known heads', async () => {
  await withFake({}, async (fake, api) => {
    let received;
    fake.handler = ({ json }) => {
      received = json;
      return { json: { versions: [], heads: [] } };
    };
    assert.deepEqual(await api.sync(NS, REC, [H1]), { versions: [], heads: [] });
    assert.deepEqual(received, { have: [H1] });
  });
});

test('invalid arguments are rejected before any request', async () => {
  await withFake({}, async (fake, api) => {
    await assert.rejects(api.getRecord('x', REC), { code: 'invalid-argument' });
    await assert.rejects(api.getVersion(NS, REC, 'abc'), { code: 'invalid-argument' });
    await assert.rejects(api.sync(NS, REC, ['abc']), { code: 'invalid-argument' });
    assert.equal(fake.log.length, 0);
  });
});

test('an unreachable server gives a network error', async () => {
  const fake = await startFakeServer();
  const api = makeClient(fake);
  await fake.close();
  await assert.rejects(api.getRecord(NS, REC), { code: 'network' });
});