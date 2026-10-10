import http from 'node:http';
import { pool, initializeDatabase } from './db.js';
import { sha256Hex } from '../core/index.js';
import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { createBlobStore } from './blobs.js';
import { createApp } from './app.js';

// Startup self-check: proves the shared core is wired into the image.
if (sha256Hex('abc') !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
  throw new Error('core self-check failed');
}

const config = loadConfig();
if (!config.publicBaseUrl) console.warn('PUBLIC_BASE_URL is not set: DID documents will contain relative endpoints');

await initializeDatabase();

const app = createApp({ store: createStore(pool), blobs: createBlobStore(config.blobDir), config });
http.createServer(app).listen(config.port, () => console.log(`openrwp listening on ${config.port}`));