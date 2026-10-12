import { CoreError, makeDid, computeRecordHash, orderVersions, defaultMetadata, validateMetadata } from '../core/index.js';
import { HttpError, sendJson, readJsonBody } from './http.js';

// The Record resource (RWP chapter 3): did, payload, metadata, recordHash.
// Metadata is not versioned; it is stored per record and changes only the recordHash.
export function createRecords({ store, reader, config }) {
  const agentDid = (namespace) =>
    (namespace?.agentRecordId ? makeDid(namespace.namespace, namespace.agentRecordId) : undefined);

  // Metadata given to a new record: the configured default record type and the owner (AgentRecord).
  function initialMetadata(namespace) {
    return defaultMetadata({ recordType: config.recordTypeDefault, owner: agentDid(namespace) });
  }

  // Records created before metadata existed get the default (not stored until the first PUT).
  async function metadataOf(ns, rec) {
    return (await store.getMetadata(ns, rec)) ?? initialMetadata(await store.getNamespace(ns));
  }

  async function requireRecord(ns, rec) {
    if (!(await store.getRecord(ns, rec))) throw new HttpError(404, 'not-found');
  }

  return {
    initialMetadata,

    async getRecord(res, ns, rec, headers = {}) {
      await requireRecord(ns, rec);
      const did = makeDid(ns, rec);
      const payload = orderVersions(await reader.allVersionsJson(ns, rec));
      const metadata = await metadataOf(ns, rec);
      sendJson(res, 200, { did, payload, metadata, recordHash: computeRecordHash({ did, payload, metadata }) }, {
        'Cache-Control': 'no-store', ...headers,
      });
    },

    async getMetadata(res, ns, rec, headers = {}) {
      await requireRecord(ns, rec);
      sendJson(res, 200, await metadataOf(ns, rec), { 'Cache-Control': 'no-store', ...headers });
    },

    // Replaces the metadata of the record (RWP 6: metadata may be updated in place).
    async putMetadata(req, res, ns, rec, headers = {}) {
      const body = await readJsonBody(req, config.maxBodyBytes);
      let metadata;
      try {
        metadata = validateMetadata(body);
      } catch (err) {
        if (err instanceof CoreError) throw new HttpError(400, err.code, err.detail);
        throw err;
      }
      await requireRecord(ns, rec);
      await store.putMetadata(ns, rec, metadata);
      sendJson(res, 200, metadata, { 'Cache-Control': 'no-store', ...headers });
    },
  };
}