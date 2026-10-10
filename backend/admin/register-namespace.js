import { pool, initializeDatabase } from '../db.js';
import { isUuidV4, multibaseToPublicKey } from '../../core/index.js';

// Usage (inside the container):
//   docker exec openrwp node admin/register-namespace.js <namespace-uuid> <label> <publicKeyMultibase>
const [namespace, label, publicKey] = process.argv.slice(2);

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

async function main() {
  if (!namespace || !label || !publicKey) {
    return fail('usage: register-namespace.js <namespace-uuid> <label> <publicKeyMultibase>');
  }
  if (!isUuidV4(namespace)) return fail('namespace must be a lowercase UUIDv4');
  try {
    multibaseToPublicKey(publicKey);
  } catch (err) {
    return fail(`invalid public key: ${err.message}`);
  }

  await initializeDatabase();
  try {
    const result = await pool.query(
      `INSERT INTO openrwp.namespaces (namespace, label, author_public_key)
       VALUES ($1, $2, $3)
       RETURNING namespace, label, author_public_key, status, created_at`,
      [namespace, label, publicKey],
    );
    console.log('registered:', result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return fail(`namespace ${namespace} is already registered`);
    throw err;
  }
}

try {
  await main();
} finally {
  await pool.end();
}