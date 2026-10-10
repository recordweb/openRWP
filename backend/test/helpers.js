import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import {
  computeContentHash, computeVersionHash, encodeBase64, createDpopProof, jwkThumbprint,
  publicJwkFromPrivateKeyPem, sha256Hex,
} from '../../core/index.js';
import { createApp } from '../app.js';
import { createBlobStore } from '../blobs.js';

export const NS = '4d3c45e8-1785-4f52-90f7-b9f5811935ad';
export const REC = '5264d2c3-d3b1-411c-829f-90e61165251a';
export const KEY = 'z6MkpdLK5QZdFDyZbnZGSUrKnRta68KEfoBwNbjS3fNmV9qc';
export const ACCESS_TOKEN = 'test-access-token';
export const PUBLIC = 'https://example.test/openrwp';

export const newKeyPem = () => generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });

// In-memory store with the same interface as store.js.
export class FakeStore {
  constructor() {
    this.namespaces = new Map([[NS, { namespace: NS, authorPublicKey: KEY, status: 'active' }]]);
    this.records = new Map();
    this.devices = new Map();
    this.tokens = new Map();
    this.jtis = new Set();
  }
  async ping() {}
  async getNamespace(ns) { return this.namespaces.get(ns) ?? null; }
  async getRecord(ns, rec) {
    const r = this.records.get(`${ns}/${rec}`);
    return r ? { createdAt: r.createdAt, updatedAt: r.updatedAt } : null;
  }
  async listVersionGraph(ns, rec) {
    const r = this.records.get(`${ns}/${rec}`);
    return r ? r.versions.map((v) => ({ versionHash: v.versionHash, parents: v.parents })) : [];
  }
  async listVersions(ns, rec) {
    return this.records.get(`${ns}/${rec}`)?.versions ?? [];
  }
  async getVersion(ns, rec, hash) {
    return this.records.get(`${ns}/${rec}`)?.versions.find((v) => v.versionHash === hash) ?? null;
  }
  async insertVersion(ns, rec, version, stored) {
    const key = `${ns}/${rec}`;
    if (!this.records.has(key)) {
      const now = new Date().toISOString();
      this.records.set(key, { createdAt: now, updatedAt: now, versions: [] });
    }
    const r = this.records.get(key);
    if (r.versions.some((v) => v.versionHash === version.versionHash)) return 'exists';
    r.versions.push({
      versionHash: version.versionHash, state: version.state, parents: version.parents,
      createdAtRaw: version.createdAt, modifiedAtRaw: version.modifiedAt, signature: version.signature ?? null,
      representations: version.representations.map((rep, i) => ({
        format: rep.format, role: rep.role ?? null, primary: rep.primary,
        contentHash: rep.contentHash, fileHash: stored[i].fileHash, size: stored[i].size,
      })),
    });
    r.updatedAt = new Date().toISOString();
    return 'created';
  }
  async currentVersion(ns, rec) {
    const r = this.records.get(`${ns}/${rec}`);
    if (!r) return null;
    const parents = new Set(r.versions.flatMap((v) => v.parents));
    const heads = r.versions.map((v, i) => ({ v, i })).filter(({ v }) => !parents.has(v.versionHash));
    heads.sort((a, b) => Date.parse(b.v.createdAtRaw) - Date.parse(a.v.createdAtRaw) || b.i - a.i);
    return heads[0]?.v.versionHash ?? null;
  }
  async getTokenDevice(tokenHash) {
    const t = this.tokens.get(tokenHash);
    if (!t || t.expiresAt <= Date.now()) return null;
    const d = this.devices.get(t.deviceId);
    if (!d) return null;
    return { ...d, namespaceStatus: this.namespaces.get(d.namespace)?.status ?? 'unknown' };
  }
  async recordDpopJti(jkt, jti) {
    const k = `${jkt}/${jti}`;
    if (this.jtis.has(k)) return false;
    this.jtis.add(k);
    return true;
  }
}

export function makeVersion({
  parents = [], content = 'hello', createdAt = '2026-10-10T13:00:00Z',
  format = 'text/plain', role = 'source',
} = {}) {
  const rep = { format, content: encodeBase64(Buffer.from(content)), primary: true };
  if (role !== undefined) rep.role = role;
  rep.contentHash = computeContentHash(rep);
  const version = { state: 'draft', parents, createdAt, modifiedAt: createdAt, representations: [rep] };
  version.versionHash = computeVersionHash(version);
  return version;
}

// Starts the app on a random port with one registered device (namespace NS) and a valid access token.
// request(path, opts): by default authenticates as that device with a fresh DPoP proof.
//   opts.token: undefined = valid token, null = no authentication, string = other token value
//   opts.key: PEM used to sign the proof; opts.proof: ready-made proof; opts.scheme: 'DPoP' or other
export async function startServer(overrides = {}) {
  const store = new FakeStore();
  const devicePem = newKeyPem();
  store.devices.set(1, {
    id: 1, jkt: jwkThumbprint(publicJwkFromPrivateKeyPem(devicePem)), namespace: NS, revokedAt: null,
  });
  store.tokens.set(sha256Hex(ACCESS_TOKEN), { deviceId: 1, expiresAt: Date.now() + 600_000 });

  const blobs = createBlobStore(await mkdtemp(join(tmpdir(), 'openrwp-')));
  const config = { publicBaseUrl: PUBLIC, maxBodyBytes: 1024 * 1024, ...overrides };
  const server = http.createServer(createApp({ store, blobs, config }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { method = 'GET', body, raw, token, key, proof, scheme = 'DPoP' } = {}) {
    const headers = {};
    const accessToken = token === undefined ? ACCESS_TOKEN : token;
    if (accessToken !== null) {
      headers.Authorization = `${scheme} ${accessToken}`;
      const dpop = proof ?? createDpopProof({
        privateKeyPem: key ?? devicePem, method, url: `${PUBLIC}${path}`, accessToken,
      });
      if (dpop !== '') headers.DPoP = dpop;
    }
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(base + path, {
      method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  }
  return { request, store, devicePem, close: () => new Promise((resolve) => server.close(resolve)) };
}

export const versionsPath = (ns = NS, rec = REC) => `/records/${ns}/${rec}/versions`;