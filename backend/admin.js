import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  CoreError, isUuidV4, makeDid, heads, defaultMetadata, multibaseToPublicKey,
  isEd25519PublicJwk, jwkThumbprint,
} from '../core/index.js';
import { HttpError, SECURITY_HEADERS, sendJson, readJsonBody } from './http.js';
import { verifyPassword } from './adminAuth.js';
import { buildAgentVersion } from './agentRecord.js';
import { adminHtml, adminJs, adminCss } from './adminUi.js';

// Minimal admin area: /admin/ (page) and /admin/api/... (JSON). HTTP Basic login with a password hash
// from the environment. Without ADMIN_USER and ADMIN_PASSWORD_HASH the whole area answers 404.
//
// Store methods used: listNamespaces, createNamespace, getNamespace, updateNamespace, setAgentRecordId,
// listDevices, createDevice, revokeDevice, listRecordIds, listVersions, getVersion, insertVersion.

const MAX_BODY = 64 * 1024;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; "
  + "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ADMIN_HEADERS = { 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const digest = (s) => createHash('sha256').update(String(s)).digest();
const sameString = (a, b) => timingSafeEqual(digest(a), digest(b));

function parseBasic(header) {
  const match = /^Basic (.+)$/.exec(header ?? '');
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon < 0 ? null : { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

const namespaceJson = (n) => ({
  namespace: n.namespace,
  label: n.label,
  status: n.status,
  authorPublicKey: n.authorPublicKey,
  agentRecordId: n.agentRecordId,
  createdAt: iso(n.createdAt),
});

const deviceJson = (d) => ({
  id: d.id, label: d.label, jkt: d.jkt, createdAt: iso(d.createdAt), revokedAt: iso(d.revokedAt),
});

function checkKeys(body, allowed) {
  if (!isObject(body)) throw new HttpError(400, 'invalid-request', 'a JSON object is required');
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new HttpError(400, 'unknown-field', key);
  }
}

function requireText(value, field, max = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '' || text.length > max) throw new HttpError(400, 'invalid-request', `${field} must be 1 to ${max} characters`);
  return text;
}

