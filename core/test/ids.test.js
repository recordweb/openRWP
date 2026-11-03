import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDid, parseDid, isUuidV4, isHash, isGlobalNamespace } from '../index.js';

const NS = 'd2d14675-50c9-463d-b564-1ea50644c836';
const REC = '1710c421-bb2b-462e-ad6b-fc47c934c276';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

test('global DID round trip', () => {
  const did = makeDid(NS, REC);
  assert.equal(did, `did:rwp:${NS}:${REC}`);
  assert.deepEqual(parseDid(did), { namespace: NS, recordId: REC, versionHash: undefined, contentHash: undefined, global: true, extra: [] });
});

test('versionHash and contentHash are bare hex segments', () => {
  const did = makeDid(NS, REC, H1, H2);
  assert.equal(did, `did:rwp:${NS}:${REC}:${H1}:${H2}`);
  const parsed = parseDid(did);
  assert.equal(parsed.versionHash, H1);
  assert.equal(parsed.contentHash, H2);
});

test('a contentHash needs a versionHash', () => {
  assert.throws(() => makeDid(NS, REC, undefined, H2), { code: 'invalid-did' });
});

test('a prefixed hash is not allowed inside a DID', () => {
  assert.throws(() => makeDid(NS, REC, `sha256:${H1}`), { code: 'invalid-hash' });
});

test('local namespaces are supported and are not global', () => {
  const did = makeDid('example.com', 'note-1');
  const parsed = parseDid(did);
  assert.equal(parsed.global, false);
  assert.equal(isGlobalNamespace('example.com'), false);
  assert.equal(parsed.namespace, 'example.com');
  assert.equal(parsed.recordId, 'note-1');
});

test('local DIDs may carry further segments, global DIDs may not', () => {
  assert.deepEqual(parseDid('did:rwp:example.com:note-1:x:y').extra, ['x', 'y']);
  assert.throws(() => parseDid(`did:rwp:${NS}:${REC}:x`), { code: 'invalid-did' });
});

test('a global namespace requires a UUIDv4 record id', () => {
  assert.throws(() => makeDid(NS, 'note-1'), { code: 'invalid-record-id' });
});

test('malformed DIDs are rejected', () => {
  assert.throws(() => parseDid('did:web:example.com'), { code: 'invalid-did' });
  assert.throws(() => parseDid('did:rwp:onlynamespace'), { code: 'invalid-did' });
  assert.throws(() => parseDid(42), { code: 'invalid-did' });
});

test('helpers', () => {
  assert.equal(isUuidV4(NS), true);
  assert.equal(isUuidV4(NS.toUpperCase()), false);
  assert.equal(isHash(H1), true);
  assert.equal(isHash(`sha256:${H1}`), false);
});
