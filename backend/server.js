import http from 'node:http';
import { pool, initializeDatabase } from './db.js';
import { sha256Hex } from '../core/index.js';

// Startup self-check: proves the shared core is wired into the image.
if (sha256Hex('abc') !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
  throw new Error('core self-check failed');
}

const PORT = Number(process.env.PORT ?? 3000);

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    try {
      await pool.query('SELECT 1');
      return send(res, 200, { status: 'ok', service: 'openrwp', db: 'ok', core: 'ok' });
    } catch (err) {
      console.error('health check failed:', err.message);
      return send(res, 503, { status: 'error', service: 'openrwp', db: 'error' });
    }
  }
  send(res, 404, { error: 'not-found' });
});

await initializeDatabase();
server.listen(PORT, () => console.log(`openrwp listening on ${PORT}`));