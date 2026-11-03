import { CoreError } from './errors.js';
import { canonicalize } from './canonical.js';
import { sha256Ref, isHashRef } from './hash.js';
import { isTimestamp, validateVersion } from './version.js';

// Record-level helpers (RWP chapters 2, 5, 6 and 7.2).

const RWP_DID = /^did:rwp:[^\s:]+:[^\s:]+(:[0-9a-f]{64}){0,2}$/;
const TRANSIT = new Set(['incoming', 'internal', 'outgoing']);
const METADATA_KEYS = new Set(['core', 'governance', 'extensions']);
const CORE_KEYS = new Set(['recordType', 'schemaVersion', 'transit', 'provenanceRef']);
const GOVERNANCE_KEYS = new Set(['owner', 'classification', 'retentionPolicy', 'tags']);
const PROVENANCE_REQUIRED = ['sourceDescription', 'capturedAt', 'capturedBy'];
const PROVENANCE_OPTIONAL = ['sourceSystem', 'sourceId', 'sourceObjectType', 'sourceIntegrity'];
const SOURCE_INTEGRITY = new Set(['none', 'platform-versioned', 'source-signed', 'externally-hashed']);
const RECORD_KEYS = new Set(['did', 'metadata', 'payload', 'recordHash']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const invalid = (detail) => new CoreError('invalid-metadata', detail);

export const isRwpDid = (s) => typeof s === 'string' && RWP_DID.test(s);

// RWP 7.2: recordHash = SHA-256(JCS({did, metadata, payload})). A Record without payload omits the field.
export async function computeRecordHash({ did, metadata, payload }) {
  return sha256Ref(canonicalize({ did, metadata, payload }));
}

// RWP says the payload is an "ordered array" without defining the order, but the recordHash depends on it (finding F-16).
// ASSUMPTION: parents before children; among versions that are ready, older createdAt first, then versionHash.
export function orderVersions(versions) {
  const known = new Set(versions.map((v) => v.versionHash));
  const emitted = new Set();
  const ordered = [];
  while (ordered.length < versions.length) {
    const ready = versions.filter(
      (v) => !emitted.has(v.versionHash) && v.parents.every((p) => !known.has(p) || emitted.has(p)),
    );
    if (ready.length === 0) throw new CoreError('cycle', 'graph contains a cycle');
    ready.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.versionHash < b.versionHash ? -1 : 1));
    ordered.push(ready[0]);
    emitted.add(ready[0].versionHash);
  }
  return ordered;
}

// Metadata of a new record (RWP 5.1, 5.2). `schemaVersion` is the versionHash of the schema version used.
export function defaultMetadata({ recordType, schemaVersion, transit = 'internal', owner, classification }) {
  const metadata = { core: { recordType, schemaVersion, transit } };
  if (owner !== undefined || classification !== undefined) {
    metadata.governance = {};
    if (owner !== undefined) metadata.governance.owner = owner;
    if (classification !== undefined) metadata.governance.classification = classification;
  }
  metadata.extensions = [];
  return metadata;
}

function validateProvenanceRef(ref) {
  if (!isObject(ref)) throw invalid('provenanceRef must be an object');
  for (const key of Object.keys(ref)) {
    if (!PROVENANCE_REQUIRED.includes(key) && !PROVENANCE_OPTIONAL.includes(key)) throw new CoreError('unknown-field', `provenanceRef.${key}`);
  }
  for (const key of PROVENANCE_REQUIRED) {
    if (typeof ref[key] !== 'string' || ref[key] === '') throw invalid(`provenanceRef.${key} is required`);
  }
  if (!isTimestamp(ref.capturedAt)) throw invalid('provenanceRef.capturedAt must be a timestamp');
  for (const key of PROVENANCE_OPTIONAL) {
    if (ref[key] !== undefined && typeof ref[key] !== 'string') throw invalid(`provenanceRef.${key} must be a string`);
  }
  if (ref.sourceIntegrity !== undefined && !SOURCE_INTEGRITY.has(ref.sourceIntegrity)) throw invalid('provenanceRef.sourceIntegrity');
}

