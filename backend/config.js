// Reads the runtime configuration from environment variables.
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
    blobDir: env.BLOB_DIR ?? '/data/blobs',
    maxBodyBytes: Number(env.MAX_BODY_MB ?? 25) * 1024 * 1024,
  };
}