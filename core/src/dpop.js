import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { CoreError } from './errors.js';

// DPoP (RFC 9449) with Ed25519 keys. Proofs are JWS compact strings with alg "EdDSA" (RFC 8037).
// Pure functions: replay protection (storing used jti values) is the caller's job.

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64u = (text) => Buffer.from(text, 'base64url');
const fail = (detail) => new CoreError('invalid-dpop-proof', detail);

export function isEd25519PublicJwk(jwk) {
  return (
    jwk !== null && typeof jwk === 'object' &&
    jwk.kty === 'OKP' && jwk.crv === 'Ed25519' &&
    typeof jwk.x === 'string' && fromB64u(jwk.x).length === 32 &&
    !('d' in jwk)
  );
}

// RFC 7638 JWK thumbprint (base64url of SHA-256 over the canonical required members).
export function jwkThumbprint(jwk) {
  if (!isEd25519PublicJwk(jwk)) throw new CoreError('invalid-key', 'not an Ed25519 public JWK');
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return b64u(createHash('sha256').update(canonical).digest());
}

export function publicJwkFromPrivateKeyPem(privateKeyPem) {
  const { x } = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: 'jwk' });
  return { kty: 'OKP', crv: 'Ed25519', x };
}

// Value of the `ath` claim: base64url(SHA-256(access token)) (RFC 9449 section 4.2).
export function accessTokenHash(accessToken) {
  return b64u(createHash('sha256').update(accessToken, 'ascii').digest());
}

// htu is the target URI without query and fragment (RFC 9449 section 4.2).
export function htuOf(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

// Creates a proof for one request. `accessToken` is omitted for the token request itself.
export function createDpopProof({
  privateKeyPem, method, url, accessToken, iat = Math.floor(Date.now() / 1000), jti = randomUUID(),
}) {
  const header = { typ: 'dpop+jwt', alg: 'EdDSA', jwk: publicJwkFromPrivateKeyPem(privateKeyPem) };
  const payload = { jti, htm: method.toUpperCase(), htu: htuOf(url), iat };
  if (accessToken !== undefined) payload.ath = accessTokenHash(accessToken);
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const signature = sign(null, Buffer.from(signingInput), createPrivateKey(privateKeyPem));
  return `${signingInput}.${b64u(signature)}`;
}

function parseJsonPart(part, what) {
  try {
    const value = JSON.parse(fromB64u(part).toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw fail(`${what} is not valid`);
  }
}

// Verifies one proof. `url` must be the PUBLIC URL of the request (scheme, host and path as the
// client used them). Pass `accessToken` for requests to protected resources.
// Returns { jkt, jwk, jti, iat }; the caller must reject a jti it has seen before (per jkt).
export function verifyDpopProof(proof, { method, url, accessToken, now = Date.now(), maxSkewSeconds = 60 }) {
  if (typeof proof !== 'string') throw fail('missing proof');
  const parts = proof.split('.');
  if (parts.length !== 3) throw fail('not a compact JWS');
  const header = parseJsonPart(parts[0], 'header');
  const payload = parseJsonPart(parts[1], 'payload');

  if (header.typ !== 'dpop+jwt') throw fail('typ must be dpop+jwt');
  if (header.alg !== 'EdDSA') throw fail('alg must be EdDSA');
  if (!isEd25519PublicJwk(header.jwk)) throw fail('jwk must be an Ed25519 public key');

  const key = createPublicKey({ key: header.jwk, format: 'jwk' });
  const valid = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, fromB64u(parts[2]));
  if (!valid) throw fail('signature does not match');

  if (typeof payload.jti !== 'string' || payload.jti === '' || payload.jti.length > 256) throw fail('jti missing');
  if (payload.htm !== method.toUpperCase()) throw fail('htm does not match the request method');
  if (payload.htu !== htuOf(url)) throw fail('htu does not match the request URL');
  if (!Number.isInteger(payload.iat)) throw fail('iat missing');
  if (Math.abs(Math.floor(now / 1000) - payload.iat) > maxSkewSeconds) throw fail('iat outside the accepted time window');
  if (accessToken !== undefined && payload.ath !== accessTokenHash(accessToken)) {
    throw fail('ath does not match the access token');
  }

  return { jkt: jwkThumbprint(header.jwk), jwk: header.jwk, jti: payload.jti, iat: payload.iat };
}