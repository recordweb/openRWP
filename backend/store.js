// All SQL of the custodian. Every query is limited to the schema `openrwp`.
// Interface (used by app.js): ping, getNamespace, getRecord, listVersionGraph,
// getVersion, insertVersion, currentVersion.
export function createStore(pool) {
  const key = (ns, rec) => [ns, rec];

  return {
    async ping() {
      await pool.query('SELECT 1');
    },

    async getNamespace(ns) {
      const { rows } = await pool.query(
        'SELECT namespace, author_public_key, status FROM openrwp.namespaces WHERE namespace = $1',
        [ns],
      );
      if (rows.length === 0) return null;
      return { namespace: rows[0].namespace, authorPublicKey: rows[0].author_public_key, status: rows[0].status };
    },

    async getRecord(ns, rec) {
      const { rows } = await pool.query(
        'SELECT created_at, updated_at FROM openrwp.records WHERE namespace = $1 AND record_id = $2',
        key(ns, rec),
      );
      if (rows.length === 0) return null;
      return { createdAt: rows[0].created_at.toISOString(), updatedAt: rows[0].updated_at.toISOString() };
    },

    // All versions of a record with their parents, in order of arrival.
    async listVersionGraph(ns, rec) {
      const { rows } = await pool.query(
        `SELECT v.version_hash,
                COALESCE(array_agg(p.parent_hash ORDER BY p.position)
                         FILTER (WHERE p.parent_hash IS NOT NULL), ARRAY[]::text[]) AS parents
           FROM openrwp.versions v
           LEFT JOIN openrwp.version_parents p
             ON p.namespace = v.namespace AND p.record_id = v.record_id AND p.version_hash = v.version_hash
          WHERE v.namespace = $1 AND v.record_id = $2
          GROUP BY v.version_hash, v.received_at
          ORDER BY v.received_at, v.version_hash`,
        key(ns, rec),
      );
      return rows.map((r) => ({ versionHash: r.version_hash, parents: r.parents }));
    },

    // All versions of a record with metadata (no file content), in order of arrival.
    async listVersions(ns, rec) {
      const params = key(ns, rec);
      const versions = await pool.query(
        `SELECT version_hash, state, created_at_raw, modified_at_raw, signature
           FROM openrwp.versions
          WHERE namespace = $1 AND record_id = $2
          ORDER BY received_at, version_hash`,
        params,
      );
      const parents = await pool.query(
        `SELECT version_hash, parent_hash FROM openrwp.version_parents
          WHERE namespace = $1 AND record_id = $2
          ORDER BY version_hash, position`,
        params,
      );
      const reps = await pool.query(
        `SELECT version_hash, format, role, is_primary, content_hash
           FROM openrwp.representations
          WHERE namespace = $1 AND record_id = $2
          ORDER BY version_hash, position`,
        params,
      );
      const parentsOf = new Map();
      for (const p of parents.rows) {
        if (!parentsOf.has(p.version_hash)) parentsOf.set(p.version_hash, []);
        parentsOf.get(p.version_hash).push(p.parent_hash);
      }
      const repsOf = new Map();
      for (const r of reps.rows) {
        if (!repsOf.has(r.version_hash)) repsOf.set(r.version_hash, []);
        repsOf.get(r.version_hash).push({
          format: r.format, role: r.role, primary: r.is_primary, contentHash: r.content_hash,
        });
      }
      return versions.rows.map((v) => ({
        versionHash: v.version_hash,
        state: v.state,
        parents: parentsOf.get(v.version_hash) ?? [],
        createdAtRaw: v.created_at_raw,
        modifiedAtRaw: v.modified_at_raw,
        signature: v.signature,
        representations: repsOf.get(v.version_hash) ?? [],
      }));
    },
    
    async getVersion(ns, rec, hash) {
      const params = [ns, rec, hash];
      const versions = await pool.query(
        `SELECT version_hash, state, created_at_raw, modified_at_raw, signature
           FROM openrwp.versions
          WHERE namespace = $1 AND record_id = $2 AND version_hash = $3`,
        params,
      );
      if (versions.rows.length === 0) return null;
      const v = versions.rows[0];
      const parents = await pool.query(
        `SELECT parent_hash FROM openrwp.version_parents
          WHERE namespace = $1 AND record_id = $2 AND version_hash = $3
          ORDER BY position`,
        params,
      );
      const reps = await pool.query(
        `SELECT format, role, is_primary, content_hash, file_hash, size_bytes
           FROM openrwp.representations
          WHERE namespace = $1 AND record_id = $2 AND version_hash = $3
          ORDER BY position`,
        params,
      );
      return {
        versionHash: v.version_hash,
        state: v.state,
        parents: parents.rows.map((r) => r.parent_hash),
        createdAtRaw: v.created_at_raw,
        modifiedAtRaw: v.modified_at_raw,
        signature: v.signature,
        representations: reps.rows.map((r) => ({
          format: r.format,
          role: r.role,
          primary: r.is_primary,
          contentHash: r.content_hash,
          fileHash: r.file_hash,
          size: Number(r.size_bytes),
        })),
      };
    },

    // Creates the record if needed and stores one version. Returns 'created' or 'exists'.
    async insertVersion(ns, rec, version, stored) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO openrwp.records (namespace, record_id) VALUES ($1, $2)
           ON CONFLICT (namespace, record_id) DO UPDATE SET updated_at = NOW()`,
          key(ns, rec),
        );
        const inserted = await client.query(
          `INSERT INTO openrwp.versions
             (namespace, record_id, version_hash, state, created_at_raw, modified_at_raw,
              created_at, modified_at, signature)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [
            ns, rec, version.versionHash, version.state, version.createdAt, version.modifiedAt,
            new Date(version.createdAt).toISOString(), new Date(version.modifiedAt).toISOString(),
            version.signature ?? null,
          ],
        );
        if (inserted.rowCount === 0) {
          await client.query('ROLLBACK');
          return 'exists';
        }
        for (const [position, parent] of version.parents.entries()) {
          await client.query(
            `INSERT INTO openrwp.version_parents
               (namespace, record_id, version_hash, parent_hash, position)
             VALUES ($1, $2, $3, $4, $5)`,
            [ns, rec, version.versionHash, parent, position],
          );
        }
        for (const [position, rep] of version.representations.entries()) {
          await client.query(
            `INSERT INTO openrwp.representations
               (namespace, record_id, version_hash, position, content_hash, format, role,
                is_primary, file_hash, size_bytes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              ns, rec, version.versionHash, position, rep.contentHash, rep.format, rep.role ?? null,
              rep.primary, stored[position].fileHash, stored[position].size,
            ],
          );
        }
        await client.query('COMMIT');
        return 'created';
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    // Option A: the head with the newest createdAt (informational only, RWP 4.3 currentVersion).
    async currentVersion(ns, rec) {
      const { rows } = await pool.query(
        `SELECT v.version_hash
           FROM openrwp.versions v
          WHERE v.namespace = $1 AND v.record_id = $2
            AND NOT EXISTS (
              SELECT 1 FROM openrwp.version_parents p
               WHERE p.namespace = v.namespace AND p.record_id = v.record_id
                 AND p.parent_hash = v.version_hash)
          ORDER BY v.created_at DESC, v.received_at DESC, v.version_hash
          LIMIT 1`,
        key(ns, rec),
      );
      return rows.length > 0 ? rows[0].version_hash : null;
    },

    async getDeviceByJkt(jkt) {
      const { rows } = await pool.query(
        `SELECT d.id, d.namespace, d.label, d.revoked_at, n.status AS namespace_status
           FROM openrwp.devices d
           JOIN openrwp.namespaces n ON n.namespace = d.namespace
          WHERE d.jkt = $1`,
        [jkt],
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        id: Number(r.id),
        namespace: r.namespace,
        label: r.label,
        revokedAt: r.revoked_at,
        namespaceStatus: r.namespace_status,
      };
    },

    // Returns true if the jti was new, false if it was already used (replay).
    async recordDpopJti(jkt, jti, ttlSeconds) {
      await pool.query('DELETE FROM openrwp.dpop_jti WHERE expires_at < NOW()');
      const result = await pool.query(
        `INSERT INTO openrwp.dpop_jti (jkt, jti, expires_at)
         VALUES ($1, $2, NOW() + make_interval(secs => $3::double precision))
         ON CONFLICT DO NOTHING`,
        [jkt, jti, ttlSeconds],
      );
      return result.rowCount === 1;
    },

    async createToken(deviceId, tokenHash, ttlSeconds) {
      await pool.query('DELETE FROM openrwp.oauth_tokens WHERE expires_at < NOW()');
      await pool.query(
        `INSERT INTO openrwp.oauth_tokens (token_hash, device_id, expires_at)
         VALUES ($1, $2, NOW() + make_interval(secs => $3::double precision))`,
        [tokenHash, deviceId, ttlSeconds],
      );
    },    
  };
}