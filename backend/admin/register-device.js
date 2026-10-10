import { pool, initializeDatabase } from '../db.js';
import { isUuidV4, isEd25519PublicJwk, jwkThumbprint } from '../../core/index.js';

// Usage (inside the container):
//   docker exec openrwp node admin/register-device.js <namespace-uuid> <label> <public-key-x>
// <public-key-x> is printed by `node core/bin/dpop.js keygen <file>`.
const [namespace, label, x] = process.argv.slice(2);

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

async function main() {
  if (!namespace || !label || !x) return fail('usage: register-device.js <namespace-uuid> <label> <public-key-x>');
  if (!isUuidV4(namespace)) return fail('namespace must be a lowercase UUIDv4');
  const jwk = { kty: 'OKP', crv: 'Ed25519', x };
  if (!isEd25519PublicJwk(jwk)) return fail('public key must be a base64url Ed25519 key (32 bytes)');

  await initializeDatabase();
  try {
    const result = await pool.query(
      `INSERT INTO openrwp.devices (namespace, public_jwk, jkt, label)
       VALUES ($1, $2, $3, $4)
       RETURNING id, namespace, label, jkt, created_at`,
      [namespace, jwk, jwkThumbprint(jwk), label],
    );
    console.log('registered:', result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return fail('this device key is already registered');
    if (err.code === '23503') return fail(`namespace ${namespace} is not registered`);
    throw err;
  }
}

try {
  await main();
} finally {
  await pool.end();
}