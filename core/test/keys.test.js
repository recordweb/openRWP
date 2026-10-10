import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from 'node:crypto';
import {
  base58Encode, base58Decode, publicKeyToMultibase, multibaseToPublicKey,
  publicKeyObjectFromMultibase, generateEd25519KeyPair,
} from '../index.js';

// Public key of a published did:key example (W3C CCG did:key spec).
const KNOWN = 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

test('base58 round trip, including leading zero bytes', () => {
  for (const hex of ['', '00', '0000ff', 'ff00', '0102030405060708090a']) {
    const bytes = Buffer.from(hex, 'hex');
    assert.deepEqual(base58Decode(base58Encode(bytes)), bytes);
  }
  assert.equal(base58Encode(Buffer.from('hello world')), 'StV1DL6CwTryKyV');
  assert.throws(() => base58Decode('0OIl'), { code: 'invalid-base58' });
});

test('known did:key public key decodes and re-encodes identically', () => {
  const raw = multibaseToPublicKey(KNOWN);
  assert.equal(raw.length, 32);
  assert.equal(publicKeyToMultibase(raw), KNOWN);
});

test('generated key pair: multibase form, sign and verify', () => {
  const { privateKeyPem, publicKeyMultibase } = generateEd25519KeyPair();
  assert.match(publicKeyMultibase, /^z6Mk/);
  const data = Buffer.from('versionHash');
  const signature = sign(null, data, privateKeyPem);
  assert.ok(verify(null, data, publicKeyObjectFromMultibase(publicKeyMultibase), signature));
  assert.ok(!verify(null, Buffer.from('other'), publicKeyObjectFromMultibase(publicKeyMultibase), signature));
});

test('invalid public keys are rejected', () => {
  assert.throws(() => multibaseToPublicKey('abc'), { code: 'invalid-key' });
  assert.throws(() => multibaseToPublicKey('z' + base58Encode(Buffer.alloc(34))), { code: 'invalid-key' });
  assert.throws(() => publicKeyToMultibase(Buffer.alloc(31)), { code: 'invalid-key' });
});