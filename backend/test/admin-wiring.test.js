import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../app.js';
import { hashPassword } from '../adminAuth.js';

const PUBLIC = 'https://example.test/openrwp';
const AUTH = `Basic ${Buffer.from('admin:secret').toString('base64')}`;

test('the admin area is reachable through the app (and absent when not configured)', async (t) => {
  const store = { async listNamespaces() { return []; } };
  const start = async (config) => {
    const server = http.createServer(createApp({ store, blobs: {}, config: { publicBaseUrl: PUBLIC, maxBodyBytes: 1024, ...config } }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  };

  const configured = await start({ adminUser: 'admin', adminPasswordHash: hashPassword('secret') });
  assert.equal((await fetch(`${configured}/admin/api/namespaces`)).status, 401);
  const ok = await fetch(`${configured}/admin/api/namespaces`, { headers: { Authorization: AUTH } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { namespaces: [] });
  assert.equal((await fetch(`${configured}/admin/`, { headers: { Authorization: AUTH } })).status, 200);

  const disabled = await start({});
  assert.equal((await fetch(`${disabled}/admin/`)).status, 404);
});