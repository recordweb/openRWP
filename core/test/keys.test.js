import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair, exportPublicKeyMultibase, importPublicKey, exportPrivateKeyJwk, importKeyPairFromJwk,
  sign, verify, utf8,
} from '../index.js';

const ROOT_SIGNER_KEY = 'z6MkpgYzzH9AJJTnsYYMEaaVPZN2t2iCsz76ShftvkBt5jpP';

test('sign and verify with a generated key pair', async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const message = utf8('hello');
  const signature = await sign(privateKey, message);
  assert.equal(signature.length, 64);
  assert.equal(await verify(publicKey, signature, message), true);
  assert.equal(await verify(publicKey, signature, utf8('hellO')), false);
});

test('the public key survives the multibase round trip', async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const multibase = await exportPublicKeyMultibase(publicKey);
  assert.match(multibase, /^z6Mk/);
  const imported = await importPublicKey(multibase);
  const signature = await sign(privateKey, utf8('x'));
  assert.equal(await verify(imported, signature, utf8('x')), true);
});

test('a private key survives the JWK backup', async () => {
  const pair = await generateKeyPair();
  const jwk = await exportPrivateKeyJwk(pair.privateKey);
  assert.equal(jwk.kty, 'OKP');
  assert.equal(jwk.crv, 'Ed25519');
  const restored = await importKeyPairFromJwk(jwk);
  assert.equal(await exportPublicKeyMultibase(restored.publicKey), await exportPublicKeyMultibase(pair.publicKey));
  const signature = await sign(restored.privateKey, utf8('x'));
  assert.equal(await verify(pair.publicKey, signature, utf8('x')), true);
});

test('a non-extractable private key cannot be exported', async () => {
  const { privateKey } = await generateKeyPair({ extractable: false });
  await assert.rejects(() => exportPrivateKeyJwk(privateKey));
});

test('the root signer key can be imported', async () => {
  const key = await importPublicKey(ROOT_SIGNER_KEY);
  assert.equal(await exportPublicKeyMultibase(key), ROOT_SIGNER_KEY);
});
