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
  {
    id: '002_core',
    sql: `
      CREATE TABLE openrwp.namespaces (
        namespace UUID PRIMARY KEY,
        label TEXT NOT NULL,
        author_public_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE openrwp.devices (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        namespace UUID NOT NULL REFERENCES openrwp.namespaces (namespace),
        public_jwk JSONB NOT NULL,
        jkt TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );

      CREATE TABLE openrwp.records (
        namespace UUID NOT NULL REFERENCES openrwp.namespaces (namespace),
        record_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, record_id)
      );

      CREATE TABLE openrwp.versions (
        namespace UUID NOT NULL,
        record_id UUID NOT NULL,
        version_hash TEXT NOT NULL CHECK (version_hash ~ '^[0-9a-f]{64}$'),
        state TEXT NOT NULL CHECK (state IN ('draft', 'finalized')),
        created_at_raw TEXT NOT NULL,
        modified_at_raw TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        modified_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        signature TEXT,
        PRIMARY KEY (namespace, record_id, version_hash),
        FOREIGN KEY (namespace, record_id)
          REFERENCES openrwp.records (namespace, record_id) ON DELETE CASCADE
      );

      CREATE TABLE openrwp.version_parents (
        namespace UUID NOT NULL,
        record_id UUID NOT NULL,
        version_hash TEXT NOT NULL,
        parent_hash TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (namespace, record_id, version_hash, position),
        UNIQUE (namespace, record_id, version_hash, parent_hash),
        FOREIGN KEY (namespace, record_id, version_hash)
          REFERENCES openrwp.versions (namespace, record_id, version_hash) ON DELETE CASCADE,
        FOREIGN KEY (namespace, record_id, parent_hash)
          REFERENCES openrwp.versions (namespace, record_id, version_hash)
      );
      CREATE INDEX version_parents_parent_idx
        ON openrwp.version_parents (namespace, record_id, parent_hash);

      CREATE TABLE openrwp.representations (
        namespace UUID NOT NULL,
        record_id UUID NOT NULL,
        version_hash TEXT NOT NULL,
        position INTEGER NOT NULL,
        content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
        format TEXT NOT NULL,
        role TEXT,
        is_primary BOOLEAN NOT NULL,
        content_encoding TEXT NOT NULL DEFAULT 'base64',
        file_hash TEXT NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$'),
        size_bytes BIGINT NOT NULL,
        PRIMARY KEY (namespace, record_id, version_hash, position),
        FOREIGN KEY (namespace, record_id, version_hash)
          REFERENCES openrwp.versions (namespace, record_id, version_hash) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX representations_one_primary_idx
        ON openrwp.representations (namespace, record_id, version_hash)
        WHERE is_primary;

      CREATE TABLE openrwp.record_settings (
        namespace UUID NOT NULL,
        record_id UUID NOT NULL,
        settings JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, record_id),
        FOREIGN KEY (namespace, record_id)
          REFERENCES openrwp.records (namespace, record_id) ON DELETE CASCADE
      );

      CREATE TABLE openrwp.access_links (
        token_hash TEXT PRIMARY KEY,
        namespace UUID NOT NULL,
        record_id UUID NOT NULL,
        modes TEXT[] NOT NULL DEFAULT ARRAY['read'],
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (namespace, record_id)
          REFERENCES openrwp.records (namespace, record_id) ON DELETE CASCADE
      );
    `,
  },
  {
    id: '003_auth',
    sql: `
      CREATE TABLE openrwp.oauth_tokens (
        token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        device_id BIGINT NOT NULL REFERENCES openrwp.devices (id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX oauth_tokens_expires_idx ON openrwp.oauth_tokens (expires_at);

      CREATE TABLE openrwp.dpop_jti (
        jkt TEXT NOT NULL,
        jti TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (jkt, jti)
      );
      CREATE INDEX dpop_jti_expires_idx ON openrwp.dpop_jti (expires_at);
    `,
  },
  {
    id: '004_links',
    sql: `
      ALTER TABLE openrwp.access_links ADD COLUMN link_id UUID NOT NULL;
      ALTER TABLE openrwp.access_links ADD CONSTRAINT access_links_link_id_key UNIQUE (link_id);
      CREATE INDEX access_links_record_idx ON openrwp.access_links (namespace, record_id);
    `,
  },
  {
    id: '005_metadata',
    sql: `
      ALTER TABLE openrwp.namespaces ADD COLUMN agent_record_id UUID;

      CREATE TABLE openrwp.record_metadata (
        namespace UUID NOT NULL,
        record_id UUID NOT NULL,
        metadata JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (namespace, record_id),
        FOREIGN KEY (namespace, record_id)
          REFERENCES openrwp.records (namespace, record_id) ON DELETE CASCADE
      );
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