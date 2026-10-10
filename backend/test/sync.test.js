import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, makeVersion, versionsPath, NS, REC } from './helpers.js';

const syncPath = (ns = NS, rec = REC) => `/records/${ns}/${rec}/sync`;

async function seed(s) {
  const root = makeVersion({ content: 'v1', createdAt: '2026-10-10T13:00:00Z' });
  const child = makeVersion({ content: 'v2', parents: [root.versionHash], createdAt: '2026-10-10T14:00:00Z' });
  const branch = makeVersion({ content: 'v2b', parents: [root.versionHash], createdAt: '2026-10-10T15:00:00Z' });
  for (const v of [root, child, branch]) {
    assert.equal((await s.request(versionsPath(), { method: 'POST', body: v })).status, 201);
  }
  return { root, child, branch };
}

test('sync with empty have returns the whole graph (parents first, no content) and all heads', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { root, child, branch } = await seed(s);
  const res = await s.request(syncPath(), { method: 'POST', body: { have: [] } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.versions.length, 3);
  assert.equal(body.versions[0].versionHash, root.versionHash);
  for (const v of body.versions) {
    for (const r of v.representations) {
      assert.equal('content' in r, false);
      assert.match(r.contentHash, /^[0-9a-f]{64}$/);
    }
  }
  assert.deepEqual(body.heads.map((h) => h.versionHash).sort(), [child.versionHash, branch.versionHash].sort());
  assert.ok(body.heads.every((h) => h.state === 'draft'));
});

test('sync returns only what the client lacks; unknown hashes are ignored', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { child, branch } = await seed(s);
  let body = await (await s.request(syncPath(), { method: 'POST', body: { have: [child.versionHash] } })).json();
  assert.deepEqual(body.versions.map((v) => v.versionHash), [branch.versionHash]);
  assert.equal(body.heads.length, 2);

  body = await (await s.request(syncPath(), { method: 'POST', body: { have: ['f'.repeat(64)] } })).json();
  assert.equal(body.versions.length, 3);

  body = await (await s.request(syncPath(), { method: 'POST', body: { have: [child.versionHash, branch.versionHash] } })).json();
  assert.deepEqual(body.versions, []);
});

test('sync validation and access', async (t) => {
  const s = await startServer(); t.after(s.close);
  await seed(s);
  assert.equal((await s.request(syncPath(), { method: 'POST', body: { have: [] }, token: null })).status, 401);
  assert.equal((await s.request(syncPath(), { method: 'POST', body: { have: ['sha256:abc'] } })).status, 400);
  assert.equal((await s.request(syncPath(), { method: 'POST', body: {} })).status, 400);
  assert.equal((await s.request(syncPath(), { method: 'POST', raw: '{oops' })).status, 400);
  assert.equal((await s.request(syncPath(), { method: 'GET' })).status, 405);
  const unknown = '9f1c2a3b-4d5e-4f60-8a7b-0c1d2e3f4a5b';
  assert.equal((await s.request(syncPath(NS, unknown), { method: 'POST', body: { have: [] } })).status, 404);
});