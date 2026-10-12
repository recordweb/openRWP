import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRecordHash, orderVersions, defaultMetadata, validateMetadata, isRwpDid,
} from '../index.js';

const TYPE = 'did:rwp:4d3c45e8-1785-4f52-90f7-b9f5811935ad:7f3a9c52-6b1e-4d08-9a47-2c5e8b1d0f36';
const OWNER = 'did:rwp:4d3c45e8-1785-4f52-90f7-b9f5811935ad:9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

// Vector computed with an independent implementation (Python, RFC 8785 for this input).
const VECTOR = {
  did: 'did:rwp:4d3c45e8-1785-4f52-90f7-b9f5811935ad:5264d2c3-d3b1-411c-829f-90e61165251a',
  payload: [{
    state: 'draft',
    parents: [],
    createdAt: '2026-10-10T13:00:00Z',
    modifiedAt: '2026-10-10T13:00:00Z',
    representations: [{
      format: 'text/markdown',
      content: 'c2FtcGxlIHRleHQ=',
      primary: true,
      role: 'source',
      contentHash: 'f222dc6bc4ee1924aef96421bde393ae1c83598c5118db9c9c68f59489154bca',
    }],
    versionHash: 'faf54a141b4e54ff72cbbf0baecfa58b72ddaf76b677bb83e2bfd18f2ee7cbe5',
  }],
  metadata: { core: { recordType: TYPE }, governance: { owner: OWNER }, extensions: [] },
};
const RECORD_HASH = '904e9c9ab6c414ee7d0d75cecfd6d215bf5978bd9cd4b61b35d72ff00e960a1e';

test('recordHash vector', () => {
  assert.equal(computeRecordHash(VECTOR), RECORD_HASH);
  const changed = structuredClone(VECTOR);
  changed.metadata.governance.owner = 'someone-else';
  assert.notEqual(computeRecordHash(changed), RECORD_HASH);
});

test('DID syntax check for recordType and friends', () => {
  assert.ok(isRwpDid(TYPE));
  assert.ok(isRwpDid(`${TYPE}:${'a'.repeat(64)}`));
  assert.ok(isRwpDid('did:rwp:example.com:f47ac10b'));
  assert.ok(!isRwpDid('did:web:example.com'));
  assert.ok(!isRwpDid('did:rwp:onlyonesegment'));
  assert.ok(!isRwpDid(`${TYPE} x`));
  assert.ok(!isRwpDid(undefined));
});

test('orderVersions: parents first, then createdAt, then versionHash', () => {
  const v = (versionHash, createdAt, ...parents) => ({ versionHash, createdAt, parents });
  const root = v('a', '2026-10-10T13:00:00Z');
  const child = v('c', '2026-10-10T12:00:00Z', 'a'); // older clock than its parent
  const other = v('b', '2026-10-10T14:00:00Z', 'a');
  const sameTime = v('d', '2026-10-10T14:00:00Z', 'a');
  const ordered = orderVersions([sameTime, other, child, root]).map((x) => x.versionHash);
  assert.deepEqual(ordered, ['a', 'c', 'b', 'd']);
  assert.deepEqual(orderVersions([root]).map((x) => x.versionHash), ['a']);
  assert.throws(() => orderVersions([v('x', '2026-10-10T13:00:00Z', 'y'), v('y', '2026-10-10T13:00:00Z', 'x')]), { code: 'cycle' });
});

test('defaultMetadata shape', () => {
  assert.deepEqual(defaultMetadata({ recordType: TYPE }), { core: { recordType: TYPE }, extensions: [] });
  assert.deepEqual(defaultMetadata({ recordType: TYPE, owner: OWNER }), {
    core: { recordType: TYPE }, governance: { owner: OWNER }, extensions: [],
  });
});

test('validateMetadata accepts valid metadata', () => {
  const full = {
    core: { recordType: TYPE },
    governance: { owner: 'mailto:sam.doe@example.com', classification: 'internal', retentionPolicy: 'did:rwp:bern.ch:retention', tags: ['a', 'b'] },
    extensions: [{ type: 'did:rwp:bern.ch:ext', anything: 1 }],
  };
  assert.equal(validateMetadata(full), full);
  assert.ok(validateMetadata({ core: { recordType: TYPE } }));
});

test('validateMetadata rejects invalid metadata', () => {
  const bad = (m, code) => assert.throws(() => validateMetadata(m), { code });
  bad(null, 'invalid-metadata');
  bad([], 'invalid-metadata');
  bad({}, 'invalid-metadata');
  bad({ core: {} }, 'invalid-metadata');
  bad({ core: { recordType: 'not a did' } }, 'invalid-metadata');
  bad({ core: { recordType: TYPE, schemaVersion: 'a'.repeat(64) } }, 'unknown-field');
  bad({ core: { recordType: TYPE }, other: 1 }, 'unknown-field');
  bad({ core: { recordType: TYPE }, governance: { owner: '' } }, 'invalid-metadata');
  bad({ core: { recordType: TYPE }, governance: { tags: 'x' } }, 'invalid-metadata');
  bad({ core: { recordType: TYPE }, governance: { tags: [1] } }, 'invalid-metadata');
  bad({ core: { recordType: TYPE }, governance: { retentionPolicy: 'x' } }, 'invalid-metadata');
  bad({ core: { recordType: TYPE }, governance: { unknown: 1 } }, 'unknown-field');
  bad({ core: { recordType: TYPE }, extensions: {} }, 'invalid-metadata');
  bad({ core: { recordType: TYPE }, extensions: [{}] }, 'invalid-metadata');
  bad({ core: { recordType: TYPE }, extensions: [{ type: 'x' }] }, 'invalid-metadata');
});