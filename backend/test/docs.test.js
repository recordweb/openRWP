import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDocsHandler } from '../docs.js';
import { buildOpenApi } from '../openapi.js';
import { HttpError, sendJson } from '../http.js';
import { startServer } from './helpers.js';

const EXPECTED_ROUTES = [
  'get /health',
  'get /did/{did}',
  'get /records/{ns}/{rec}',
  'get /records/{ns}/{rec}/metadata',
  'put /records/{ns}/{rec}/metadata',
  'post /token',
  'post /records/{ns}/{rec}/versions',
  'get /records/{ns}/{rec}/versions/{hash}',
  'get /records/{ns}/{rec}/versions/{hash}/content',
  'post /records/{ns}/{rec}/sync',
  'get /records/{ns}/{rec}/settings',
  'put /records/{ns}/{rec}/settings',
  'get /c/{token}',
  'get /c/{token}/versions/{hash}',
  'get /c/{token}/versions/{hash}/content',
].sort();

function collectRefs(node, found = []) {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, found));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref') found.push(v);
      else collectRefs(v, found);
    }
  }
  return found;
}

test('the OpenAPI document lists exactly the implemented routes', () => {
  const spec = buildOpenApi('https://example.test/openrwp');
  assert.equal(spec.openapi, '3.0.3');
  assert.deepEqual(spec.servers, [{ url: 'https://example.test/openrwp' }]);
  const routes = Object.entries(spec.paths).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m} ${path}`)).sort();
  assert.deepEqual(routes, EXPECTED_ROUTES);
});

test('all $ref targets exist and every operation is documented', () => {
  const spec = buildOpenApi('');
  for (const target of collectRefs(spec)) {
    const parts = target.replace('#/', '').split('/');
    let node = spec;
    for (const p of parts) node = node?.[p];
    assert.ok(node !== undefined, `unresolved reference ${target}`);
  }
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      assert.ok(op.summary && op.responses && Object.keys(op.responses).length > 0, `${method} ${path}`);
      const needsAuth = path.startsWith('/records/');
      assert.equal(Boolean(op.security), needsAuth, `security of ${method} ${path}`);
    }
  }
});

async function serve() {
  const handler = createDocsHandler({ config: { publicBaseUrl: 'https://example.test/openrwp' } });
  const server = http.createServer((req, res) => {
    const seg = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
    try {
      handler(req, res, seg);
    } catch (err) {
      if (err instanceof HttpError) sendJson(res, err.status, err.body);
      else throw err;
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test('the handler serves the Swagger UI page and the JSON document', async (t) => {
  const s = await serve(); t.after(s.close);
  for (const path of ['/api-docs', '/api-docs/']) {
    const page = await fetch(s.base + path);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    const html = await page.text();
    assert.ok(html.includes('"https://example.test/openrwp/api-docs/openapi.json"'));
    assert.ok(html.includes('swagger-ui-bundle.js'));
  }
  const spec = await fetch(`${s.base}/api-docs/openapi.json`);
  assert.equal(spec.status, 200);
  assert.equal((await spec.json()).info.title, 'OpenRWP custodian API');
  assert.equal((await fetch(`${s.base}/api-docs/other`)).status, 404);
  assert.equal((await fetch(`${s.base}/api-docs`, { method: 'POST' })).status, 405);
});

test('the app serves the documentation without authentication', async (t) => {
  const s = await startServer(); t.after(s.close);
  const res = await s.request('/api-docs/openapi.json', { token: null });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).openapi, '3.0.3');
  assert.equal((await s.request('/api-docs', { token: null })).status, 200);
});