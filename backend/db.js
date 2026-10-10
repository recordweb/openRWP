import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? 'db',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

// Each migration runs once, in order, and is recorded in openrwp.migrations.
const migrations = [
  {
    id: '001_meta',
    sql: `
      CREATE TABLE openrwp.meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO openrwp.meta (key, value) VALUES ('created', NOW()::text);
    `,
  },
];

export async function initializeDatabase() {
  await pool.query('CREATE SCHEMA IF NOT EXISTS openrwp');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS openrwp.migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  for (const m of migrations) {
    const done = await pool.query('SELECT 1 FROM openrwp.migrations WHERE id = $1', [m.id]);
    if (done.rowCount > 0) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(m.sql);
      await client.query('INSERT INTO openrwp.migrations (id) VALUES ($1)', [m.id]);
      await client.query('COMMIT');
      console.log(`migration applied: ${m.id}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}