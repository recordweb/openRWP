import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { adminJs } from '../adminUi.js';

// A very small DOM stand-in: enough to run the admin script and look at what it builds.
class TextNode {
  constructor(text) { this.textContent = text; }
}
class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; this.value = '';
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(value) { this.children = [new TextNode(String(value))]; }
  find(predicate, out = []) {
    if (predicate(this)) out.push(this);
    for (const child of this.children) if (child instanceof El) child.find(predicate, out);
    return out;
  }
}

const NS = '4d3c45e8-1785-4f52-90f7-b9f5811935ad';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const button = (app, text) => app.find((n) => n.tag === 'button' && n.textContent === text)[0];
const inputs = (app) => app.find((n) => n.tag === 'input');

function start(routes, hash = '') {
  const calls = [];
  const app = new El('main');
  const listeners = {};
  const sandbox = {
    document: {
      getElementById: () => app,
      createElement: (tag) => new El(tag),
      createTextNode: (text) => new TextNode(text),
    },
    window: { addEventListener: (type, fn) => { listeners[type] = fn; }, confirm: () => true },
    location: { hash },
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method ?? 'GET', headers: options.headers ?? {}, body: options.body });
      const reply = routes[`${options.method ?? 'GET'} ${url}`];
      if (reply === undefined) return { ok: false, status: 404, json: async () => ({ error: 'not-found', detail: 'no such route' }) };
      return { ok: true, status: 200, json: async () => reply };
    },
  };
  vm.runInNewContext(adminJs, sandbox);
  const navigate = async (to) => { sandbox.location.hash = to; listeners.hashchange(); await settle(); };
  return { app, calls, navigate };
}

const LIST = {
  namespaces: [{ namespace: NS, label: 'Nik demo', status: 'active', agentRecordId: null, devices: 1, records: 3 }],
};
const DETAIL = {
  namespace: NS,
  label: 'Nik demo',
  status: 'active',
  authorPublicKey: 'z6MkpdLK5QZdFDyZbnZGSUrKnRta68KEfoBwNbjS3fNmV9qc',
  createdAt: '2026-10-10T14:00:00.000Z',
  agent: null,
  devices: [{ id: 1, label: 'Laptop', jkt: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-10-10T14:00:00.000Z', revokedAt: null }],
  records: [`did:rwp:${NS}:28b91a20-f7cd-456b-a290-5d7088fdba74`],
};

test('the list view shows the namespaces', async () => {
  const { app } = start({ 'GET api/namespaces': LIST });
  await settle();
  const text = app.textContent;
  assert.ok(text.includes('Nik demo') && text.includes(NS) && text.includes('active'));
  const link = app.find((n) => n.tag === 'a')[0];
  assert.equal(link.attrs.href, `#/ns/${NS}`);
});

test('the detail view shows devices and the record list (DIDs only)', async () => {
  const { app, navigate } = start({ 'GET api/namespaces': LIST, [`GET api/namespaces/${NS}`]: DETAIL });
  await navigate(`#/ns/${NS}`);
  const text = app.textContent;
  assert.ok(text.includes('Laptop') && text.includes('abcdefghijkl...'));
  assert.ok(text.includes(`did:rwp:${NS}:28b91a20-f7cd-456b-a290-5d7088fdba74`));
  assert.ok(text.includes('No AgentRecord yet'));
  assert.ok(button(app, 'Revoke') && button(app, 'Suspend') && button(app, 'Save agent'));
});

test('buttons call the API with the CSRF header', async () => {
  const routes = {
    'GET api/namespaces': LIST,
    [`GET api/namespaces/${NS}`]: DETAIL,
    'POST api/devices/1/revoke': { id: 1 },
    [`PUT api/namespaces/${NS}/agent`]: { changed: true },
    [`PATCH api/namespaces/${NS}`]: { label: 'x' },
  };
  const { app, calls, navigate } = start(routes);
  await navigate(`#/ns/${NS}`);

  await button(app, 'Revoke').listeners.click[0]();
  const revoke = calls.find((c) => c.method === 'POST');
  assert.equal(revoke.url, 'api/devices/1/revoke');
  assert.equal(revoke.headers['X-Requested-With'], 'fetch');

  const [, name, email] = inputs(app);
  name.value = 'Nik Jenzer';
  email.value = 'nik@example.com';
  await button(app, 'Save agent').listeners.click[0]();
  const agent = calls.find((c) => c.method === 'PUT');
  assert.deepEqual(JSON.parse(agent.body), { name: 'Nik Jenzer', email: 'nik@example.com' });
  assert.equal(agent.headers['Content-Type'], 'application/json');

  await button(app, 'Suspend').listeners.click[0]();
  const status = calls.filter((c) => c.method === 'PATCH').at(-1);
  assert.deepEqual(JSON.parse(status.body), { status: 'suspended' });
});

test('API errors are shown in the notice', async () => {
  const { app, navigate } = start({ 'GET api/namespaces': LIST, [`GET api/namespaces/${NS}`]: DETAIL });
  await navigate(`#/ns/${NS}`);
  await button(app, 'Save label').listeners.click[0]();
  const notice = app.find((n) => String(n.className).includes('notice'))[0];
  assert.ok(notice.className.includes('error'));
  assert.ok(notice.textContent.includes('not-found'));
});

test('labels are rendered as text, never as HTML', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const list = { namespaces: [{ ...LIST.namespaces[0], label: evil }] };
  const { app } = start({ 'GET api/namespaces': list });
  await settle();
  assert.ok(app.textContent.includes(evil));
  assert.equal(app.find((n) => n.tag === 'img').length, 0);
});