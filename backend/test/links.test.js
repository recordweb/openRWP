import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDid } from '../../core/index.js';
import {
  startServer, makeVersion, versionsPath, settingsPath, NS, REC, PUBLIC,
} from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();
const linkEntry = (extra = {}) => ({ agent: 'link', modes: ['read'], scope: 'record', ...extra });
const put = (s, body, opts = {}) => s.request(settingsPath(), { method: 'PUT', body, ...opts });
const pathOf = (url) => new URL(url).pathname.replace('/openrwp', '');

async function seed(s) {
  const root = makeVersion({ content: 'v1 text', createdAt: '2026-10-10T13:00:00Z', format: 'application/vnd.oasis.opendocument.text' });
  const child = makeVersion({ content: 'v2 text', parents: [root.versionHash], createdAt: '2026-10-10T14:00:00Z' });
  for (const v of [root, child]) {
    assert.equal((await s.request(versionsPath(), { method: 'POST', body: v })).status, 201);
  }
  return { root, child };
}

test('settings of an existing record start empty and announce themselves with a Link header', async (t) => {
  const s = await startServer(); t.after(s.close);
  assert.equal((await s.request(settingsPath())).status, 404);
  const { root } = await seed(s);
  const res = await s.request(settingsPath());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { access: [], views: [] });
  assert.equal(res.headers.get('link'), `<${PUBLIC}/records/${NS}/${REC}/settings>; rel="settings"`);
  const v = await s.request(`${versionsPath()}/${root.versionHash}`);
  assert.match(v.headers.get('link'), /rel="settings"/);
});

test('PUT creates a link, returns the URL once and GET lists it without the secret', async (t) => {
  const s = await startServer(); t.after(s.close);
  await seed(s);
  const expires = inDays(2);
  const res = await put(s, { access: [linkEntry({ expires })] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.access.length, 1);
  const [entry] = body.access;
  assert.match(entry.url, /^https:\/\/example\.test\/openrwp\/c\/[A-Za-z0-9_-]{43}$/);
  assert.match(entry.id, /^[0-9a-f-]{36}$/);
  assert.equal(new Date(entry.expires).getTime(), new Date(expires).getTime());
  assert.deepEqual([entry.agent, entry.modes, entry.scope], ['link', ['read'], 'record']);

  const listed = await (await s.request(settingsPath())).json();
  assert.equal(listed.access.length, 1);
  assert.equal(listed.access[0].id, entry.id);
  assert.equal('url' in listed.access[0], false);
  assert.ok(!JSON.stringify([...s.store.links]).includes(entry.url.split('/c/')[1]));
});

test('default expiry is 7 days', async (t) => {
  const s = await startServer(); t.after(s.close);
  await seed(s);
  const [entry] = (await (await put(s, { access: [linkEntry()] })).json()).access;
  const days = (new Date(entry.expires).getTime() - Date.now()) / DAY;
  assert.ok(days > 6.99 && days <= 7);
});

test('the capability URL gives read access to overview, versions and content', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { root, child } = await seed(s);
  const [entry] = (await (await put(s, { access: [linkEntry()] })).json()).access;
  const base = pathOf(entry.url);

  const overview = await s.request(base, { token: null });
  assert.equal(overview.status, 200);
  assert.equal(overview.headers.get('referrer-policy'), 'no-referrer');
  assert.match(overview.headers.get('x-robots-tag'), /noindex/);
  assert.equal(overview.headers.get('cache-control'), 'no-store');
  const doc = await overview.json();
  assert.equal(doc.did, makeDid(NS, REC));
  assert.deepEqual(doc.versions.map((v) => v.versionHash), [root.versionHash, child.versionHash]);
  assert.deepEqual(doc.heads, [{ versionHash: child.versionHash, state: 'draft' }]);
  assert.equal('content' in doc.versions[0].representations[0], false);

  const full = await s.request(`${base}/versions/${root.versionHash}`, { token: null });
  assert.equal(full.status, 200);
  assert.deepEqual(await full.json(), root);

  const content = await s.request(`${base}/versions/${root.versionHash}/content`, { token: null });
  assert.equal(content.status, 200);
  assert.equal(content.headers.get('content-type'), 'application/vnd.oasis.opendocument.text');
  assert.match(content.headers.get('cache-control'), /^private/);
  assert.equal(Buffer.from(await content.arrayBuffer()).toString(), 'v1 text');
});

test('a link is read-only and gives no other access', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { root } = await seed(s);
  const [entry] = (await (await put(s, { access: [linkEntry()] })).json()).access;
  const base = pathOf(entry.url);
  assert.equal((await s.request(base, { method: 'POST', body: {}, token: null })).status, 405);
  assert.equal((await s.request(`${base}/sync`, { token: null })).status, 404);
  assert.equal((await s.request(`${base}/settings`, { token: null })).status, 404);
  assert.equal((await s.request(`${base}/versions/${'0'.repeat(64)}`, { token: null })).status, 404);
  assert.equal((await s.request(`${base}/versions/${root.versionHash}/other`, { token: null })).status, 404);
});