// Validates metadata as sent by a client (RWP chapter 5).
export function validateMetadata(metadata) {
  if (!isObject(metadata)) throw invalid('metadata must be an object');
  for (const key of Object.keys(metadata)) {
    if (!METADATA_KEYS.has(key)) throw new CoreError('unknown-field', key);
  }

  const core = metadata.core;
  if (!isObject(core)) throw invalid('metadata.core is required');
  for (const key of Object.keys(core)) {
    if (!CORE_KEYS.has(key)) throw new CoreError('unknown-field', `core.${key}`);
  }
  if (!isRwpDid(core.recordType)) throw invalid('core.recordType must be a did:rwp DID');
  if (!isHashRef(core.schemaVersion)) throw invalid('core.schemaVersion must be a sha256 hash reference');
  if (!TRANSIT.has(core.transit)) throw invalid('core.transit must be incoming, internal or outgoing');
  if (core.transit === 'incoming') {
    if (core.provenanceRef === undefined) throw invalid('core.provenanceRef is required for transit incoming');
    validateProvenanceRef(core.provenanceRef);
  } else if (core.provenanceRef !== undefined) {
    throw invalid('core.provenanceRef is only allowed for transit incoming');
  }

  const governance = metadata.governance;
  if (governance !== undefined) {
    if (!isObject(governance)) throw invalid('governance must be an object');
    for (const key of Object.keys(governance)) {
      if (!GOVERNANCE_KEYS.has(key)) throw new CoreError('unknown-field', `governance.${key}`);
    }
    if (governance.owner !== undefined && !isRwpDid(governance.owner)) throw invalid('governance.owner must be a did:rwp DID');
    if (governance.classification !== undefined
      && (typeof governance.classification !== 'string' || governance.classification.trim() === '')) {
      throw invalid('governance.classification must be a non-empty string');
    }
    if (governance.retentionPolicy !== undefined && !isRwpDid(governance.retentionPolicy)) {
      throw invalid('governance.retentionPolicy must be a did:rwp DID');
    }
    if (governance.tags !== undefined
      && !(Array.isArray(governance.tags) && governance.tags.every((t) => typeof t === 'string'))) {
      throw invalid('governance.tags must be an array of strings');
    }
  }

  if (metadata.extensions !== undefined) {
    if (!Array.isArray(metadata.extensions)) throw invalid('extensions must be an array');
    for (const entry of metadata.extensions) {
      if (!isObject(entry) || !isRwpDid(entry.type)) throw invalid('every extension needs a type that is a did:rwp DID');
    }
  }
  return metadata;
}

// Assembles a Record in the order did, metadata, payload, recordHash (finding F-1).
export async function buildRecord({ did, metadata, payload }) {
  validateMetadata(metadata);
  const record = { did, metadata };
  if (payload !== undefined) record.payload = orderVersions(payload);
  record.recordHash = await computeRecordHash(record);
  return record;
}

// Validates a complete Record: structure, metadata, every version, parent references and the recordHash.
export async function validateRecord(record, { allowedStates } = {}) {
  if (!isObject(record)) throw new CoreError('invalid-record');
  for (const key of Object.keys(record)) {
    if (!RECORD_KEYS.has(key)) throw new CoreError('unknown-field', key);
  }
  if (!isRwpDid(record.did)) throw new CoreError('invalid-did', String(record.did));
  validateMetadata(record.metadata);
  if (record.payload !== undefined) {
    if (!Array.isArray(record.payload) || record.payload.length === 0) throw new CoreError('invalid-payload', 'at least one version required');
    const hashes = new Set();
    for (const version of record.payload) {
      await validateVersion(version, allowedStates ? { allowedStates } : undefined);
      if (hashes.has(version.versionHash)) throw new CoreError('invalid-payload', 'duplicate versionHash');
      hashes.add(version.versionHash);
    }
    for (const version of record.payload) {
      for (const parent of version.parents) {
        if (!hashes.has(parent)) throw new CoreError('unknown-parent', parent);
      }
    }
    orderVersions(record.payload);
  }
  if (!isHashRef(record.recordHash)) throw new CoreError('invalid-hash', 'recordHash');
  if ((await computeRecordHash(record)) !== record.recordHash) throw new CoreError('record-hash-mismatch');
  return record;
}
