import { timingSafeEqual } from 'node:crypto';
import {
  CoreError, validateVersion, wouldCreateCycle, isUuidV4, isHash, makeDid, parseDid,
  encodeBase64, sha256Hex,
} from '../core/index.js';
import { buildDidDocument } from './didDocument.js';

// Structurally valid requests that the custodian does not accept (Binding 6.2: 422).
const UNPROCESSABLE = new Set([
  'content-hash-mismatch', 'version-hash-mismatch', 'cycle', 'ref-not-supported', 'invalid-state',
]);

const SECURITY_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
const IMMUTABLE_PRIVATE = 'private, max-age=31536000, immutable';

class HttpError extends Error {
  constructor(status, error, detail = '', extra = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...(detail ? { detail } : {}), ...extra };
  }
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function coreToHttp(err) {
  if (!(err instanceof CoreError)) return err;
  return new HttpError(UNPROCESSABLE.has(err.code) ? 422 : 400, err.code, err.detail);
}

async function readBody(req, maxBytes) {
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) throw new HttpError(413, 'payload-too-large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'payload-too-large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function isAuthorized(req, devToken) {
  if (!devToken) return false;
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!match) return false;
  const a = Buffer.from(sha256Hex(match[1]), 'hex');
  const b = Buffer.from(sha256Hex(devToken), 'hex');
  return timingSafeEqual(a, b);
}

// Dependencies are injected: `store` (database), `blobs` (file store), `config`.
export function createApp({ store, blobs, config }) {
  const recordUrl = (ns, rec) => `${config.publicBaseUrl}/records/${ns}/${rec}`;

  // Common checks for all /records/... routes.
  async function authorizeRecordRoute(req, ns, rec) {
    if (!isAuthorized(req, config.devToken)) throw new HttpError(401, 'unauthorized');
    if (!isUuidV4(ns)) throw new HttpError(400, 'invalid-namespace');
    if (!isUuidV4(rec)) throw new HttpError(400, 'invalid-record-id');
    const namespace = await store.getNamespace(ns);
    if (!namespace || namespace.status !== 'active') throw new HttpError(403, 'unknown-namespace');
  }

  async function health(res) {
    try {
      await store.ping();
      sendJson(res, 200, { status: 'ok', service: 'openrwp', db: 'ok', core: 'ok' });
    } catch (err) {
      console.error('health check failed:', err.message);
      sendJson(res, 503, { status: 'error', service: 'openrwp', db: 'error' });
    }
  }

  async function resolveDid(res, did) {
    let parsed;
    try {
      parsed = parseDid(did);
    } catch (err) {
      if (err instanceof CoreError) throw new HttpError(400, 'invalid-did', err.code);
      throw err;
    }
    // Hash segments of the DID do not change the identity (RWP 4.2.3); they are ignored here.
    const { namespace: ns, recordId: rec } = parsed;
    const namespace = await store.getNamespace(ns);
    const record = namespace ? await store.getRecord(ns, rec) : null;
    if (!record) throw new HttpError(404, 'unknown-did');
    const currentVersion = await store.currentVersion(ns, rec);
    const doc = buildDidDocument({
      did: makeDid(ns, rec),
      publicBaseUrl: config.publicBaseUrl,
      namespace,
      record,
      currentVersion,
    });
    sendJson(res, 200, doc, { 'Content-Type': 'application/did+ld+json', 'Cache-Control': 'no-cache' });
  }

  async function appendVersion(req, res, ns, rec) {
    const raw = await readBody(req, config.maxBodyBytes);
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpError(400, 'malformed-json');
    }

    let fileBytes;
    try {
      fileBytes = validateVersion(body, { allowedStates: ['draft'] });
    } catch (err) {
      throw coreToHttp(err);
    }

    const { versionHash, parents } = body;
    const result = { did: makeDid(ns, rec), versionHash, recordEndpoint: recordUrl(ns, rec) };
    const location = { Location: `${recordUrl(ns, rec)}/versions/${versionHash}` };

    if (await store.getVersion(ns, rec, versionHash)) {
      return sendJson(res, 200, result, location);
    }

    const record = await store.getRecord(ns, rec);
    const graph = record ? await store.listVersionGraph(ns, rec) : [];
    const known = new Set(graph.map((v) => v.versionHash));
    if (!record && parents.length > 0) {
      throw new HttpError(409, 'unknown-parent', 'record does not exist yet', { versionHash: parents[0] });
    }
    if (record && parents.length === 0) {
      throw new HttpError(409, 'root-exists', 'the record already has a root version');
    }
    for (const parent of parents) {
      if (!known.has(parent)) throw new HttpError(409, 'unknown-parent', '', { versionHash: parent });
    }
    if (wouldCreateCycle(graph, { versionHash, parents })) throw new HttpError(422, 'cycle');

    const stored = [];
    for (const bytes of fileBytes) stored.push(await blobs.put(bytes));
    const outcome = await store.insertVersion(ns, rec, body, stored);
    sendJson(res, outcome === 'created' ? 201 : 200, result, location);
  }

  async function loadVersion(ns, rec, hash) {
    if (!isHash(hash)) throw new HttpError(400, 'invalid-hash', 'versionHash');
    const version = await store.getVersion(ns, rec, hash);
    if (!version) throw new HttpError(404, 'not-found');
    return version;
  }

  async function readVersion(res, ns, rec, hash) {
    const version = await loadVersion(ns, rec, hash);
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
    sendJson(res, 200, out, { 'Cache-Control': IMMUTABLE_PRIVATE });
  }

  async function readContent(res, ns, rec, hash) {
    const version = await loadVersion(ns, rec, hash);
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
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method;
    const only = (allowed) => {
      if (method !== allowed) throw new HttpError(405, 'method-not-allowed');
    };

    if (seg[0] === 'health' && seg.length === 1) {
      only('GET');
      return health(res);
    }
    if (seg[0] === 'did' && seg.length === 2) {
      only('GET');
      return resolveDid(res, seg[1]);
    }
    if (seg[0] === 'records' && seg[3] === 'versions') {
      const [, ns, rec, , hash, tail] = seg;
      if (seg.length === 4) {
        only('POST');
        await authorizeRecordRoute(req, ns, rec);
        return appendVersion(req, res, ns, rec);
      }
      if (seg.length === 5) {
        only('GET');
        await authorizeRecordRoute(req, ns, rec);
        return readVersion(res, ns, rec, hash);
      }
      if (seg.length === 6 && tail === 'content') {
        only('GET');
        await authorizeRecordRoute(req, ns, rec);
        return readContent(res, ns, rec, hash);
      }
    }
    throw new HttpError(404, 'not-found');
  }

  return async function handle(req, res) {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, err.body);
      if (err instanceof URIError) return sendJson(res, 400, { error: 'malformed-url' });
      console.error('unhandled error:', err);
      sendJson(res, 500, { error: 'internal-error' });
    }
  };
}