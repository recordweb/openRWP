import { CoreError } from './errors.js';
import { canonicalize } from './canonical.js';
import { sha256Hex } from './hash.js';

// Record-level helpers (RWP chapters 3, 6 and 7.2).

const RWP_DID = /^did:rwp:[^\s:]+:[^\s:]+(:[0-9a-f]{64}){0,2}$/;
const METADATA_KEYS = new Set(['core', 'governance', 'extensions']);
const GOVERNANCE_KEYS = new Set(['owner', 'classification', 'retentionPolicy', 'tags']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const invalid = (detail) => new CoreError('invalid-metadata', detail);

export const isRwpDid = (s) => typeof s === 'string' && RWP_DID.test(s);

// RWP 7.2: recordHash = SHA-256(JCS({did, payload, metadata})), bare lowercase hex.
export function computeRecordHash({ did, payload, metadata }) {
  return sha256Hex(canonicalize({ did, payload, metadata }));
}

// RWP says the payload is an "ordered array" without defining the order, but the recordHash depends on it.
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

// Metadata of a new record: record type and, if known, the owner (AgentRecord DID).
export function defaultMetadata({ recordType, owner }) {
  const metadata = { core: { recordType } };
  if (owner) metadata.governance = { owner };
  metadata.extensions = [];
  return metadata;
}

// Validates metadata as sent by a client (RWP chapter 6). `schemaVersion` no longer exists:
// the version is part of the recordType DID.
export function validateMetadata(metadata) {
  if (!isObject(metadata)) throw invalid('metadata must be an object');
  for (const key of Object.keys(metadata)) {
    if (!METADATA_KEYS.has(key)) throw new CoreError('unknown-field', key);
  }

  if (!isObject(metadata.core)) throw invalid('metadata.core is required');
  for (const key of Object.keys(metadata.core)) {
    if (key !== 'recordType') throw new CoreError('unknown-field', `core.${key}`);
  }
  if (!isRwpDid(metadata.core.recordType)) throw invalid('core.recordType must be a did:rwp DID');

  const governance = metadata.governance;
  if (governance !== undefined) {
    if (!isObject(governance)) throw invalid('governance must be an object');
    for (const key of Object.keys(governance)) {
      if (!GOVERNANCE_KEYS.has(key)) throw new CoreError('unknown-field', `governance.${key}`);
    }
    for (const key of ['owner', 'classification']) {
      if (governance[key] !== undefined && (typeof governance[key] !== 'string' || governance[key].trim() === '')) {
        throw invalid(`governance.${key} must be a non-empty string`);
      }
    }
    if (governance.retentionPolicy !== undefined
      && !(typeof governance.retentionPolicy === 'string' && governance.retentionPolicy.startsWith('did:'))) {
      throw invalid('governance.retentionPolicy must be a DID');
    }
    if (governance.tags !== undefined
      && !(Array.isArray(governance.tags) && governance.tags.every((t) => typeof t === 'string'))) {
      throw invalid('governance.tags must be an array of strings');
    }
  }

  if (metadata.extensions !== undefined) {
    if (!Array.isArray(metadata.extensions)) throw invalid('extensions must be an array');
    for (const entry of metadata.extensions) {
      if (!isObject(entry) || typeof entry.type !== 'string' || !entry.type.startsWith('did:')) {
        throw invalid('every extension needs a type that is a DID');
      }
    }
  }
  return metadata;
}