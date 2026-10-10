import { CoreError } from './errors.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

export const isUuidV4 = (s) => typeof s === 'string' && UUID_V4.test(s);
export const isHash = (s) => typeof s === 'string' && HASH.test(s);

// DID format: did:rwp:<namespace>:<record-id>[:<versionHash>][:<contentHash>]
// ASSUMPTION (RWP gap): one trailing hash segment is read as versionHash;
// a contentHash requires a versionHash before it.
export function makeDid(namespace, recordId, versionHash, contentHash) {
  if (!isUuidV4(namespace)) throw new CoreError('invalid-namespace');
  if (!isUuidV4(recordId)) throw new CoreError('invalid-record-id');
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

export function parseDid(did) {
  if (typeof did !== 'string') throw new CoreError('invalid-did');
  const parts = did.split(':');
  if (parts.length < 4 || parts.length > 6 || parts[0] !== 'did' || parts[1] !== 'rwp') {
    throw new CoreError('invalid-did');
  }
  const [, , namespace, recordId, versionHash, contentHash] = parts;
  if (!isUuidV4(namespace)) throw new CoreError('invalid-namespace');
  if (!isUuidV4(recordId)) throw new CoreError('invalid-record-id');
  if (versionHash !== undefined && !isHash(versionHash)) throw new CoreError('invalid-hash', 'versionHash');
  if (contentHash !== undefined && !isHash(contentHash)) throw new CoreError('invalid-hash', 'contentHash');
  return { namespace, recordId, versionHash, contentHash };
}