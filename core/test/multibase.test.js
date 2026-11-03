import test from 'node:test';
import assert from 'node:assert/strict';
import { base58Encode, base58Decode, multibaseEncode, multibaseDecode, publicKeyToMultibase, multibaseToPublicKey, utf8 } from '../index.js';

// Public key of the signer of the RecordWeb root records (DID document efd09e7b in recordweb-org)
const ROOT_SIGNER_KEY = 'z6MkpgYzzH9AJJTnsYYMEaaVPZN2t2iCsz76ShftvkBt5jpP';

test('base58 encodes the well-known vector', () => {
  assert.equal(base58Encode(utf8('Hello World!')), '2NEpo7TZRRrLZSi2U');
  assert.deepEqual(base58Decode('2NEpo7TZRRrLZSi2U'), utf8('Hello World!'));
});

test('base58 keeps leading zero bytes', () => {
  assert.equal(base58Encode(Uint8Array.of(0, 0, 1)), '112');
  assert.deepEqual(base58Decode('112'), Uint8Array.of(0, 0, 1));
});

test('base58 rejects characters outside the alphabet', () => {
  assert.throws(() => base58Decode('0OIl'), { code: 'invalid-base58' });
});

test('multibase needs the prefix z', () => {
  assert.equal(multibaseEncode(utf8('Hello World!')), 'z2NEpo7TZRRrLZSi2U');
  assert.deepEqual(multibaseDecode('z2NEpo7TZRRrLZSi2U'), utf8('Hello World!'));
  assert.throws(() => multibaseDecode('2NEpo7TZRRrLZSi2U'), { code: 'invalid-multibase' });
});

test('Ed25519 public key round trip with the root signer key', () => {
  const raw = multibaseToPublicKey(ROOT_SIGNER_KEY);
  assert.equal(raw.length, 32);
  assert.equal(publicKeyToMultibase(raw), ROOT_SIGNER_KEY);
});

test('keys of the wrong type or length are rejected', () => {
  assert.throws(() => publicKeyToMultibase(new Uint8Array(31)), { code: 'invalid-key' });
  assert.throws(() => multibaseToPublicKey(multibaseEncode(new Uint8Array(34))), { code: 'invalid-key' });
});