export function createAdmin({ store, blobs, config }) {
  let failures = [];

  // HTTP Basic. Wrong credentials are counted; too many in a window lock the area for everybody (429).
  function authenticate(req) {
    const now = Date.now();
    failures = failures.filter((t) => now - t < FAILURE_WINDOW_MS);
    if (failures.length >= MAX_FAILURES) {
      throw new HttpError(429, 'too-many-attempts', '', {}, { 'Retry-After': '600' });
    }
    const challenge = { 'WWW-Authenticate': 'Basic realm="OpenRWP admin", charset="UTF-8"' };
    const credentials = parseBasic(req.headers.authorization);
    if (!credentials) throw new HttpError(401, 'unauthorized', '', {}, challenge);
    const userOk = sameString(credentials.user, config.adminUser);
    const passwordOk = verifyPassword(credentials.password, config.adminPasswordHash);
    if (!(userOk && passwordOk)) {
      failures.push(now);
      throw new HttpError(401, 'unauthorized', '', {}, challenge);
    }
  }

  async function requireNamespace(ns) {
    const namespace = await store.getNamespace(ns);
    if (!namespace) throw new HttpError(404, 'unknown-namespace');
    return namespace;
  }

  // The newest head among the versions of a record.
  function newestHead(versions) {
    const headSet = new Set(heads(versions));
    return versions
      .filter((v) => headSet.has(v.versionHash))
      .sort((a, b) => Date.parse(b.createdAtRaw) - Date.parse(a.createdAtRaw))[0] ?? null;
  }

  async function readAgent(namespace) {
    if (!namespace.agentRecordId) return null;
    const { namespace: ns, agentRecordId: rec } = namespace;
    const head = newestHead(await store.listVersions(ns, rec));
    if (!head) return null;
    const version = await store.getVersion(ns, rec, head.versionHash);
    const primary = version.representations.find((r) => r.primary);
    let content = {};
    try {
      content = JSON.parse((await blobs.get(primary.fileHash)).toString('utf8'));
    } catch {
      content = {};
    }
    return {
      did: makeDid(ns, rec), versionHash: head.versionHash, name: content.name ?? '', email: content.email ?? '',
    };
  }

  async function listNamespaces(res) {
    const rows = await store.listNamespaces();
    sendJson(res, 200, {
      namespaces: rows.map((n) => ({ ...namespaceJson(n), devices: n.devices, records: n.records })),
    }, ADMIN_HEADERS);
  }

  async function createNamespace(req, res) {
    const body = await readJsonBody(req, MAX_BODY);
    checkKeys(body, ['namespace', 'label', 'authorPublicKey']);
    const label = requireText(body.label, 'label');
    try {
      multibaseToPublicKey(body.authorPublicKey);
    } catch (err) {
      if (err instanceof CoreError) throw new HttpError(400, 'invalid-key', err.detail);
      throw err;
    }
    if (body.namespace !== undefined && !isUuidV4(body.namespace)) throw new HttpError(400, 'invalid-namespace');
    const namespace = body.namespace ?? randomUUID();
    const result = await store.createNamespace({ namespace, label, authorPublicKey: body.authorPublicKey });
    if (result === 'exists') throw new HttpError(409, 'namespace-exists');
    sendJson(res, 201, namespaceJson(await store.getNamespace(namespace)), ADMIN_HEADERS);
  }

  async function namespaceDetail(res, ns) {
    const namespace = await requireNamespace(ns);
    const [devices, recordIds, agent] = await Promise.all([
      store.listDevices(ns), store.listRecordIds(ns, 1000), readAgent(namespace),
    ]);
    sendJson(res, 200, {
      ...namespaceJson(namespace),
      agent,
      devices: devices.map(deviceJson),
      records: recordIds.map((id) => makeDid(ns, id)),
    }, ADMIN_HEADERS);
  }

  // Label and status only. The author key cannot change: RWP 4.3 lets only the storage location of a
  // DID document change.
  async function patchNamespace(req, res, ns) {
    const body = await readJsonBody(req, MAX_BODY);
    checkKeys(body, ['label', 'status']);
    if (body.label === undefined && body.status === undefined) {
      throw new HttpError(400, 'invalid-request', 'nothing to change');
    }
    const label = body.label === undefined ? null : requireText(body.label, 'label');
    if (body.status !== undefined && body.status !== 'active' && body.status !== 'suspended') {
      throw new HttpError(400, 'invalid-request', 'status must be active or suspended');
    }
    const updated = await store.updateNamespace(ns, { label, status: body.status ?? null });
    if (!updated) throw new HttpError(404, 'unknown-namespace');
    sendJson(res, 200, namespaceJson(updated), ADMIN_HEADERS);
  }

  // Creates the AgentRecord of the namespace owner on first save (a Record in the person's own namespace,
  // no connection to the hoster); later saves append a new version.
  async function putAgent(req, res, ns) {
    const body = await readJsonBody(req, MAX_BODY);
    checkKeys(body, ['name', 'email']);
    const name = requireText(body.name, 'name');
    const email = requireText(body.email, 'email', 254);
    if (!EMAIL.test(email)) throw new HttpError(400, 'invalid-request', 'email is not valid');
    const namespace = await requireNamespace(ns);

    const current = await readAgent(namespace);
    if (current && current.name === name && current.email === email) {
      return sendJson(res, 200, { ...current, changed: false }, ADMIN_HEADERS);
    }
    const agentId = namespace.agentRecordId ?? randomUUID();
    const { version, bytes } = buildAgentVersion({ name, email, parents: current ? [current.versionHash] : [] });
    const stored = await blobs.put(bytes);
    await store.insertVersion(
      ns, agentId, version, [stored],
      current ? undefined : defaultMetadata({ recordType: config.recordTypeAgent }),
    );
    if (!namespace.agentRecordId) await store.setAgentRecordId(ns, agentId);
    sendJson(res, current ? 200 : 201, {
      did: makeDid(ns, agentId), versionHash: version.versionHash, name, email, changed: true,
    }, ADMIN_HEADERS);
  }

  async function registerDevice(req, res, ns) {
    const body = await readJsonBody(req, MAX_BODY);
    checkKeys(body, ['label', 'publicKey']);
    const label = requireText(body.label, 'label');
    const jwk = { kty: 'OKP', crv: 'Ed25519', x: body.publicKey };
    if (!isEd25519PublicJwk(jwk)) throw new HttpError(400, 'invalid-key', 'publicKey must be a base64url Ed25519 key');
    const result = await store.createDevice({ namespace: ns, label, jwk, jkt: jwkThumbprint(jwk) });
    if (result === 'exists') throw new HttpError(409, 'device-exists');
    if (result === 'unknown-namespace') throw new HttpError(404, 'unknown-namespace');
    sendJson(res, 201, deviceJson(result), ADMIN_HEADERS);
  }

  async function revokeDevice(res, id) {
    const device = await store.revokeDevice(id);
    if (!device) throw new HttpError(404, 'unknown-device');
    sendJson(res, 200, deviceJson(device), ADMIN_HEADERS);
  }

  async function api(req, res, seg) {
    const method = req.method;
    const only = (...allowed) => {
      if (!allowed.includes(method)) throw new HttpError(405, 'method-not-allowed');
    };

    if (seg[0] === 'namespaces' && seg.length === 1) {
      only('GET', 'POST');
      return method === 'GET' ? listNamespaces(res) : createNamespace(req, res);
    }
    if (seg[0] === 'namespaces' && seg.length >= 2) {
      const ns = seg[1];
      if (!isUuidV4(ns)) throw new HttpError(400, 'invalid-namespace');
      if (seg.length === 2) {
        only('GET', 'PATCH');
        return method === 'GET' ? namespaceDetail(res, ns) : patchNamespace(req, res, ns);
      }
      if (seg.length === 3 && seg[2] === 'agent') {
        only('PUT');
        return putAgent(req, res, ns);
      }
      if (seg.length === 3 && seg[2] === 'devices') {
        only('POST');
        return registerDevice(req, res, ns);
      }
    }
    if (seg[0] === 'devices' && seg.length === 3 && seg[2] === 'revoke') {
      only('POST');
      const id = Number(seg[1]);
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'invalid-device');
      return revokeDevice(res, id);
    }
    throw new HttpError(404, 'not-found');
  }

  function sendAsset(res, body, type) {
    res.writeHead(200, {
      ...SECURITY_HEADERS, ...ADMIN_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  return async function handleAdmin(req, res) {
    if (!config.adminUser || !config.adminPasswordHash) throw new HttpError(404, 'not-found');
    authenticate(req);

    const { pathname } = new URL(req.url, 'http://localhost');
    const seg = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method;
    // CSRF protection for the browser session: changing requests need a header that other sites cannot send.
    if (method !== 'GET' && method !== 'HEAD' && req.headers['x-requested-with'] !== 'fetch') {
      throw new HttpError(403, 'forbidden', 'missing X-Requested-With header');
    }

    if (seg.length === 1) {
      if (method !== 'GET') throw new HttpError(405, 'method-not-allowed');
      if (pathname === '/admin') {
        res.writeHead(301, { ...SECURITY_HEADERS, Location: `${config.publicBaseUrl}/admin/` });
        return res.end();
      }
      return sendAsset(res, adminHtml, 'text/html; charset=utf-8');
    }
    if (seg.length === 2 && seg[1] === 'app.js') return sendAsset(res, adminJs, 'text/javascript; charset=utf-8');
    if (seg.length === 2 && seg[1] === 'app.css') return sendAsset(res, adminCss, 'text/css; charset=utf-8');
    if (seg[1] === 'api') return api(req, res, seg.slice(2));
    throw new HttpError(404, 'not-found');
  };
}