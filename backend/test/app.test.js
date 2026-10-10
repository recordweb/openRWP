import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVersionHash, validateVersion, makeDid, sha256Hex } from '../../core/index.js';
import { startServer, makeVersion, versionsPath, NS, REC, KEY } from './helpers.js';

test('health', async (t) => {
  const s = await startServer(); t.after(s.close);
  const res = await s.request('/health', { token: null });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok', service: 'openrwp', db: 'ok', core: 'ok' });
});

test('protected routes need the token; without configured token they are closed', async (t) => {
  const s = await startServer(); t.after(s.close);
  const v = makeVersion();
  assert.equal((await s.request(versionsPath(), { method: 'POST', body: v, token: null })).status, 401);
  assert.equal((await s.request(versionsPath(), { method: 'POST', body: v, token: 'wrong' })).status, 401);
  const closed = await startServer({ devToken: '' }); t.after(closed.close);
  assert.equal((await closed.request(versionsPath(), { method: 'POST', body: v, token: 'anything' })).status, 401);
});

test('append, read, content and resolver for a root version', async (t) => {
  const s = await startServer(); t.after(s.close);
  const v = makeVersion({ content: 'sample text', format: 'application/vnd.oasis.opendocument.text' });

  const created = await s.request(versionsPath(), { method: 'POST', body: v });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(await created.json(), {
    did: makeDid(NS, REC), versionHash: v.versionHash, recordEndpoint: `https://example.test/openrwp/records/${NS}/${REC}`,
  });

  assert.equal((await s.request(versionsPath(), { method: 'POST', body: v })).status, 200);

  const read = await s.request(`${versionsPath()}/${v.versionHash}`);
  assert.equal(read.status, 200);
  assert.match(read.headers.get('cache-control'), /^private/);
  const got = await read.json();
  assert.deepEqual(got, v);
  validateVersion(got);

  const content = await s.request(`${versionsPath()}/${v.versionHash}/content`);
  assert.equal(content.status, 200);
  assert.equal(content.headers.get('content-type'), 'application/vnd.oasis.opendocument.text');
  assert.equal(Buffer.from(await content.arrayBuffer()).toString(), 'sample text');

  const did = makeDid(NS, REC);
  const resolved = await s.request(`/did/${did}`, { token: null });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.headers.get('content-type'), 'application/did+ld+json');
  const doc = await resolved.json();
  assert.equal(doc.id, did);
  assert.equal(doc.currentVersion, v.versionHash);
  assert.equal(doc.controller, did);
  assert.equal(doc.recordEndpoint, `https://example.test/openrwp/records/${NS}/${REC}`);
  assert.deepEqual(doc.verificationMethod, [{
    id: `${did}#key-1`, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase: KEY,
  }]);

  const withHash = await s.request(`/did/${makeDid(NS, REC, v.versionHash)}`, { token: null });
  assert.equal(withHash.status, 200);
});

test('children, branches and currentVersion (newest head)', async (t) => {
  const s = await startServer(); t.after(s.close);
  const root = makeVersion({ content: 'v1', createdAt: '2026-10-10T13:00:00Z' });
  const child = makeVersion({ content: 'v2', parents: [root.versionHash], createdAt: '2026-10-10T14:00:00Z' });
  const branch = makeVersion({ content: 'v2b', parents: [root.versionHash], createdAt: '2026-10-10T15:00:00Z' });
  for (const v of [root, child, branch]) {
    assert.equal((await s.request(versionsPath(), { method: 'POST', body: v })).status, 201);
  }
  const doc = await (await s.request(`/did/${makeDid(NS, REC)}`, { token: null })).json();
  assert.equal(doc.currentVersion, branch.versionHash);
});

test('structural rules: unknown parent, second root, unknown record parent', async (t) => {
  const s = await startServer(); t.after(s.close);
  const ghost = 'a'.repeat(64);
  const orphan = makeVersion({ parents: [ghost] });
  let res = await s.request(versionsPath(), { method: 'POST', body: orphan });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'unknown-parent');

  const root = makeVersion();
  assert.equal((await s.request(versionsPath(), { method: 'POST', body: root })).status, 201);
  res = await s.request(versionsPath(), { method: 'POST', body: makeVersion({ content: 'other root' }) });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'root-exists');

  res = await s.request(versionsPath(), { method: 'POST', body: makeVersion({ content: 'x', parents: [ghost] }) });
  assert.deepEqual(await res.json(), { error: 'unknown-parent', versionHash: ghost });
});

test('rejections: tampering, ref, finalized, malformed, namespace, ids', async (t) => {
  const s = await startServer(); t.after(s.close);
  const v = makeVersion();

  const tampered = structuredClone(v);
  tampered.representations[0].primary = false;
  let res = await s.request(versionsPath(), { method: 'POST', body: tampered });
  assert.equal(res.status, 422);

  const withRef = { ...v, representations: [{ format: 'application/pdf', ref: 'urn:x', primary: true }] };
  res = await s.request(versionsPath(), { method: 'POST', body: withRef });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error, 'ref-not-supported');

  res = await s.request(versionsPath(), { method: 'POST', body: { ...v, state: 'finalized' } });
  assert.equal(res.status, 422);

  res = await s.request(versionsPath(), { method: 'POST', raw: '{not json' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'malformed-json');

  res = await s.request(versionsPath(), { method: 'POST', body: { ...v, extra: 1 } });
  assert.equal(res.status, 400);

  res = await s.request(versionsPath('11111111-1111-4111-8111-111111111111'), { method: 'POST', body: v });
  assert.equal(res.status, 403);

  res = await s.request(versionsPath('not-a-uuid'), { method: 'POST', body: v });
  assert.equal(res.status, 400);

  res = await s.request(`${versionsPath()}/${'b'.repeat(64)}`);
  assert.equal(res.status, 404);
  res = await s.request(`${versionsPath()}/sha256:abc`);
  assert.equal(res.status, 400);
});

test('payload size limit', async (t) => {
  const s = await startServer({ maxBodyBytes: 1024 }); t.after(s.close);
  const big = makeVersion({ content: 'x'.repeat(4000) });
  const res = await s.request(versionsPath(), { method: 'POST', body: big });
  assert.equal(res.status, 413);
});

test('resolver errors', async (t) => {
  const s = await startServer(); t.after(s.close);
  let res = await s.request(`/did/${makeDid(NS, REC)}`, { token: null });
  assert.equal(res.status, 404);
  res = await s.request('/did/did:rwp:bern.ch:abc', { token: null });
  assert.equal(res.status, 400);
  res = await s.request('/nothing', { token: null });
  assert.equal(res.status, 404);
  res = await s.request('/health', { method: 'POST', token: null });
  assert.equal(res.status, 405);
});

test('hash helper sanity', () => {
  assert.equal(computeVersionHash(makeVersion()), makeVersion().versionHash);
  assert.equal(sha256Hex('abc').length, 64);
});