import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import {
  createDpopProof, verifyDpopProof, jwkThumbprint, accessTokenHash, htuOf,
  publicJwkFromPrivateKeyPem, isEd25519PublicJwk,
} from '../index.js';

const URL_ = 'https://vps.recordweb.dev/openrwp/records/ns/rec/versions';
const TOKEN = 'Kz~8mXK1EalYznwH-LC-1fBAo.4Ljp~zsPE_NeO.gxU';
const NOW = Date.UTC(2026, 9, 10, 15, 0, 0);
const IAT = NOW / 1000;

const newKey = () => generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
const b64u = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function proofWith(privateKeyPem, header, payload) {
  const input = `${b64u(header)}.${b64u(payload)}`;
  const sig = sign(null, Buffer.from(input), createPrivateKey(privateKeyPem)).toString('base64url');
  return `${input}.${sig}`;
}

test('RFC test vectors: Ed25519 JWK thumbprint (RFC 8037) and ath (RFC 9449)', () => {
  const jwk = { kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' };
  assert.equal(jwkThumbprint(jwk), 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k');
  assert.equal(accessTokenHash(TOKEN), 'fUHyO2r2Z3DZ53EsNrWBb0xWXoaNy59IiKCAqksmQEo');
});

test('RFC 8037 Ed25519 signing vector is reproduced by our key handling', () => {
  const pem = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' },
    format: 'jwk',
  }).export({ format: 'pem', type: 'pkcs8' });
  const input = 'eyJhbGciOiJFZERTQSJ9.RXhhbXBsZSBvZiBFZDI1NTE5IHNpZ25pbmc';
  assert.equal(
    sign(null, Buffer.from(input), createPrivateKey(pem)).toString('base64url'),
    'hgyY0il_MGCjP0JzlnLWG1PPOt7-09PGcvMg3AIbQR6dWbhijcNR4ki4iylGjg5BhVsPt9g7sVvpAr_MuM0KAg',
  );
  assert.equal(publicJwkFromPrivateKeyPem(pem).x, '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo');
});

test('a proof verifies and returns the key thumbprint', () => {
  const pem = newKey();
  const proof = createDpopProof({ privateKeyPem: pem, method: 'post', url: URL_, iat: IAT, jti: 'abc' });
  const result = verifyDpopProof(proof, { method: 'POST', url: URL_, now: NOW });
  assert.equal(result.jti, 'abc');
  assert.equal(result.iat, IAT);
  assert.equal(result.jkt, jwkThumbprint(publicJwkFromPrivateKeyPem(pem)));
});

test('htu ignores query and fragment; the path must match', () => {
  const proof = createDpopProof({ privateKeyPem: newKey(), method: 'GET', url: `${URL_}?a=1#x`, iat: IAT });
  assert.equal(htuOf(`${URL_}?a=1#x`), URL_);
  verifyDpopProof(proof, { method: 'GET', url: URL_, now: NOW });
  assert.throws(() => verifyDpopProof(proof, { method: 'GET', url: `${URL_}/other`, now: NOW }), { code: 'invalid-dpop-proof' });
});

test('method, time window and access token binding are enforced', () => {
  const pem = newKey();
  const proof = createDpopProof({ privateKeyPem: pem, method: 'GET', url: URL_, iat: IAT, accessToken: TOKEN });
  verifyDpopProof(proof, { method: 'GET', url: URL_, accessToken: TOKEN, now: NOW });
  assert.throws(() => verifyDpopProof(proof, { method: 'POST', url: URL_, accessToken: TOKEN, now: NOW }), /htm/);
  assert.throws(() => verifyDpopProof(proof, { method: 'GET', url: URL_, accessToken: TOKEN, now: NOW + 61_000 }), /time window/);
  assert.throws(() => verifyDpopProof(proof, { method: 'GET', url: URL_, accessToken: TOKEN, now: NOW - 61_000 }), /time window/);
  verifyDpopProof(proof, { method: 'GET', url: URL_, accessToken: TOKEN, now: NOW + 59_000 });
  assert.throws(() => verifyDpopProof(proof, { method: 'GET', url: URL_, accessToken: 'other', now: NOW }), /ath/);
  const noAth = createDpopProof({ privateKeyPem: pem, method: 'GET', url: URL_, iat: IAT });
  assert.throws(() => verifyDpopProof(noAth, { method: 'GET', url: URL_, accessToken: TOKEN, now: NOW }), /ath/);
});

test('forged or malformed proofs are rejected', () => {
  const pem = newKey();
  const jwk = publicJwkFromPrivateKeyPem(pem);
  const payload = { jti: 'x', htm: 'GET', htu: URL_, iat: IAT };
  const check = (proof) => assert.throws(() => verifyDpopProof(proof, { method: 'GET', url: URL_, now: NOW }), { code: 'invalid-dpop-proof' });

  verifyDpopProof(proofWith(pem, { typ: 'dpop+jwt', alg: 'EdDSA', jwk }, payload), { method: 'GET', url: URL_, now: NOW });
  check(proofWith(pem, { typ: 'JWT', alg: 'EdDSA', jwk }, payload));
  check(proofWith(pem, { typ: 'dpop+jwt', alg: 'none', jwk }, payload));
  check(proofWith(pem, { typ: 'dpop+jwt', alg: 'HS256', jwk }, payload));
  check(proofWith(pem, { typ: 'dpop+jwt', alg: 'EdDSA' }, payload));
  check(proofWith(pem, { typ: 'dpop+jwt', alg: 'EdDSA', jwk: { ...jwk, d: 'secret' } }, payload));
  check(proofWith(pem, { typ: 'dpop+jwt', alg: 'EdDSA', jwk }, { ...payload, jti: '' }));
  check(proofWith(pem, { typ: 'dpop+jwt', alg: 'EdDSA', jwk }, { ...payload, iat: 'now' }));
  // signed with a different key than the one in the header
  check(proofWith(newKey(), { typ: 'dpop+jwt', alg: 'EdDSA', jwk }, payload));
  const good = createDpopProof({ privateKeyPem: pem, method: 'GET', url: URL_, iat: IAT });
  check(good.slice(0, -2) + (good.endsWith('AA') ? 'BB' : 'AA'));
  check('a.b');
  check('');
  assert.throws(() => verifyDpopProof(undefined, { method: 'GET', url: URL_, now: NOW }), { code: 'invalid-dpop-proof' });
});

test('public JWK checks', () => {
  const jwk = publicJwkFromPrivateKeyPem(newKey());
  assert.ok(isEd25519PublicJwk(jwk));
  assert.ok(!isEd25519PublicJwk({ ...jwk, d: 'x' }));
  assert.ok(!isEd25519PublicJwk({ ...jwk, crv: 'P-256' }));
  assert.ok(!isEd25519PublicJwk({ kty: 'OKP', crv: 'Ed25519', x: 'AAAA' }));
  assert.ok(!isEd25519PublicJwk(null));
  assert.throws(() => jwkThumbprint({ kty: 'RSA' }), { code: 'invalid-key' });
});