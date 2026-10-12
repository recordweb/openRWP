import { unreachableFrom, heads, isHash, encodeBase64 } from '../core/index.js';
import { HttpError, SECURITY_HEADERS, IMMUTABLE_PRIVATE, sendJson } from './http.js';

// Metadata of a version (no file content), as used in sync and overview responses.
function toMeta(v) {
  const out = {
    versionHash: v.versionHash,
    state: v.state,
    parents: v.parents,
    createdAt: v.createdAtRaw,
    modifiedAt: v.modifiedAtRaw,
    representations: v.representations.map((r) => ({
      format: r.format, contentHash: r.contentHash, primary: r.primary, ...(r.role !== null ? { role: r.role } : {}),
    })),
  };
  if (v.signature) out.signature = v.signature;
  return out;
}

// Read side shared by the authenticated routes, the record endpoint and the capability URLs.
export function createVersionReader({ store, blobs }) {
  async function load(ns, rec, hash) {
    if (!isHash(hash)) throw new HttpError(400, 'invalid-hash', 'versionHash');
    const version = await store.getVersion(ns, rec, hash);
    if (!version) throw new HttpError(404, 'not-found');
    return version;
  }

  // A stored version as the JSON object RWP defines, with the inline content of every representation.
  async function toJson(version) {
    const representations = [];
    for (const r of version.representations) {
      const bytes = await blobs.get(r.fileHash);
      if (!bytes) throw new HttpError(500, 'blob-missing', r.fileHash);
      const rep = { format: r.format, content: encodeBase64(bytes), contentHash: r.contentHash, primary: r.primary };
      if (r.role !== null) rep.role = r.role;
      representations.push(rep);
    }
    const out = {
      versionHash: version.versionHash,
      state: version.state,
      parents: version.parents,
      createdAt: version.createdAtRaw,
      modifiedAt: version.modifiedAtRaw,
      representations,
    };
    if (version.signature) out.signature = version.signature;
    return out;
  }

  return {
    // Versions the client lacks (metadata only) plus ALL current heads (Binding 6.3).
    // `have` empty returns the complete graph.
    async syncDocument(ns, rec, have) {
      const all = await store.listVersions(ns, rec);
      const stateOf = new Map(all.map((v) => [v.versionHash, v.state]));
      return {
        versions: unreachableFrom(all, have).map(toMeta),
        heads: heads(all).map((h) => ({ versionHash: h, state: stateOf.get(h) })),
      };
    },

    // Every version of a record as JSON (unordered); used for the payload of the Record.
    async allVersionsJson(ns, rec) {
      const out = [];
      for (const meta of await store.listVersions(ns, rec)) {
        out.push(await toJson(await store.getVersion(ns, rec, meta.versionHash)));
      }
      return out;
    },

    async sendVersion(res, ns, rec, hash, headers = {}) {
      const version = await load(ns, rec, hash);
      sendJson(res, 200, await toJson(version), { 'Cache-Control': IMMUTABLE_PRIVATE, ...headers });
    },

    // The raw file of the primary representation.
    async sendContent(res, ns, rec, hash) {
      const version = await load(ns, rec, hash);
      const primary = version.representations.find((r) => r.primary);
      const bytes = primary ? await blobs.get(primary.fileHash) : null;
      if (!bytes) throw new HttpError(500, 'blob-missing');
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': primary.format,
        'Content-Length': bytes.length,
        'Content-Disposition': 'inline',
        'Cache-Control': IMMUTABLE_PRIVATE,
      });
      res.end(bytes);
    },
  };
}