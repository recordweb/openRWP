import { CoreError } from './errors.js';
import { canonicalize } from './canonical.js';
import { sha256Hex } from './hash.js';
import { decodeBase64Strict } from './encoding.js';
import { isHash } from './ids.js';

const ALLOWED = new Set(['format', 'content', 'contentHash', 'primary', 'role']);

// RWP 7.4: contentHash = SHA-256(JCS({format, content, primary, role})); role is omitted if absent.
export function computeContentHash(rep) {
  const input = { format: rep.format, content: rep.content, primary: rep.primary };
  if (rep.role !== undefined) input.role = rep.role;
  return sha256Hex(canonicalize(input));
}

// Validates one Representation (content only; `ref` is out of scope in this demo).
// Returns the decoded file bytes.
export function validateRepresentation(rep) {
  if (rep === null || typeof rep !== 'object' || Array.isArray(rep)) throw new CoreError('invalid-representation');
  if ('ref' in rep) throw new CoreError('ref-not-supported');
  for (const key of Object.keys(rep)) {
    if (!ALLOWED.has(key)) throw new CoreError('unknown-field', key);
  }
  if (typeof rep.format !== 'string' || rep.format === '') throw new CoreError('invalid-representation', 'format');
  if (typeof rep.primary !== 'boolean') throw new CoreError('invalid-representation', 'primary');
  if (rep.role !== undefined && typeof rep.role !== 'string') throw new CoreError('invalid-representation', 'role');
  if (!isHash(rep.contentHash)) throw new CoreError('invalid-hash', 'contentHash');
  const bytes = decodeBase64Strict(rep.content);
  if (computeContentHash(rep) !== rep.contentHash) throw new CoreError('content-hash-mismatch');
  return bytes;
}