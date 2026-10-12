import { createDpopProof, isHash, isUuidV4 } from '../../core/index.js';
import { ClientError } from './errors.js';

const TOKEN_MARGIN_MS = 30_000;
const DEFAULT_EXPIRES_IN = 600;

// Error for a non-2xx answer of the custodian. `code` is the server's error code (e.g. "unknown-parent").
export class ApiError extends ClientError {
  constructor(status, body) {
    const detail = typeof body?.detail === 'string' ? body.detail : body?.error_description;
    super(typeof body?.error === 'string' ? body.error : `http-${status}`, detail);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const badArg = (what) => new ClientError('invalid-argument', what);

function recordPath(namespace, recordId) {
  if (!isUuidV4(namespace)) throw badArg('namespace must be a UUIDv4');
  if (!isUuidV4(recordId)) throw badArg('record id must be a UUIDv4');
  return `/records/${namespace}/${recordId}`;
}

function hashArg(hash, what = 'versionHash') {
  if (!isHash(hash)) throw badArg(`${what} must be a 64-character hex hash`);
  return hash;
}

async function readBody(res, as) {
  if (as === 'buffer' && res.ok) return Buffer.from(await res.arrayBuffer());
  const text = await res.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Client for the custodian API (Binding 6). One instance per device key.
export class ApiClient {
  #baseUrl;
  #key;
  #fetch;
  #now;
  #timeoutMs;
  #token;

  constructor({ baseUrl, privateKeyPem, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 30_000 }) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#key = privateKeyPem;
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#timeoutMs = timeoutMs;
  }

  async #send(method, url, headers, body) {
    try {
      return await this.#fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (err) {
      throw new ClientError('network', `${method} ${new URL(url).pathname}: ${err.cause?.code ?? err.message}`);
    }
  }

  async #fetchToken() {
    const url = `${this.#baseUrl}/token`;
    const proof = createDpopProof({ privateKeyPem: this.#key, method: 'POST', url });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: proof };
    const res = await this.#send('POST', url, headers, 'grant_type=client_credentials');
    const body = await readBody(res, 'json');
    if (res.status === 401) {
      throw new ClientError('device-not-registered', 'unknown or revoked device key, or the namespace is suspended');
    }
    if (!res.ok) throw new ApiError(res.status, body);
    if (typeof body?.access_token !== 'string' || body.token_type !== 'DPoP') {
      throw new ClientError('invalid-token-response');
    }
    const ttl = Number.isFinite(body.expires_in) ? body.expires_in : DEFAULT_EXPIRES_IN;
    this.#token = { value: body.access_token, expiresAt: this.#now() + ttl * 1000 };
  }

  async #accessToken() {
    if (!this.#token || this.#now() >= this.#token.expiresAt - TOKEN_MARGIN_MS) await this.#fetchToken();
    return this.#token.value;
  }

  // Sends one authenticated request. Returns { status, body }; non-2xx answers throw ApiError.
  // A 401 triggers one retry with a new token. Every attempt uses a fresh DPoP proof.
  async request(method, path, { json, as = 'json' } = {}) {
    const url = `${this.#baseUrl}${path}`;
    const payload = json === undefined ? undefined : JSON.stringify(json);
    for (let attempt = 0; ; attempt += 1) {
      const token = await this.#accessToken();
      const headers = {
        Authorization: `DPoP ${token}`,
        DPoP: createDpopProof({ privateKeyPem: this.#key, method, url, accessToken: token }),
      };
      if (payload !== undefined) headers['Content-Type'] = 'application/json';
      const res = await this.#send(method, url, headers, payload);
      if (res.status === 401 && attempt === 0) {
        this.#token = undefined;
        await res.arrayBuffer().catch(() => {});
        continue;
      }
      const body = await readBody(res, as);
      if (!res.ok) throw new ApiError(res.status, body);
      return { status: res.status, body };
    }
  }

  // POST .../versions. `created` is true for 201 (new) and false for 200 (identical version already present).
  async appendVersion(namespace, recordId, version) {
    const path = `${recordPath(namespace, recordId)}/versions`;
    const { status, body } = await this.request('POST', path, { json: version });
    return { created: status === 201, ...body };
  }

  // POST .../sync. Returns { versions, heads }.
  async sync(namespace, recordId, have) {
    const path = `${recordPath(namespace, recordId)}/sync`;
    if (!Array.isArray(have)) throw badArg('have must be an array');
    have.forEach((h) => hashArg(h, 'have entry'));
    return (await this.request('POST', path, { json: { have } })).body;
  }

  async getVersion(namespace, recordId, versionHash) {
    const path = `${recordPath(namespace, recordId)}/versions/${hashArg(versionHash)}`;
    return (await this.request('GET', path)).body;
  }

  // Raw file of the primary representation, as Buffer.
  async getContent(namespace, recordId, versionHash) {
    const path = `${recordPath(namespace, recordId)}/versions/${hashArg(versionHash)}/content`;
    return (await this.request('GET', path, { as: 'buffer' })).body;
  }

  async getRecord(namespace, recordId) {
    return (await this.request('GET', recordPath(namespace, recordId))).body;
  }

  async getSettings(namespace, recordId) {
    return (await this.request('GET', `${recordPath(namespace, recordId)}/settings`)).body;
  }

  async putSettings(namespace, recordId, settings) {
    return (await this.request('PUT', `${recordPath(namespace, recordId)}/settings`, { json: settings })).body;
  }
}