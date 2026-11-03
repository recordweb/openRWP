import { CoreError } from './errors.js';
import { toHex, utf8 } from './bytes.js';

// RWP 7.6: SHA-256 only. Uses Web Crypto, so the same code runs in browsers and in Node.js (>= 20).
// Inside a hash reference (versionHash, contentHash, recordHash, parents) the digest carries the
// prefix `sha256:`. Inside a DID the digest is bare hex (RWP 4.5, see ids.js).

export const HASH_PREFIX = 'sha256:';
const HEX64 = /^[0-9a-f]{64}$/;
const HASH_REF = /^sha256:[0-9a-f]{64}$/;

export const isHashRef = (s) => typeof s === 'string' && HASH_REF.test(s);

export async function sha256Bytes(data) {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

export async function sha256Hex(data) {
  return toHex(await sha256Bytes(data));
}

export function hashRef(hex) {
  if (typeof hex !== 'string' || !HEX64.test(hex)) throw new CoreError('invalid-hash', 'expected 64 lowercase hex characters');
  return `${HASH_PREFIX}${hex}`;
}

export function stripHashRef(ref) {
  if (!isHashRef(ref)) throw new CoreError('invalid-hash', String(ref));
  return ref.slice(HASH_PREFIX.length);
}

export async function sha256Ref(data) {
  return hashRef(await sha256Hex(data));
}
