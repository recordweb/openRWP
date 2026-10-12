import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  validateVersion, publicJwkFromPrivateKeyPem, jwkThumbprint, publicKeyToMultibase, makeDid,
} from '../../core/index.js';
import { createAdmin } from '../admin.js';
import { hashPassword, verifyPassword } from '../adminAuth.js';
import { buildAgentVersion } from '../agentRecord.js';
import { createBlobStore } from '../blobs.js';
import { HttpError, sendJson } from '../http.js';

const PUBLIC = 'https://example.test/openrwp';
const TYPE_AGENT = 'did:rwp:4d3c45e8-1785-4f52-90f7-b9f5811935ad:cc8c6ae9-ba0a-4fff-be51-0d8a534a2f96';
const PASSWORD_HASH = hashPassword('secret');
const AUTH = `Basic ${Buffer.from('admin:secret').toString('base64')}`;

const newKey = () => generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
const rawKey = (pem) => Buffer.from(publicJwkFromPrivateKeyPem(pem).x, 'base64url');
const multibase = () => publicKeyToMultibase(rawKey(newKey()));
const deviceX = () => publicJwkFromPrivateKeyPem(newKey()).x;

// In-memory store with the admin part of the store.js interface.
class FakeAdminStore {
  constructor() {
    this.namespaces = new Map();
    this.devices = [];
    this.records = new Map(); // `${ns}/${rec}` -> { versions: [], metadata }
  }
  async listNamespaces() {
    return [...this.namespaces.values()].map((n) => ({
      ...n,
      devices: this.devices.filter((d) => d.namespace === n.namespace).length,
      records: [...this.records.keys()].filter((k) => k.startsWith(`${n.namespace}/`)).length,
    }));
  }
  async getNamespace(ns) { return this.namespaces.get(ns) ?? null; }
  async createNamespace({ namespace, label, authorPublicKey }) {
    if (this.namespaces.has(namespace)) return 'exists';
    this.namespaces.set(namespace, {
      namespace, label, authorPublicKey, status: 'active', agentRecordId: null, createdAt: new Date(),
    });
    return 'created';
  }
  async updateNamespace(ns, { label, status }) {
    const n = this.namespaces.get(ns);
    if (!n) return null;
    if (label !== null) n.label = label;
    if (status !== null) n.status = status;
    return { ...n };
  }
  async setAgentRecordId(ns, id) { this.namespaces.get(ns).agentRecordId = id; }
  async listDevices(ns) { return this.devices.filter((d) => d.namespace === ns); }
  async createDevice({ namespace, label, jwk, jkt }) {
    if (!this.namespaces.has(namespace)) return 'unknown-namespace';
    if (this.devices.some((d) => d.jkt === jkt)) return 'exists';
    const device = { id: this.devices.length + 1, namespace, label, jwk, jkt, createdAt: new Date(), revokedAt: null };
    this.devices.push(device);
    return device;
  }
  async revokeDevice(id) {
    const d = this.devices.find((x) => x.id === id);
    if (!d) return null;
    d.revokedAt ??= new Date();
    return d;
  }
  async listRecordIds(ns) {
    return [...this.records.keys()].filter((k) => k.startsWith(`${ns}/`)).map((k) => k.split('/')[1]);
  }
  async listVersions(ns, rec) { return this.records.get(`${ns}/${rec}`)?.versions ?? []; }
  async getVersion(ns, rec, hash) {
    return this.records.get(`${ns}/${rec}`)?.versions.find((v) => v.versionHash === hash) ?? null;
  }
  async insertVersion(ns, rec, version, stored, initialMetadata) {
    const key = `${ns}/${rec}`;
    if (!this.records.has(key)) this.records.set(key, { versions: [], metadata: initialMetadata });
    this.records.get(key).versions.push({
      versionHash: version.versionHash, state: version.state, parents: version.parents,
      createdAtRaw: version.createdAt, modifiedAtRaw: version.modifiedAt, signature: null,
      representations: version.representations.map((r, i) => ({
        format: r.format, role: r.role ?? null, primary: r.primary, contentHash: r.contentHash,
        fileHash: stored[i].fileHash, size: stored[i].size,
      })),
    });
    return 'created';
  }
}

