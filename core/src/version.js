import { CoreError } from './errors.js';
import { canonicalize } from './canonical.js';
import { sha256Ref, isHashRef } from './hash.js';
import { validateRepresentation } from './representation.js';
import { addProof } from './proof.js';

const ALLOWED = new Set(['versionHash', 'state', 'parents', 'createdAt', 'modifiedAt', 'representations', 'proof']);
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const isTimestamp = (s) => typeof s === 'string' && ISO_8601.test(s) && !Number.isNaN(Date.parse(s));

// Timestamp as used in the RecordWeb root records: UTC, seconds precision.
export const nowIso = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

// RWP 7.3: versionHash = SHA-256(JCS({state, parents, createdAt, modifiedAt, representations})).
// The representations are complete objects including `content` (finding F-14).
export async function computeVersionHash(version) {
  return sha256Ref(canonicalize({
    state: version.state,
    parents: version.parents,
    createdAt: version.createdAt,
    modifiedAt: version.modifiedAt,
    representations: version.representations,
  }));
}

export async function createVersion({ state = 'draft', parents = [], createdAt = nowIso(), modifiedAt = createdAt, representations }) {
  const version = { state, parents, createdAt, modifiedAt, representations };
  return { versionHash: await computeVersionHash(version), ...version };
}

// RWP 7.7: the proof covers the version including its versionHash and is created at modifiedAt.
export async function signVersion(version, { privateKey, verificationMethod }) {
  return addProof(version, { privateKey, verificationMethod, created: version.modifiedAt });
}

// Structural and hash validation of a version as received from a client. Signatures are verified in proof.js.
export async function validateVersion(version, { allowedStates = ['draft', 'finalized'] } = {}) {
  if (version === null || typeof version !== 'object' || Array.isArray(version)) throw new CoreError('invalid-version');
  for (const key of Object.keys(version)) {
    if (!ALLOWED.has(key)) throw new CoreError('unknown-field', key);
  }
  if (!isHashRef(version.versionHash)) throw new CoreError('invalid-hash', 'versionHash');
  if (!allowedStates.includes(version.state)) throw new CoreError('invalid-state', String(version.state));
  if (!Array.isArray(version.parents) || !version.parents.every(isHashRef)) throw new CoreError('invalid-parents');
  if (new Set(version.parents).size !== version.parents.length) throw new CoreError('invalid-parents', 'duplicate');
  if (version.parents.includes(version.versionHash)) throw new CoreError('cycle', 'self-parent');
  if (!isTimestamp(version.createdAt)) throw new CoreError('invalid-timestamp', 'createdAt');
  if (!isTimestamp(version.modifiedAt)) throw new CoreError('invalid-timestamp', 'modifiedAt');
  if (version.proof !== undefined
    && !(Array.isArray(version.proof) && version.proof.length > 0 && version.proof.every((p) => p !== null && typeof p === 'object'))) {
    throw new CoreError('invalid-proof', 'proof must be a non-empty array');
  }
  if (!Array.isArray(version.representations) || version.representations.length === 0) {
    throw new CoreError('invalid-representations', 'at least one required');
  }
  for (const rep of version.representations) await validateRepresentation(rep);
  if (version.representations.filter((r) => r.primary).length !== 1) {
    throw new CoreError('invalid-representations', 'exactly one primary required');
  }
  if ((await computeVersionHash(version)) !== version.versionHash) throw new CoreError('version-hash-mismatch');
  return version;
}
