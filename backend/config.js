// Reads the runtime configuration from environment variables.
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
    blobDir: env.BLOB_DIR ?? '/data/blobs',
    // Temporary development access (replaced by DPoP in the authentication step).
    // Empty value: all protected routes are closed.
    devToken: env.DEV_TOKEN ?? '',
    maxBodyBytes: Number(env.MAX_BODY_MB ?? 25) * 1024 * 1024,
  };
}