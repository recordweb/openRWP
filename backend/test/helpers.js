import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { computeContentHash, computeVersionHash, encodeBase64 } from '../../core/index.js';
import { createApp } from '../app.js';
import { createBlobStore } from '../blobs.js';

export const NS = '4d3c45e8-1785-4f52-90f7-b9f5811935ad';
export const REC = '5264d2c3-d3b1-411c-829f-90e61165251a';
export const KEY = 'z6MkpdLK5QZdFDyZbnZGSUrKnRta68KEfoBwNbjS3fNmV9qc';
export const TOKEN = 'test-token';

// In-memory store with the same interface as store.js.
export class FakeStore {
  constructor() {
    this.namespaces = new Map([[NS, { namespace: NS, authorPublicKey: KEY, status: 'active' }]]);
    this.records = new Map();
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
      versionHash: version.versionHash,
      state: version.state,
      parents: version.parents,
      createdAtRaw: version.createdAt,
      modifiedAtRaw: version.modifiedAt,
      signature: version.signature ?? null,
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

export async function startServer(overrides = {}) {
  const store = new FakeStore();
  const blobs = createBlobStore(await mkdtemp(join(tmpdir(), 'openrwp-')));
  const config = {
    publicBaseUrl: 'https://example.test/openrwp',
    devToken: TOKEN,
    maxBodyBytes: 1024 * 1024,
    ...overrides,
  };
  const server = http.createServer(createApp({ store, blobs, config }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { method = 'GET', body, token = TOKEN, raw } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, {
      method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    return res;
  }
  return { request, store, close: () => new Promise((resolve) => server.close(resolve)) };
}

export const versionsPath = (ns = NS, rec = REC) => `/records/${ns}/${rec}/versions`;