test('unknown, malformed, expired and revoked links all answer the same 404', async (t) => {
  const s = await startServer(); t.after(s.close);
  await seed(s);
  const [entry] = (await (await put(s, { access: [linkEntry()] })).json()).access;
  const base = pathOf(entry.url);
  const answer = async (path) => {
    const res = await s.request(path, { token: null });
    return [res.status, await res.text()];
  };
  const expected = [404, JSON.stringify({ error: 'not-found' })];
  assert.deepEqual(await answer(`/c/${'A'.repeat(43)}`), expected);
  assert.deepEqual(await answer('/c/short'), expected);
  assert.deepEqual(await answer('/c/' + 'é'.repeat(43)), expected);

  assert.equal((await s.request(base, { token: null })).status, 200);
  s.store.links[0].expiresAt = new Date(Date.now() - 1000);
  assert.deepEqual(await answer(base), expected);
  s.store.links[0].expiresAt = new Date(Date.now() + DAY);
  assert.equal((await s.request(base, { token: null })).status, 200);

  s.store.namespaces.get(NS).status = 'suspended';
  assert.deepEqual(await answer(base), expected);
  s.store.namespaces.get(NS).status = 'active';

  assert.equal((await put(s, { access: [] })).status, 200);
  assert.deepEqual(await answer(base), expected);
});

test('PUT replaces the list: kept links stay, missing ones are revoked, expiry can change', async (t) => {
  const s = await startServer(); t.after(s.close);
  await seed(s);
  const created = (await (await put(s, { access: [linkEntry(), linkEntry()] })).json()).access;
  assert.equal(created.length, 2);
  const [first, second] = created;

  const extended = inDays(20);
  const res = await put(s, { access: [linkEntry({ id: first.id, expires: extended })] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.access.length, 1);
  assert.equal(body.access[0].id, first.id);
  assert.equal('url' in body.access[0], false);
  assert.equal(new Date(body.access[0].expires).getTime(), new Date(extended).getTime());

  assert.equal((await s.request(pathOf(first.url), { token: null })).status, 200);
  assert.equal((await s.request(pathOf(second.url), { token: null })).status, 404);

  // keeping an id without sending expires leaves the expiry unchanged
  const again = await (await put(s, { access: [linkEntry({ id: first.id })] })).json();
  assert.equal(new Date(again.access[0].expires).getTime(), new Date(extended).getTime());
});

test('validation: unsupported features and bad input', async (t) => {
  const s = await startServer(); t.after(s.close);
  await seed(s);
  const status = async (body) => (await put(s, body)).status;
  const errorOf = async (body) => (await (await put(s, body)).json()).error;

  assert.equal(await errorOf({ access: [{ agent: 'did:rwp:x', modes: ['read'] }] }), 'agent-not-supported');
  assert.equal(await errorOf({ access: [linkEntry({ modes: ['write'] })] }), 'mode-not-supported');
  assert.equal(await errorOf({ access: [linkEntry({ modes: ['read', 'write'] })] }), 'mode-not-supported');
  assert.equal(await errorOf({ access: [linkEntry({ scope: 'views' })] }), 'scope-not-supported');
  assert.equal(await errorOf({ access: [], views: [{ id: 'summary' }] }), 'views-not-supported');
  assert.equal(await errorOf({ access: [linkEntry({ expires: inDays(-1) })] }), 'invalid-expiry');
  assert.equal(await errorOf({ access: [linkEntry({ expires: inDays(31) })] }), 'invalid-expiry');
  assert.equal(await errorOf({ access: [linkEntry({ expires: 'tomorrow' })] }), 'invalid-expiry');
  assert.equal(await errorOf({ access: [linkEntry({ id: '9f1c2a3b-4d5e-4f60-8a7b-0c1d2e3f4a5b' })] }), 'unknown-link');
  assert.equal(await status({ access: [linkEntry({ extra: 1 })] }), 400);
  assert.equal(await status({ access: [{ agent: 'link' }] }), 400);
  assert.equal(await status({ access: 'link' }), 400);
  assert.equal(await status({}), 400);
  assert.equal(await status({ access: [], other: 1 }), 400);
  assert.equal((await s.request(settingsPath(), { method: 'PUT', raw: '{nope' })).status, 400);
  assert.equal(s.store.links.length, 0);
});

test('settings require authentication and the own namespace; links need https', async (t) => {
  const s = await startServer(); t.after(s.close);
  await seed(s);
  assert.equal((await s.request(settingsPath(), { token: null })).status, 401);
  assert.equal((await put(s, { access: [] }, { token: null })).status, 401);
  const other = '11111111-1111-4111-8111-111111111111';
  assert.equal((await s.request(settingsPath(other))).status, 403);
  assert.equal((await s.request(settingsPath(), { method: 'DELETE' })).status, 405);

  const plain = await startServer({ publicBaseUrl: 'http://example.test/openrwp' }); t.after(plain.close);
  await seed(plain);
  const res = await put(plain, { access: [linkEntry()] });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'configuration-error');
});