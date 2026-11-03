import { CoreError } from './errors.js';
import { canonicalize } from './canonical.js';
import { sha256Ref, isHashRef } from './hash.js';

const ALLOWED = new Set(['format', 'content', 'contentHash', 'primary', 'role']);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// RWP 7.4: contentHash = SHA-256(JCS({format, content, primary, role})); role is omitted if absent.
export async function computeContentHash(rep) {
  const input = { format: rep.format, content: rep.content, primary: rep.primary };
  if (rep.role !== undefined) input.role = rep.role;
  return sha256Ref(canonicalize(input));
}

// The encoding of inline content is only defined for JSON and text formats (finding F-17).
const isSupportedFormat = (format) => format === 'application/json' || format.startsWith('text/');

export async function createRepresentation({ format, content, primary = true, role }) {
  const rep = { format, content, primary };
  if (role !== undefined) rep.role = role;
  rep.contentHash = await computeContentHash(rep);
  return rep;
}

// Validates one Representation (inline content only, `ref` is out of scope in this demo).
export async function validateRepresentation(rep) {
  if (!isObject(rep)) throw new CoreError('invalid-representation');
  if ('ref' in rep) throw new CoreError('ref-not-supported');
  for (const key of Object.keys(rep)) {
    if (!ALLOWED.has(key)) throw new CoreError('unknown-field', key);
  }
  if (typeof rep.format !== 'string' || rep.format === '') throw new CoreError('invalid-representation', 'format');
  if (!isSupportedFormat(rep.format)) throw new CoreError('unsupported-format', rep.format);
  if (rep.content === undefined) throw new CoreError('invalid-representation', 'content');
  if (rep.format.startsWith('text/') && typeof rep.content !== 'string') {
    throw new CoreError('invalid-representation', 'content of a text format must be a string');
  }
  if (typeof rep.primary !== 'boolean') throw new CoreError('invalid-representation', 'primary');
  if (rep.role !== undefined && typeof rep.role !== 'string') throw new CoreError('invalid-representation', 'role');
  if (!isHashRef(rep.contentHash)) throw new CoreError('invalid-hash', 'contentHash');
  if ((await computeContentHash(rep)) !== rep.contentHash) throw new CoreError('content-hash-mismatch');
  return rep;
}