async function start(overrides = {}) {
  const store = new FakeAdminStore();
  const blobs = createBlobStore(await mkdtemp(join(tmpdir(), 'admin-')));
  const config = {
    publicBaseUrl: PUBLIC, adminUser: 'admin', adminPasswordHash: PASSWORD_HASH, recordTypeAgent: TYPE_AGENT, ...overrides,
  };
  const handler = createAdmin({ store, blobs, config });
  const server = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, err.body, err.headers);
      console.error(err);
      sendJson(res, 500, { error: 'internal-error' });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = 'GET', body, raw, auth = AUTH, headers = {} } = {}) => fetch(base + path, {
    method,
    redirect: 'manual',
    headers: {
      ...(auth ? { Authorization: auth } : {}),
      ...(method !== 'GET' ? { 'X-Requested-With': 'fetch' } : {}),
      ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { store, request, close: () => new Promise((resolve) => server.close(resolve)) };
}

const api = (path) => `/admin/api/${path}`;
const json = async (res) => res.json();

test('password hashes verify and use a compose-safe format', () => {
  const hash = hashPassword('s3cret');
  assert.match(hash, /^scrypt:16384:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.ok(!hash.includes('$'));
  assert.ok(verifyPassword('s3cret', hash));
  assert.ok(!verifyPassword('other', hash));
  assert.ok(!verifyPassword('s3cret', 'garbage'));
  assert.ok(!verifyPassword('s3cret', ''));
  assert.ok(!verifyPassword('s3cret', undefined));
  assert.notEqual(hashPassword('s3cret'), hash);
});

test('the AgentRecord version is a valid draft version with JSON content', () => {
  const { version, bytes } = buildAgentVersion({ name: 'Nik Jenzer', email: 'nik@example.com', parents: [] });
  validateVersion(version, { allowedStates: ['draft'] });
  assert.deepEqual(JSON.parse(bytes.toString()), { type: 'person', name: 'Nik Jenzer', email: 'nik@example.com' });
  assert.equal(version.representations[0].format, 'application/json');
  assert.match(version.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('without ADMIN_USER or ADMIN_PASSWORD_HASH the area does not exist', async (t) => {
  for (const overrides of [{ adminUser: '' }, { adminPasswordHash: '' }]) {
    const s = await start(overrides); t.after(s.close);
    assert.equal((await s.request('/admin/')).status, 404);
    assert.equal((await s.request(api('namespaces'))).status, 404);
  }
});

test('login: challenge without credentials, rejection of wrong ones, then a lock', async (t) => {
  const s = await start(); t.after(s.close);
  const none = await s.request(api('namespaces'), { auth: null });
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate'), /^Basic realm="OpenRWP admin"/);
  const wrong = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  assert.equal((await s.request(api('namespaces'), { auth: wrong('admin', 'nope') })).status, 401);
  assert.equal((await s.request(api('namespaces'), { auth: wrong('root', 'secret') })).status, 401);
  assert.equal((await s.request(api('namespaces'), { auth: 'Bearer x' })).status, 401);
  assert.equal((await s.request(api('namespaces'))).status, 200);
  // only requests with wrong credentials count (2 so far); 20 of them lock the area
  for (let i = 0; i < 18; i++) await s.request(api('namespaces'), { auth: wrong('admin', `bad${i}`) });
  const locked = await s.request(api('namespaces'));
  assert.equal(locked.status, 429);
  assert.equal(locked.headers.get('retry-after'), '600');
});

test('changing requests need the X-Requested-With header (CSRF)', async (t) => {
  const s = await start(); t.after(s.close);
  const body = { label: 'x', authorPublicKey: multibase() };
  const res = await fetch(`${(await s.request('/admin/')).url}api/namespaces`, {
    method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(res.status, 403);
  assert.equal((await s.request(api('namespaces'), { method: 'POST', body })).status, 201);
});

test('page, script and style are served with a strict content security policy', async (t) => {
  const s = await start(); t.after(s.close);
  const redirect = await s.request('/admin');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), `${PUBLIC}/admin/`);
  const page = await s.request('/admin/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.ok(html.includes('src="app.js"') && html.includes('href="app.css"'));
  assert.ok(!html.includes('<script>'));
  const script = await s.request('/admin/app.js');
  assert.match(script.headers.get('content-type'), /^text\/javascript/);
  assert.ok((await script.text()).includes('X-Requested-With'));
  assert.match((await s.request('/admin/app.css')).headers.get('content-type'), /^text\/css/);
  assert.equal((await s.request('/admin/other')).status, 404);
  assert.equal((await s.request('/admin/', { auth: null })).status, 401);
});

test('namespaces: create, list, show, change label and status', async (t) => {
  const s = await start(); t.after(s.close);
  const key = multibase();
  const created = await s.request(api('namespaces'), { method: 'POST', body: { label: ' Nik demo ', authorPublicKey: key } });
  assert.equal(created.status, 201);
  const ns = await json(created);
  assert.match(ns.namespace, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual([ns.label, ns.status, ns.authorPublicKey, ns.agentRecordId], ['Nik demo', 'active', key, null]);

  const given = randomUUID();
  const second = await s.request(api('namespaces'), { method: 'POST', body: { namespace: given, label: 'Other', authorPublicKey: multibase() } });
  assert.equal((await json(second)).namespace, given);
  assert.equal((await s.request(api('namespaces'), { method: 'POST', body: { namespace: given, label: 'Dup', authorPublicKey: multibase() } })).status, 409);

  const list = await json(await s.request(api('namespaces')));
  assert.equal(list.namespaces.length, 2);
  assert.deepEqual([list.namespaces[0].devices, list.namespaces[0].records], [0, 0]);

  const detail = await json(await s.request(api(`namespaces/${ns.namespace}`)));
  assert.deepEqual([detail.label, detail.agent, detail.devices, detail.records], ['Nik demo', null, [], []]);

  const patched = await s.request(api(`namespaces/${ns.namespace}`), { method: 'PATCH', body: { label: 'Renamed', status: 'suspended' } });
  assert.equal(patched.status, 200);
  assert.deepEqual([(await json(patched)).label, (await json(await s.request(api(`namespaces/${ns.namespace}`)))).status], ['Renamed', 'suspended']);
  const onlyStatus = await json(await s.request(api(`namespaces/${ns.namespace}`), { method: 'PATCH', body: { status: 'active' } }));
  assert.deepEqual([onlyStatus.label, onlyStatus.status], ['Renamed', 'active']);
});

test('namespaces: validation', async (t) => {
  const s = await start(); t.after(s.close);
  const post = (body) => s.request(api('namespaces'), { method: 'POST', body });
  const key = multibase();
  assert.equal((await post({ label: '', authorPublicKey: key })).status, 400);
  assert.equal((await post({ authorPublicKey: key })).status, 400);
  assert.equal((await post({ label: 'x', authorPublicKey: 'nope' })).status, 400);
  assert.equal((await post({ label: 'x' })).status, 400);
  assert.equal((await post({ label: 'x', authorPublicKey: key, namespace: 'not-a-uuid' })).status, 400);
  assert.equal((await post({ label: 'x', authorPublicKey: key, extra: 1 })).status, 400);
  assert.equal((await s.request(api('namespaces'), { method: 'POST', raw: '{' })).status, 400);

  const ns = (await json(await post({ label: 'x', authorPublicKey: key }))).namespace;
  const patch = (body) => s.request(api(`namespaces/${ns}`), { method: 'PATCH', body });
  assert.equal((await patch({})).status, 400);
  assert.equal((await patch({ status: 'deleted' })).status, 400);
  assert.equal((await patch({ label: ' ' })).status, 400);
  const keyChange = await patch({ authorPublicKey: multibase() });
  assert.equal(keyChange.status, 400);
  assert.equal((await json(keyChange)).error, 'unknown-field');
  assert.equal((await s.request(api(`namespaces/${randomUUID()}`), { method: 'PATCH', body: { label: 'y' } })).status, 404);
  assert.equal((await s.request(api(`namespaces/${randomUUID()}`))).status, 404);
  assert.equal((await s.request(api('namespaces/not-a-uuid'))).status, 400);
  assert.equal((await s.request(api(`namespaces/${ns}`), { method: 'DELETE' })).status, 405);
});

test('agent: created on first save, new version on change, nothing on identical save', async (t) => {
  const s = await start(); t.after(s.close);
  const ns = (await json(await s.request(api('namespaces'), { method: 'POST', body: { label: 'x', authorPublicKey: multibase() } }))).namespace;
  const put = (body) => s.request(api(`namespaces/${ns}/agent`), { method: 'PUT', body });

  const first = await put({ name: 'Nik Jenzer', email: 'nik@example.com' });
  assert.equal(first.status, 201);
  const created = await json(first);
  assert.equal(created.changed, true);
  const agentId = s.store.namespaces.get(ns).agentRecordId;
  assert.ok(agentId);
  assert.equal(created.did, makeDid(ns, agentId));
  const stored = s.store.records.get(`${ns}/${agentId}`);
  assert.equal(stored.versions.length, 1);
  assert.deepEqual(stored.versions[0].parents, []);
  assert.deepEqual(stored.metadata, { core: { recordType: TYPE_AGENT }, extensions: [] });

  const same = await put({ name: 'Nik Jenzer', email: 'nik@example.com' });
  assert.equal(same.status, 200);
  assert.equal((await json(same)).changed, false);
  assert.equal(stored.versions.length, 1);

  const changed = await put({ name: 'Nik J.', email: 'nik@example.com' });
  assert.equal(changed.status, 200);
  assert.equal(stored.versions.length, 2);
  assert.deepEqual(stored.versions[1].parents, [stored.versions[0].versionHash]);
  assert.equal(s.store.namespaces.get(ns).agentRecordId, agentId);

  const detail = await json(await s.request(api(`namespaces/${ns}`)));
  assert.deepEqual([detail.agent.name, detail.agent.email, detail.agent.did], ['Nik J.', 'nik@example.com', makeDid(ns, agentId)]);
  assert.deepEqual(detail.records, [makeDid(ns, agentId)]);
  const list = await json(await s.request(api('namespaces')));
  assert.deepEqual([list.namespaces[0].agentRecordId, list.namespaces[0].records], [agentId, 1]);
});

test('agent: validation', async (t) => {
  const s = await start(); t.after(s.close);
  const ns = (await json(await s.request(api('namespaces'), { method: 'POST', body: { label: 'x', authorPublicKey: multibase() } }))).namespace;
  const put = (body, target = ns) => s.request(api(`namespaces/${target}/agent`), { method: 'PUT', body });
  assert.equal((await put({ name: '', email: 'a@b.ch' })).status, 400);
  assert.equal((await put({ name: 'x', email: 'not-an-email' })).status, 400);
  assert.equal((await put({ name: 'x' })).status, 400);
  assert.equal((await put({ name: 'x', email: 'a@b.ch', extra: 1 })).status, 400);
  assert.equal((await put({ name: 'x'.repeat(201), email: 'a@b.ch' })).status, 400);
  assert.equal((await put({ name: 'x', email: 'a@b.ch' }, randomUUID())).status, 404);
  assert.equal(s.store.namespaces.get(ns).agentRecordId, null);
  assert.equal(s.store.records.size, 0);
});

test('devices: register, list, revoke', async (t) => {
  const s = await start(); t.after(s.close);
  const ns = (await json(await s.request(api('namespaces'), { method: 'POST', body: { label: 'x', authorPublicKey: multibase() } }))).namespace;
  const x = deviceX();
  const register = (body, target = ns) => s.request(api(`namespaces/${target}/devices`), { method: 'POST', body });

  const created = await register({ label: 'Laptop', publicKey: x });
  assert.equal(created.status, 201);
  const device = await json(created);
  assert.deepEqual([device.id, device.label, device.revokedAt], [1, 'Laptop', null]);
  assert.equal(device.jkt, jwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x }));

  assert.equal((await register({ label: 'Again', publicKey: x })).status, 409);
  assert.equal((await register({ label: 'Bad', publicKey: 'AAAA' })).status, 400);
  assert.equal((await register({ label: '', publicKey: deviceX() })).status, 400);
  assert.equal((await register({ label: 'Phone', publicKey: deviceX() }, randomUUID())).status, 404);

  const revoked = await s.request(api('devices/1/revoke'), { method: 'POST' });
  assert.equal(revoked.status, 200);
  assert.ok((await json(revoked)).revokedAt);
  assert.equal((await s.request(api('devices/1/revoke'), { method: 'POST' })).status, 200);
  assert.equal((await s.request(api('devices/99/revoke'), { method: 'POST' })).status, 404);
  assert.equal((await s.request(api('devices/abc/revoke'), { method: 'POST' })).status, 400);

  const detail = await json(await s.request(api(`namespaces/${ns}`)));
  assert.equal(detail.devices.length, 1);
  assert.ok(detail.devices[0].revokedAt);
});

test('the record list shows only DIDs', async (t) => {
  const s = await start(); t.after(s.close);
  const ns = (await json(await s.request(api('namespaces'), { method: 'POST', body: { label: 'x', authorPublicKey: multibase() } }))).namespace;
  const a = randomUUID();
  const b = randomUUID();
  for (const id of [a, b]) {
    const { version, bytes } = buildAgentVersion({ name: 'n', email: 'a@b.ch', parents: [] });
    await s.store.insertVersion(ns, id, version, [{ fileHash: 'f'.repeat(64), size: bytes.length }]);
  }
  const detail = await json(await s.request(api(`namespaces/${ns}`)));
  assert.deepEqual(detail.records, [makeDid(ns, a), makeDid(ns, b)]);
  assert.ok(detail.records.every((r) => typeof r === 'string'));
});