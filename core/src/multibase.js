import { CoreError } from './errors.js';
import { concatBytes, fromHex } from './bytes.js';

// base58btc and multibase ('z' prefix). Public keys are published as
// 'z' + base58btc(0xed 0x01 + 32 raw bytes), the encoding of Ed25519VerificationKey2020.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_PREFIX = Uint8Array.of(0xed, 0x01);

export function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return '1'.repeat(zeros) + out;
}

export function base58Decode(text) {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros++;
  let n = 0n;
  for (const ch of text) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) throw new CoreError('invalid-base58', ch);
    n = n * 58n + BigInt(digit);
  }
  let hex = n === 0n ? '' : n.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  return concatBytes(new Uint8Array(zeros), fromHex(hex));
}

export const multibaseEncode = (bytes) => `z${base58Encode(bytes)}`;

export function multibaseDecode(text) {
  if (typeof text !== 'string' || !text.startsWith('z')) {
    throw new CoreError('invalid-multibase', 'expected base58btc (prefix z)');
  }
  return base58Decode(text.slice(1));
}

export function publicKeyToMultibase(raw) {
  if (raw.length !== 32) throw new CoreError('invalid-key', 'Ed25519 public key must be 32 bytes');
  return multibaseEncode(concatBytes(ED25519_PREFIX, raw));
}

// Returns the 32 raw bytes of an Ed25519 public key given as multibase.
export function multibaseToPublicKey(text) {
  const bytes = multibaseDecode(text);
  if (bytes.length !== 34 || bytes[0] !== ED25519_PREFIX[0] || bytes[1] !== ED25519_PREFIX[1]) {
    throw new CoreError('invalid-key', 'not an Ed25519 public key');
  }
  return bytes.subarray(2);
}
