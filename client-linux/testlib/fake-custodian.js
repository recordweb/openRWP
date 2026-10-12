import { heads, unreachableFrom, validateVersion } from '../../core/index.js';
import { startFakeServer } from './fake-server.js';

const ROUTE = /^\/records\/([^/]+)\/([^/]+)\/(versions|sync)$/;
const withoutContent = ({ representations, ...rest }) => ({
  ...rest,
  representations: representations.map(({ content, ...r }) => r),
});

// Fake server with a small in-memory custodian: validates versions with core, keeps the graph, answers sync.
// `fake.records` maps "namespace/record" to a Map(versionHash -> version); `fake.seed` adds a version directly.
export async function startFakeCustodian(options) {
  const fake = await startFakeServer(options);
  fake.records = new Map();
  fake.seed = (namespace, recordId, version) => {
    const key = `${namespace}/${recordId}`;
    if (!fake.records.has(key)) fake.records.set(key, new Map());
    fake.records.get(key).set(version.versionHash, version);
  };

  fake.handler = ({ method, path, json }) => {
    const match = ROUTE.exec(path);
    if (!match || method !== 'POST') return { status: 404, json: { error: 'not-found' } };
    const [, namespace, recordId, operation] = match;
    const store = fake.records.get(`${namespace}/${recordId}`);

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