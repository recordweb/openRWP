import { CoreError } from './errors.js';
import { publicKeyToMultibase, multibaseToPublicKey } from './multibase.js';

// Ed25519 keys through Web Crypto (RWP 7.7): browsers (Chrome 137, Firefox 129, Safari 17) and Node.js >= 20.
// Web Crypto is only available in secure contexts (HTTPS or localhost).

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new CoreError('no-webcrypto', 'Web Crypto is not available (secure context required)');
  return s;
};

// extractable = false keeps the private key inside the browser, but it can no longer be exported as a backup.
export async function generateKeyPair({ extractable = true } = {}) {
  return subtle().generateKey('Ed25519', extractable, ['sign', 'verify']);
}

export async function exportPublicKeyMultibase(publicKey) {
  return publicKeyToMultibase(new Uint8Array(await subtle().exportKey('raw', publicKey)));
}

export async function importPublicKey(publicKeyMultibase) {
  return subtle().importKey('raw', multibaseToPublicKey(publicKeyMultibase), 'Ed25519', true, ['verify']);
}

// Backup format of a private key: JWK with kty OKP, crv Ed25519, d and x.
export async function exportPrivateKeyJwk(privateKey) {
  return subtle().exportKey('jwk', privateKey);
}

export async function importKeyPairFromJwk(jwk) {
  const privateKey = await subtle().importKey('jwk', jwk, 'Ed25519', true, ['sign']);
  const publicKey = await subtle().importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, 'Ed25519', true, ['verify']);
  return { privateKey, publicKey };
}

export async function sign(privateKey, bytes) {
  return new Uint8Array(await subtle().sign('Ed25519', privateKey, bytes));
}

export async function verify(publicKey, signature, bytes) {
  return subtle().verify('Ed25519', publicKey, signature, bytes);
}
