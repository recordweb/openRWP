import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRecordHash, makeDid } from '../../core/index.js';
import {
  startServer, makeVersion, versionsPath, recordPath, NS, REC, PUBLIC, TYPE_DEFAULT, KEY,
} from './helpers.js';

const metadataPath = `${recordPath()}/metadata`;
const putMetadata = (s, body, opts = {}) => s.request(metadataPath, { method: 'PUT', body, ...opts });
const AGENT_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

async function post(s, v) {
  assert.equal((await s.request(versionsPath(), { method: 'POST', body: v })).status, 201);
}

test('the record endpoint needs authentication and the own namespace', async (t) => {
  const s = await startServer(); t.after(s.close);
  assert.equal((await s.request(recordPath(), { token: null })).status, 401);
  assert.equal((await s.request(recordPath())).status, 404);
  assert.equal((await s.request(recordPath('11111111-1111-4111-8111-111111111111'))).status, 403);
  assert.equal((await s.request(recordPath(), { method: 'DELETE' })).status, 405);
});

test('GET returns the complete Record: did, payload, metadata, recordHash', async (t) => {
  const s = await startServer(); t.after(s.close);
  const v = makeVersion({ content: 'sample text' });
  await post(s, v);
  const res = await s.request(recordPath());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('link'), `<${PUBLIC}/records/${NS}/${REC}/settings>; rel="settings"`);
  const record = await res.json();
  assert.deepEqual(Object.keys(record).sort(), ['did', 'metadata', 'payload', 'recordHash']);
  assert.equal(record.did, makeDid(NS, REC));
  assert.deepEqual(record.payload, [v]);
  assert.deepEqual(record.metadata, { core: { recordType: TYPE_DEFAULT }, extensions: [] });
  assert.match(record.recordHash, /^[0-9a-f]{64}$/);
  assert.equal(record.recordHash, computeRecordHash({ did: record.did, payload: record.payload, metadata: record.metadata }));
});

test('the payload is ordered: parents first, then createdAt, then versionHash', async (t) => {
  const s = await startServer(); t.after(s.close);
  const root = makeVersion({ content: 'v1', createdAt: '2026-10-10T13:00:00Z' });
  const late = makeVersion({ content: 'v2b', parents: [root.versionHash], createdAt: '2026-10-10T15:00:00Z' });
  const early = makeVersion({ content: 'v2', parents: [root.versionHash], createdAt: '2026-10-10T14:00:00Z' });
  for (const v of [root, late, early]) await post(s, v);
  const record = await (await s.request(recordPath())).json();
  assert.deepEqual(record.payload.map((v) => v.versionHash), [root.versionHash, early.versionHash, late.versionHash]);
});

test('a new record gets the owner from the namespace AgentRecord', async (t) => {
  const s = await startServer(); t.after(s.close);
  s.store.namespaces.get(NS).agentRecordId = AGENT_ID;
  await post(s, makeVersion());
  const record = await (await s.request(recordPath())).json();
  assert.deepEqual(record.metadata, {
    core: { recordType: TYPE_DEFAULT }, governance: { owner: `did:rwp:${NS}:${AGENT_ID}` }, extensions: [],
  });
});

test('PUT metadata replaces the metadata and changes only the recordHash', async (t) => {
  const s = await startServer(); t.after(s.close);
  await post(s, makeVersion());
  const before = await (await s.request(recordPath())).json();

  const next = {
    core: { recordType: TYPE_DEFAULT },
    governance: { classification: 'internal', tags: ['demo'] },
    extensions: [],
  };
  const res = await putMetadata(s, next);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), next);
  assert.deepEqual(await (await s.request(metadataPath)).json(), next);

  const after = await (await s.request(recordPath())).json();
  assert.deepEqual(after.payload, before.payload);
  assert.deepEqual(after.metadata, next);
  assert.notEqual(after.recordHash, before.recordHash);
  assert.equal(after.recordHash, computeRecordHash({ did: after.did, payload: after.payload, metadata: next }));
});

test('PUT metadata validation', async (t) => {
  const s = await startServer(); t.after(s.close);
  await post(s, makeVersion());
  const status = async (body) => (await putMetadata(s, body)).status;
  assert.equal(await status({}), 400);
  assert.equal(await status({ core: {} }), 400);
  assert.equal(await status({ core: { recordType: 'x' } }), 400);
  assert.equal(await status({ core: { recordType: TYPE_DEFAULT, schemaVersion: 'a'.repeat(64) } }), 400);
  assert.equal(await status({ core: { recordType: TYPE_DEFAULT }, other: 1 }), 400);
  assert.equal(await status({ core: { recordType: TYPE_DEFAULT }, governance: { tags: 'x' } }), 400);
  assert.equal(await status({ core: { recordType: TYPE_DEFAULT }, extensions: [{}] }), 400);
  assert.equal((await s.request(metadataPath, { method: 'PUT', raw: '{nope' })).status, 400);
  assert.equal((await s.request(metadataPath, { method: 'PUT', body: { core: { recordType: TYPE_DEFAULT } }, token: null })).status, 401);
  const unknown = '9f1c2a3b-4d5e-4f60-8a7b-0c1d2e3f4a5b';
  const missing = await s.request(`${recordPath(NS, unknown)}/metadata`, { method: 'PUT', body: { core: { recordType: TYPE_DEFAULT } } });
  assert.equal(missing.status, 404);
  // failed requests changed nothing
  assert.deepEqual((await (await s.request(metadataPath)).json()).core, { recordType: TYPE_DEFAULT });
});

test('records without stored metadata get the default (not persisted)', async (t) => {
  const s = await startServer(); t.after(s.close);
  await post(s, makeVersion());
  s.store.metadata.clear(); // a record created before metadata existed
  const record = await (await s.request(recordPath())).json();
  assert.deepEqual(record.metadata, { core: { recordType: TYPE_DEFAULT }, extensions: [] });
  assert.equal(s.store.metadata.size, 0);
});

test('the DID document: currentVersion empty, updated = created, controller from the AgentRecord', async (t) => {
  const s = await startServer(); t.after(s.close);
  const did = makeDid(NS, REC);
  await post(s, makeVersion());

  let doc = await (await s.request(`/did/${did}`, { token: null })).json();
  assert.equal(doc.currentVersion, '');
  assert.equal(doc.updated, doc.created);
  assert.equal(doc.controller, did);
  assert.equal(doc.verificationMethod[0].controller, did);
  assert.equal(doc.verificationMethod[0].publicKeyMultibase, KEY);

  await post(s, makeVersion({ content: 'second', parents: [(await (await s.request(recordPath())).json()).payload[0].versionHash] }));
  s.store.namespaces.get(NS).agentRecordId = AGENT_ID;
  doc = await (await s.request(`/did/${did}`, { token: null })).json();
  assert.equal(doc.currentVersion, '');
  assert.equal(doc.updated, doc.created);
  assert.equal(doc.controller, `did:rwp:${NS}:${AGENT_ID}`);
  assert.equal(doc.verificationMethod[0].controller, `did:rwp:${NS}:${AGENT_ID}`);
  assert.equal(doc.recordEndpoint, `${PUBLIC}/records/${NS}/${REC}`);
});