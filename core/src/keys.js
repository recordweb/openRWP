import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { CoreError } from './errors.js';

// Ed25519 keys as used for Author keys (RWP 19.4) and Device keys (Binding 5).
// Public keys are published as multibase: 'z' + base58btc( 0xed 0x01 + 32 raw bytes ),
// the encoding used by Ed25519VerificationKey2020 (publicKeyMultibase).

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_PREFIX = Buffer.from([0xed, 0x01]);

export function base58Encode(bytes) {
  const buf = Buffer.from(bytes);
  let zeros = 0;
  while (zeros < buf.length && buf[zeros] === 0) zeros++;
  const hex = buf.toString('hex');
  let n = hex === '' ? 0n : BigInt(`0x${hex}`);
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
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, 'hex')]);
}

export function publicKeyToMultibase(rawPublicKey) {
  const raw = Buffer.from(rawPublicKey);
  if (raw.length !== 32) throw new CoreError('invalid-key', 'Ed25519 public key must be 32 bytes');
  return `z${base58Encode(Buffer.concat([ED25519_PREFIX, raw]))}`;
}

// Returns the 32 raw bytes of an Ed25519 public key given as multibase.
export function multibaseToPublicKey(text) {
  if (typeof text !== 'string' || !text.startsWith('z')) throw new CoreError('invalid-key', 'expected multibase base58btc (prefix z)');
  const bytes = base58Decode(text.slice(1));
  if (bytes.length !== 34 || bytes[0] !== ED25519_PREFIX[0] || bytes[1] !== ED25519_PREFIX[1]) {
    throw new CoreError('invalid-key', 'not an Ed25519 public key');
  }
  return bytes.subarray(2);
}

// Node KeyObject for signature verification (used from the signature step on).
export function publicKeyObjectFromMultibase(text) {
  const raw = multibaseToPublicKey(text);
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
}

// Returns { privateKeyPem (PKCS#8), publicKeyMultibase }.
export function generateEd25519KeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x;
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicKeyMultibase: publicKeyToMultibase(Buffer.from(x, 'base64url')),
  };
}