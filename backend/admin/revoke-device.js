import { pool, initializeDatabase } from '../db.js';

// Usage (inside the container):
//   docker exec openrwp node admin/revoke-device.js <device-id>
const id = Number(process.argv[2]);

try {
  if (!Number.isInteger(id) || id < 1) {
    console.error('usage: revoke-device.js <device-id>');
    process.exitCode = 1;
  } else {
    await initializeDatabase();
    const result = await pool.query(
      `UPDATE openrwp.devices SET revoked_at = NOW()
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING id, namespace, label, revoked_at`,
      [id],
    );
    if (result.rowCount === 0) {
      console.error(`ERROR: device ${id} not found or already revoked`);
      process.exitCode = 1;
    } else {
      console.log('revoked:', result.rows[0]);
    }
  }
} finally {
  await pool.end();
}