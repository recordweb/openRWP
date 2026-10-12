// Placeholder record types (SchemaRecord DIDs). The server does not resolve or validate them in this
// version; replace them through the environment once real SchemaRecords exist.
const DEFAULT_RECORD_TYPE = 'did:rwp:4d3c45e8-1785-4f52-90f7-b9f5811935ad:7819d43a-3bd7-4cb0-bff6-b2e61044a3af';
const DEFAULT_AGENT_TYPE = 'did:rwp:4d3c45e8-1785-4f52-90f7-b9f5811935ad:cc8c6ae9-ba0a-4fff-be51-0d8a534a2f96';

// Reads the runtime configuration from environment variables.
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
    blobDir: env.BLOB_DIR ?? '/data/blobs',
    maxBodyBytes: Number(env.MAX_BODY_MB ?? 25) * 1024 * 1024,
    recordTypeDefault: env.RECORD_TYPE_DEFAULT ?? DEFAULT_RECORD_TYPE,
    recordTypeAgent: env.RECORD_TYPE_AGENT ?? DEFAULT_AGENT_TYPE,
    // Admin login (HTTP Basic). Without both values the admin area does not exist.
    adminUser: env.ADMIN_USER ?? '',
    adminPasswordHash: env.ADMIN_PASSWORD_HASH ?? '',
  };
}