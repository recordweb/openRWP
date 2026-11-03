import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVersionHash, createVersion, createRepresentation, validateVersion, nowIso, isTimestamp } from '../index.js';
import { rootSchema, rootAgent } from './vectors.js';

test('the versionHash of the root records is reproduced', async () => {
  for (const record of [rootSchema, rootAgent]) {
    const version = record.payload[0];
    assert.equal(await computeVersionHash(version), version.versionHash);
    await validateVersion(version);
  }
});

test('a changed timestamp is detected', async () => {
  const version = structuredClone(rootSchema.payload[0]);
  version.modifiedAt = '2026-10-26T16:00:01Z';
  await assert.rejects(() => validateVersion(version), { code: 'version-hash-mismatch' });
});

test('createVersion builds a valid draft', async () => {
  const rep = await createRepresentation({ format: 'text/markdown', content: '# Note' });
  const version = await createVersion({ representations: [rep] });
  assert.equal(version.state, 'draft');
  assert.deepEqual(version.parents, []);
  assert.equal(version.createdAt, version.modifiedAt);
  await validateVersion(version);
});

test('a finalised version continues from its parent', async () => {
  const rep = await createRepresentation({ format: 'text/markdown', content: 'v1' });
  const first = await createVersion({ state: 'finalized', representations: [rep] });
  const next = await createVersion({ parents: [first.versionHash], representations: [await createRepresentation({ format: 'text/markdown', content: 'v2' })] });
  await validateVersion(next);
  assert.deepEqual(next.parents, [first.versionHash]);
  assert.notEqual(next.versionHash, first.versionHash);
});

test('the state is part of the versionHash', async () => {
  const representations = [await createRepresentation({ format: 'text/markdown', content: 'x' })];
  const createdAt = '2026-11-03T12:00:00Z';
  const draft = await createVersion({ state: 'draft', createdAt, representations });
  const final = await createVersion({ state: 'finalized', createdAt, representations });
  assert.notEqual(draft.versionHash, final.versionHash);
});

test('invalid versions are rejected', async () => {
  const rep = await createRepresentation({ format: 'text/markdown', content: 'x' });
  const good = await createVersion({ representations: [rep] });
  await assert.rejects(() => validateVersion({ ...good, extra: 1 }), { code: 'unknown-field' });
  await assert.rejects(() => validateVersion({ ...good, state: 'in-review' }), { code: 'invalid-state' });
  await assert.rejects(() => validateVersion({ ...good, parents: [good.versionHash] }), { code: 'cycle' });
  await assert.rejects(() => validateVersion({ ...good, createdAt: 'yesterday' }), { code: 'invalid-timestamp' });
  await assert.rejects(() => validateVersion({ ...good, proof: [] }), { code: 'invalid-proof' });
  const second = await createRepresentation({ format: 'text/plain', content: 'y' });
  const twoPrimary = await createVersion({ representations: [rep, second] });
  await assert.rejects(() => validateVersion(twoPrimary), { code: 'invalid-representations' });
});

test('timestamps use UTC with seconds precision', () => {
  assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(nowIso(new Date('2026-11-03T12:34:56.789Z')), '2026-11-03T12:34:56Z');
  assert.equal(isTimestamp('2026-11-03T12:34:56Z'), true);
  assert.equal(isTimestamp('2026-13-40T00:00:00Z'), false);
});
