import {
  CoreError, validateVersion, wouldCreateCycle, isUuidV4, isHash, makeDid, parseDid,
  verifyDpopProof, sha256Hex,
} from '../core/index.js';
import { buildDidDocument } from './didDocument.js';
import { createTokenHandler } from './token.js';
import { createVersionReader } from './versionReader.js';
import { createLinks } from './links.js';
import { HttpError, sendJson, readJsonBody } from './http.js';

// Structurally valid requests that the custodian does not accept (Binding 6.2: 422).
const UNPROCESSABLE = new Set([
  'content-hash-mismatch', 'version-hash-mismatch', 'cycle', 'ref-not-supported', 'invalid-state',
]);
const JTI_TTL_SECONDS = 300; // longer than the accepted proof time window (2 x 60 s)

// 401 with the challenge required by RFC 9449 section 7.1.
function unauthorized(error, description) {
  const params = [];
  if (error !== 'unauthorized') {
    params.push(`error="${error}"`, `error_description="${description.replace(/"/g, "'")}"`);
  }
  params.push('algs="EdDSA"');
  return new HttpError(401, error, description, {}, { 'WWW-Authenticate': `DPoP ${params.join(', ')}` });
}

function coreToHttp(err) {
  if (!(err instanceof CoreError)) return err;
  return new HttpError(UNPROCESSABLE.has(err.code) ? 422 : 400, err.code, err.detail);
}

// Dependencies are injected: `store` (database), `blobs` (file store), `config`.
export function createApp({ store, blobs, config }) {
  const recordUrl = (ns, rec) => `${config.publicBaseUrl}/records/${ns}/${rec}`;
  const handleToken = createTokenHandler({ store, config });
  const reader = createVersionReader({ store, blobs });
  const links = createLinks({ store, reader, config });

  // DPoP-bound access token (RFC 9449 section 7): "Authorization: DPoP <token>" plus a "DPoP" proof.
  // Returns the authenticated device.
  async function authenticate(req) {
    const match = /^DPoP (\S+)$/.exec(req.headers.authorization ?? '');
    if (!match) throw unauthorized('unauthorized', 'a DPoP access token is required');
    const accessToken = match[1];

    const { pathname } = new URL(req.url, 'http://localhost');
    let proof;
    try {
      proof = verifyDpopProof(req.headers.dpop, {
        method: req.method,
        url: `${config.publicBaseUrl}${pathname}`,
        accessToken,
      });
    } catch (err) {
      if (err instanceof CoreError) throw unauthorized('invalid_dpop_proof', err.detail);
      throw err;
    }

    // The token is bound to the Device key: the proof must be signed with that same key.
    const device = await store.getTokenDevice(sha256Hex(accessToken));
    if (!device || device.revokedAt || device.namespaceStatus !== 'active' || device.jkt !== proof.jkt) {
      throw unauthorized('invalid_token', 'unknown, expired or revoked token');
    }
    if (!(await store.recordDpopJti(proof.jkt, proof.jti, JTI_TTL_SECONDS))) {
      throw unauthorized('invalid_dpop_proof', 'jti already used');
    }
    return device;
  }

  // Common checks for all /records/... routes: authenticated, and the namespace is the device's own.
  async function authorizeRecordRoute(req, ns, rec) {
    const device = await authenticate(req);
    if (!isUuidV4(ns)) throw new HttpError(400, 'invalid-namespace');
    if (!isUuidV4(rec)) throw new HttpError(400, 'invalid-record-id');
    if (device.namespace !== ns) throw new HttpError(403, 'forbidden', 'the device does not belong to this namespace');
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
    const body = await readJsonBody(req, config.maxBodyBytes);
    let fileBytes;
    try {
      fileBytes = validateVersion(body, { allowedStates: ['draft'] });
    } catch (err) {
      throw coreToHttp(err);
    }

    const { versionHash, parents } = body;
    const result = { did: makeDid(ns, rec), versionHash, recordEndpoint: recordUrl(ns, rec) };
    const headers = { Location: `${recordUrl(ns, rec)}/versions/${versionHash}`, ...links.settingsLinkHeader(ns, rec) };

    if (await store.getVersion(ns, rec, versionHash)) {
      return sendJson(res, 200, result, headers);
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
    sendJson(res, outcome === 'created' ? 201 : 200, result, headers);
  }

  async function sync(req, res, ns, rec) {
    const body = await readJsonBody(req, config.maxBodyBytes);
    if (body === null || typeof body !== 'object' || !Array.isArray(body.have) || !body.have.every(isHash)) {
      throw new HttpError(400, 'invalid-request', 'have must be an array of version hashes');
    }
    if (!(await store.getRecord(ns, rec))) throw new HttpError(404, 'not-found');
    sendJson(res, 200, await reader.syncDocument(ns, rec, body.have), {
      'Cache-Control': 'no-store',
      ...links.settingsLinkHeader(ns, rec),
    });
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method;
    const only = (...allowed) => {
      if (!allowed.includes(method)) throw new HttpError(405, 'method-not-allowed');
    };

    if (seg[0] === 'health' && seg.length === 1) {
      only('GET');
      return health(res);
    }
    if (seg[0] === 'did' && seg.length === 2) {
      only('GET');
      return resolveDid(res, seg[1]);
    }
    if (seg[0] === 'token' && seg.length === 1) {
      only('POST');
      return handleToken(req, res);
    }
    if (seg[0] === 'c' && seg.length >= 2) {
      return links.handleCapability(req, res, seg);
    }
    if (seg[0] === 'records' && seg.length === 4 && seg[3] === 'sync') {
      const [, ns, rec] = seg;
      only('POST');
      await authorizeRecordRoute(req, ns, rec);
      return sync(req, res, ns, rec);
    }
    if (seg[0] === 'records' && seg.length === 4 && seg[3] === 'settings') {
      const [, ns, rec] = seg;
      only('GET', 'PUT');
      await authorizeRecordRoute(req, ns, rec);
      return method === 'GET' ? links.getSettings(res, ns, rec) : links.putSettings(req, res, ns, rec);
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
        return reader.sendVersion(res, ns, rec, hash, links.settingsLinkHeader(ns, rec));
      }
      if (seg.length === 6 && tail === 'content') {
        only('GET');
        await authorizeRecordRoute(req, ns, rec);
        return reader.sendContent(res, ns, rec, hash);
      }
    }
    throw new HttpError(404, 'not-found');
  }

  return async function handle(req, res) {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, err.body, err.headers);
      if (err instanceof URIError) return sendJson(res, 400, { error: 'malformed-url' });
      console.error('unhandled error:', err);
      sendJson(res, 500, { error: 'internal-error' });
    }
  };
}