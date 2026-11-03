import { CoreError } from './errors.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const SEGMENT = /^[^\s:]+$/;

export const isUuidV4 = (s) => typeof s === 'string' && UUID_V4.test(s);
// Bare SHA-256 hex as used inside a DID (RWP 4.5). Hash references with prefix: see hash.js.
export const isHash = (s) => typeof s === 'string' && HASH.test(s);
// A namespace that is a canonical UUIDv4 is global and eligible for the GNR (RWP 4.3), anything else is local (RWP 4.4).
export const isGlobalNamespace = isUuidV4;

function checkIdentity(namespace, recordId) {
  if (isGlobalNamespace(namespace)) {
    if (!isUuidV4(recordId)) throw new CoreError('invalid-record-id', 'a global namespace requires a UUIDv4 record id');
    return;
  }
  if (typeof namespace !== 'string' || !SEGMENT.test(namespace)) throw new CoreError('invalid-namespace');
  if (typeof recordId !== 'string' || !SEGMENT.test(recordId)) throw new CoreError('invalid-record-id');
}

// DID format (RWP 4.2): did:rwp:<namespace>:<recordId>[:<versionHash>[:<contentHash>]]
export function makeDid(namespace, recordId, versionHash, contentHash) {
  checkIdentity(namespace, recordId);
  let did = `did:rwp:${namespace}:${recordId}`;
  if (versionHash !== undefined) {
    if (!isHash(versionHash)) throw new CoreError('invalid-hash', 'versionHash');
    did += `:${versionHash}`;
  }
  if (contentHash !== undefined) {
    if (versionHash === undefined) throw new CoreError('invalid-did', 'contentHash needs versionHash');
    if (!isHash(contentHash)) throw new CoreError('invalid-hash', 'contentHash');
    did += `:${contentHash}`;
  }
  return did;
}

// Returns { namespace, recordId, versionHash, contentHash, global, extra }.
// `extra` holds further segments of a local DID (implementation-defined, RWP 4.6); a global DID has none.
export function parseDid(did) {
  if (typeof did !== 'string') throw new CoreError('invalid-did');
  const parts = did.split(':');
  if (parts.length < 4 || parts[0] !== 'did' || parts[1] !== 'rwp') throw new CoreError('invalid-did');
  const [, , namespace, recordId, ...rest] = parts;
  checkIdentity(namespace, recordId);
  const hashes = [];
  while (hashes.length < 2 && hashes.length < rest.length && isHash(rest[hashes.length])) hashes.push(rest[hashes.length]);
  const extra = rest.slice(hashes.length);
  const global = isGlobalNamespace(namespace);
  if (global && extra.length > 0) throw new CoreError('invalid-did', 'a global DID has no further segments');
  if (extra.some((s) => s === '')) throw new CoreError('invalid-did', 'empty segment');
  return { namespace, recordId, versionHash: hashes[0], contentHash: hashes[1], global, extra };
}
