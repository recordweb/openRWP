import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRecordHash, validateRecord, validateMetadata, defaultMetadata, buildRecord, orderVersions,
  createVersion, createRepresentation, makeDid,
} from '../index.js';
import { rootSchema, rootAgent } from './vectors.js';

const OWNER = 'did:rwp:d2d14675-50c9-463d-b564-1ea50644c836:efd09e7b-5f65-4637-b06c-404a9da97f0b';

test('the recordHash of the root records is reproduced', async () => {
  for (const record of [rootSchema, rootAgent]) {
    assert.equal(await computeRecordHash(record), record.recordHash);
    await validateRecord(record);
    validateMetadata(record.metadata);
  }
});

test('changed metadata is detected', async () => {
  const record = structuredClone(rootAgent);
  record.metadata.governance.classification = 'internal';
  await assert.rejects(() => validateRecord(record), { code: 'record-hash-mismatch' });
});

test('transit incoming requires a provenanceRef, other values forbid it', () => {
  const base = defaultMetadata({ recordType: rootAgent.did, schemaVersion: rootAgent.payload[0].versionHash, owner: OWNER });
  const incoming = structuredClone(base);
  incoming.core.transit = 'incoming';
  assert.throws(() => validateMetadata(incoming), { code: 'invalid-metadata' });
  incoming.core.provenanceRef = { sourceDescription: 'mail', capturedAt: '2026-11-03T12:00:00Z', capturedBy: 'reception' };
  validateMetadata(incoming);
  const internal = structuredClone(base);
  internal.core.provenanceRef = incoming.core.provenanceRef;
  assert.throws(() => validateMetadata(internal), { code: 'invalid-metadata' });
});

test('metadata rules', () => {
  const base = defaultMetadata({ recordType: rootAgent.did, schemaVersion: rootAgent.payload[0].versionHash });
  validateMetadata(base);
  assert.throws(() => validateMetadata({ ...base, extra: 1 }), { code: 'unknown-field' });
  assert.throws(() => validateMetadata({ ...base, core: { ...base.core, transit: 'sideways' } }), { code: 'invalid-metadata' });
  assert.throws(() => validateMetadata({ ...base, core: { ...base.core, schemaVersion: 'abc' } }), { code: 'invalid-metadata' });
  assert.throws(() => validateMetadata({ ...base, governance: { owner: 'somebody' } }), { code: 'invalid-metadata' });
  assert.throws(() => validateMetadata({ ...base, extensions: [{ type: 'x' }] }), { code: 'invalid-metadata' });
  validateMetadata({ ...base, extensions: [{ type: rootAgent.did, namespaces: [] }] });
});

test('buildRecord assembles did, metadata, payload and recordHash', async () => {
  const did = makeDid('example', 'note-1');
  const metadata = defaultMetadata({ recordType: rootAgent.did, schemaVersion: rootAgent.payload[0].versionHash, owner: OWNER });
  const first = await createVersion({ state: 'finalized', createdAt: '2026-11-03T12:00:00Z', representations: [await createRepresentation({ format: 'text/markdown', content: 'v1' })] });
  const second = await createVersion({ parents: [first.versionHash], createdAt: '2026-11-03T12:05:00Z', representations: [await createRepresentation({ format: 'text/markdown', content: 'v2' })] });
  const record = await buildRecord({ did, metadata, payload: [second, first] });
  assert.deepEqual(Object.keys(record), ['did', 'metadata', 'payload', 'recordHash']);
  assert.deepEqual(record.payload.map((v) => v.versionHash), [first.versionHash, second.versionHash]);
  await validateRecord(record);
});

test('a record without payload is valid', async () => {
  const metadata = defaultMetadata({ recordType: rootAgent.did, schemaVersion: rootAgent.payload[0].versionHash });
  const record = await buildRecord({ did: makeDid('example', 'agent-1'), metadata });
  assert.equal('payload' in record, false);
  await validateRecord(record);
});

test('unknown parents and cycles are rejected', async () => {
  const metadata = defaultMetadata({ recordType: rootAgent.did, schemaVersion: rootAgent.payload[0].versionHash });
  const rep = await createRepresentation({ format: 'text/markdown', content: 'x' });
  const orphan = await createVersion({ parents: [`sha256:${'a'.repeat(64)}`], representations: [rep] });
  const record = await buildRecord({ did: makeDid('example', 'note-2'), metadata, payload: [orphan] });
  await assert.rejects(() => validateRecord(record), { code: 'unknown-parent' });
  const a = { versionHash: 'a', parents: ['b'], createdAt: '2026-01-01T00:00:00Z' };
  const b = { versionHash: 'b', parents: ['a'], createdAt: '2026-01-01T00:00:00Z' };
  assert.throws(() => orderVersions([a, b]), { code: 'cycle' });
});
