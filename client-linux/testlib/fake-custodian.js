import { randomBytes, randomUUID } from 'node:crypto';
import { heads, unreachableFrom, validateVersion } from '../../core/index.js';
import { startFakeServer } from './fake-server.js';

const ROUTE = /^\/records\/([^/]+)\/([^/]+)\/(versions|sync|settings)$/;
const ENTRY_FIELDS = new Set(['id', 'agent', 'modes', 'scope', 'expires']);
const DAY_MS = 86_400_000;
const NOT_FOUND = { status: 404, json: { error: 'not-found' } };

const withoutContent = ({ representations, ...rest }) => ({
  ...rest,
  representations: representations.map(({ content, ...r }) => r),
});

// Fake server with a small in-memory custodian: versions (validated with core), sync and capability-link settings.
// `fake.records`: "namespace/record" -> Map(versionHash -> version). `fake.seed` adds a version directly.
// `fake.links`: "namespace/record" -> links (with their secret token). `fake.revoked`: ids of revoked links.
export async function startFakeCustodian(options) {
  const fake = await startFakeServer(options);
  fake.records = new Map();
  fake.links = new Map();
  fake.revoked = [];
  fake.seed = (namespace, recordId, version) => {
    const key = `${namespace}/${recordId}`;
    if (!fake.records.has(key)) fake.records.set(key, new Map());
    fake.records.get(key).set(version.versionHash, version);
  };

  const publicEntry = ({ token, ...rest }) => ({ ...rest, created: '2026-10-10T00:00:00Z' });

  function settings(method, key, json) {
    const current = fake.links.get(key) ?? [];
    if (method === 'GET') return { json: { access: current.map(publicEntry), views: [] } };
    if (method !== 'PUT') return NOT_FOUND;
    if (!Array.isArray(json?.access) || (json.views ?? []).length > 0) {
      return { status: 422, json: { error: 'unsupported' } };
    }
    const next = [];
    const created = new Set();
    for (const entry of json.access) {
      if (Object.keys(entry).some((k) => !ENTRY_FIELDS.has(k))) return { status: 400, json: { error: 'invalid-request' } };
      if (entry.id !== undefined) {
        const known = current.find((l) => l.id === entry.id);
        if (!known) return { status: 404, json: { error: 'unknown-link' } };
        next.push({ ...known, expires: entry.expires ?? known.expires });
        continue;
      }
      const modesOk = Array.isArray(entry.modes) && entry.modes.length === 1 && entry.modes[0] === 'read';
      if (entry.agent !== 'link' || !modesOk || (entry.scope !== undefined && entry.scope !== 'record')) {
        return { status: 422, json: { error: 'unsupported' } };
      }
      const expires = entry.expires ?? new Date(Date.now() + 7 * DAY_MS).toISOString();
      if (Date.parse(expires) > Date.now() + 30 * DAY_MS) return { status: 422, json: { error: 'invalid-expiry' } };
      const link = {
        id: randomUUID(), agent: 'link', modes: ['read'], scope: 'record', expires, token: randomBytes(32).toString('base64url'),
      };
      created.add(link.id);
      next.push(link);
    }
    for (const old of current) if (!next.some((l) => l.id === old.id)) fake.revoked.push(old.id);
    fake.links.set(key, next);
    return {
      json: {
        access: next.map((l) => (created.has(l.id)
          ? { ...publicEntry(l), url: `https://example.org/openrwp/c/${l.token}` }
          : publicEntry(l))),
        views: [],
      },
    };
  }

  fake.handler = ({ method, path, json }) => {
    const match = ROUTE.exec(path);
    if (!match) return NOT_FOUND;
    const [, namespace, recordId, operation] = match;
    const key = `${namespace}/${recordId}`;
    const store = fake.records.get(key);

    if (operation === 'settings') {
      return store ? settings(method, key, json) : { status: 404, json: { error: 'unknown-record' } };
    }
    if (method !== 'POST') return NOT_FOUND;

    if (operation === 'versions') {
      try {
        validateVersion(json, { allowedStates: ['draft'] });
      } catch (err) {
        return { status: 422, json: { error: 'invalid-version', detail: err.message } };
      }
      const result = {
        did: `did:rwp:${namespace}:${recordId}`,
        versionHash: json.versionHash,
        recordEndpoint: `${fake.baseUrl}/records/${namespace}/${recordId}`,
      };
      if (store?.has(json.versionHash)) return { status: 200, json: result };
      if (json.parents.length === 0 && store && store.size > 0) return { status: 409, json: { error: 'root-exists' } };
      const unknown = json.parents.find((p) => !store?.has(p));
      if (unknown) return { status: 409, json: { error: 'unknown-parent', versionHash: unknown } };
      fake.seed(namespace, recordId, json);
      return { status: 201, json: result };
    }

    if (!store) return { status: 404, json: { error: 'unknown-record' } };
    if (!Array.isArray(json?.have)) return { status: 400, json: { error: 'invalid-request' } };
    const all = [...store.values()];
    return {
      json: {
        versions: unreachableFrom(all, json.have).map(withoutContent),
        heads: heads(all).map((h) => ({ versionHash: h, state: store.get(h).state })),
      },
    };
  };
  return fake;
}