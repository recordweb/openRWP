import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeContentHash, validateRepresentation, computeVersionHash, validateVersion,
  isUuidV4, isHash, makeDid, parseDid,
} from '../index.js';

// Vectors below were computed with an independent implementation (Python, RFC 8785 for this input).
const CONTENT = 'c2FtcGxlIHRleHQ='; // Base64 of "sample text"
const CONTENT_HASH = 'f222dc6bc4ee1924aef96421bde393ae1c83598c5118db9c9c68f59489154bca';
const VERSION_HASH_FULL = 'faf54a141b4e54ff72cbbf0baecfa58b72ddaf76b677bb83e2bfd18f2ee7cbe5';
const VERSION_HASH_WITHOUT_CONTENT = '40aeba4804997463d8d5321a2abe7224360153331db7ab39c4367770cf40242c';

const rep = () => ({ format: 'text/markdown', content: CONTENT, contentHash: CONTENT_HASH, primary: true, role: 'source' });
const ver = () => ({
  versionHash: VERSION_HASH_FULL,
  state: 'draft',
  parents: [],
  createdAt: '2026-10-10T13:00:00Z',
  modifiedAt: '2026-10-10T13:00:00Z',
  representations: [rep()],
});

test('contentHash vector', () => {
  assert.equal(computeContentHash(rep()), CONTENT_HASH);
});

test('validateRepresentation returns the file bytes', () => {
  assert.equal(validateRepresentation(rep()).toString(), 'sample text');
});

test('validateRepresentation rejects tampering, ref and unknown fields', () => {
  assert.throws(() => validateRepresentation({ ...rep(), primary: false }), { code: 'content-hash-mismatch' });
  assert.throws(() => validateRepresentation({ ...rep(), content: 'c2FtcGxlIHRleHQh' }), { code: 'content-hash-mismatch' });
  assert.throws(() => validateRepresentation({ format: 'x/y', ref: 'urn:x', primary: true }), { code: 'ref-not-supported' });
  assert.throws(() => validateRepresentation({ ...rep(), extra: 1 }), { code: 'unknown-field' });
});

test('role is optional and omitted from the hash input when absent', () => {
  const { role, ...noRole } = rep();
  assert.notEqual(computeContentHash(noRole), CONTENT_HASH);
});

test('versionHash vectors for both modes', () => {
  assert.equal(computeVersionHash(ver()), VERSION_HASH_FULL);
  assert.equal(computeVersionHash(ver(), { mode: 'withoutContent' }), VERSION_HASH_WITHOUT_CONTENT);
});

test('validateVersion accepts a correct version and returns bytes', () => {
  const bytes = validateVersion(ver());
  assert.equal(bytes.length, 1);
  assert.equal(bytes[0].toString(), 'sample text');
});

test('validateVersion rejects broken versions', () => {
  assert.throws(() => validateVersion({ ...ver(), state: 'finalized' }, { allowedStates: ['draft'] }), { code: 'invalid-state' });
  assert.throws(() => validateVersion({ ...ver(), modifiedAt: '2026-10-10T14:00:00Z' }), { code: 'version-hash-mismatch' });
  assert.throws(() => validateVersion({ ...ver(), createdAt: 'yesterday' }), { code: 'invalid-timestamp' });
  assert.throws(() => validateVersion({ ...ver(), representations: [] }), { code: 'invalid-representations' });
  assert.throws(() => validateVersion({ ...ver(), versionHash: 'sha256:' + VERSION_HASH_FULL }), { code: 'invalid-hash' });
  assert.throws(() => validateVersion({ ...ver(), parents: [VERSION_HASH_FULL] }), { code: 'cycle' });
});

test('exactly one primary representation is required', () => {
  const second = { ...rep(), primary: true };
  second.contentHash = computeContentHash(second);
  const v = { ...ver(), representations: [rep(), second] };
  v.versionHash = computeVersionHash(v);
  assert.throws(() => validateVersion(v), { code: 'invalid-representations' });
});

test('uuid and hash checks', () => {
  assert.ok(isUuidV4('f47ac10b-58cc-4372-a567-0e02b2c3d479'));
  assert.ok(!isUuidV4('F47AC10B-58CC-4372-A567-0E02B2C3D479'));
  assert.ok(!isUuidV4('f47ac10b-58cc-1372-a567-0e02b2c3d479'));
  assert.ok(isHash(CONTENT_HASH));
  assert.ok(!isHash('sha256:' + CONTENT_HASH));
});

test('DID round trip', () => {
  const ns = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const id = '5264d2c3-d3b1-411c-829f-90e61165251a';
  assert.equal(makeDid(ns, id), `did:rwp:${ns}:${id}`);
  const did = makeDid(ns, id, VERSION_HASH_FULL, CONTENT_HASH);
  assert.deepEqual(parseDid(did), { namespace: ns, recordId: id, versionHash: VERSION_HASH_FULL, contentHash: CONTENT_HASH });
  assert.throws(() => makeDid(ns, id, undefined, CONTENT_HASH), { code: 'invalid-did' });
  assert.throws(() => parseDid('did:rwp:bern.ch:abc'), { code: 'invalid-namespace' });
});