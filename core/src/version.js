import { CoreError } from './errors.js';
import { canonicalize } from './canonical.js';
import { sha256Hex } from './hash.js';
import { isHash } from './ids.js';
import { validateRepresentation } from './representation.js';

const ALLOWED = new Set([
  'versionHash', 'state', 'parents', 'createdAt', 'modifiedAt', 'representations', 'signature',
]);
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// RWP 7.3: versionHash = SHA-256(JCS({state, parents, createdAt, modifiedAt, representations})).
// mode 'full' (default, literal reading of 7.3): complete Representation objects incl. `content`.
// mode 'withoutContent' (planned RWP change): `content` omitted, `contentHash` still included.
export function computeVersionHash(version, { mode = 'full' } = {}) {
  let representations = version.representations;
  if (mode === 'withoutContent') {
    representations = representations.map(({ content, ...rest }) => rest);
  } else if (mode !== 'full') {
    throw new CoreError('invalid-mode', mode);
  }
  return sha256Hex(canonicalize({
    state: version.state,
    parents: version.parents,
    createdAt: version.createdAt,
    modifiedAt: version.modifiedAt,
    representations,
  }));
}

const isTimestamp = (s) => typeof s === 'string' && ISO_8601.test(s) && !Number.isNaN(Date.parse(s));

// Validates a version as sent by a client. Returns the file bytes per representation (same order).
// `allowedStates` lets the caller restrict states (the demo server accepts only 'draft').
export function validateVersion(version, { allowedStates = ['draft', 'finalized'], mode = 'full' } = {}) {
  if (version === null || typeof version !== 'object' || Array.isArray(version)) throw new CoreError('invalid-version');
  for (const key of Object.keys(version)) {
    if (!ALLOWED.has(key)) throw new CoreError('unknown-field', key);
  }
  if (!isHash(version.versionHash)) throw new CoreError('invalid-hash', 'versionHash');
  if (!allowedStates.includes(version.state)) throw new CoreError('invalid-state', String(version.state));
  if (!Array.isArray(version.parents) || !version.parents.every(isHash)) throw new CoreError('invalid-parents');
  if (new Set(version.parents).size !== version.parents.length) throw new CoreError('invalid-parents', 'duplicate');
  if (version.parents.includes(version.versionHash)) throw new CoreError('cycle', 'self-parent');
  if (!isTimestamp(version.createdAt)) throw new CoreError('invalid-timestamp', 'createdAt');
  if (!isTimestamp(version.modifiedAt)) throw new CoreError('invalid-timestamp', 'modifiedAt');
  if (version.signature !== undefined && typeof version.signature !== 'string') throw new CoreError('invalid-signature');
  if (!Array.isArray(version.representations) || version.representations.length === 0) {
    throw new CoreError('invalid-representations', 'at least one required');
  }
  const bytes = version.representations.map(validateRepresentation);
  const primaries = version.representations.filter((r) => r.primary).length;
  if (primaries !== 1) throw new CoreError('invalid-representations', 'exactly one primary required');
  if (computeVersionHash(version, { mode }) !== version.versionHash) throw new CoreError('version-hash-mismatch');
  return bytes;
}