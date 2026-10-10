import { randomBytes, randomUUID } from 'node:crypto';
import { sha256Hex, makeDid } from '../core/index.js';
import { HttpError, sendJson, readJsonBody } from './http.js';

// Settings (Binding 6.6) and capability URLs. Version 1 supports links with
// agent "link", modes ["read"] and scope "record" only.

const DEFAULT_LINK_DAYS = 7;
const MAX_LINK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ENTRY_KEYS = new Set(['id', 'agent', 'modes', 'scope', 'expires']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createLinks({ store, reader, config }) {
  const recordUrl = (ns, rec) => `${config.publicBaseUrl}/records/${ns}/${rec}`;
  const linkUrl = (token) => `${config.publicBaseUrl}/c/${token}`;
  const settingsLinkHeader = (ns, rec) => ({ Link: `<${recordUrl(ns, rec)}/settings>; rel="settings"` });

  async function requireRecord(ns, rec) {
    if (!(await store.getRecord(ns, rec))) throw new HttpError(404, 'not-found');
  }

  async function settingsDocument(ns, rec) {
    const links = await store.listLinks(ns, rec);
    return {
      access: links.map((l) => ({
        id: l.id, agent: 'link', modes: ['read'], scope: 'record', expires: l.expiresAt.toISOString(),
      })),
      views: [],
    };
  }

  function parseExpiry(value, now) {
    if (typeof value !== 'string' || !ISO_8601.test(value) || Number.isNaN(Date.parse(value))) {
      throw new HttpError(422, 'invalid-expiry', 'expires must be an ISO 8601 timestamp');
    }
    const at = Date.parse(value);
    if (at <= now) throw new HttpError(422, 'invalid-expiry', 'expires must be in the future');
    if (at > now + MAX_LINK_DAYS * DAY_MS) {
      throw new HttpError(422, 'invalid-expiry', `expires must be within ${MAX_LINK_DAYS} days`);
    }
    return new Date(at);
  }

  function checkEntry(entry) {
    if (!isObject(entry)) throw new HttpError(400, 'invalid-request', 'access entries must be objects');
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) throw new HttpError(400, 'unknown-field', key);
    }
    if (entry.agent !== 'link') throw new HttpError(422, 'agent-not-supported', 'only agent "link" is supported');
    if (!Array.isArray(entry.modes)) throw new HttpError(400, 'invalid-request', 'modes must be an array');
    if (entry.modes.length !== 1 || entry.modes[0] !== 'read') {
      throw new HttpError(422, 'mode-not-supported', 'only modes ["read"] are supported');
    }
    if (entry.scope !== undefined && entry.scope !== 'record') {
      throw new HttpError(422, 'scope-not-supported', 'only scope "record" is supported');
    }
  }

  return {
    async getSettings(res, ns, rec) {
      await requireRecord(ns, rec);
      sendJson(res, 200, await settingsDocument(ns, rec), { 'Cache-Control': 'no-store', ...settingsLinkHeader(ns, rec) });
    },

    // PUT replaces the list of links: entries without id are created (the URL is returned once),
    // entries with a known id are kept (expiry may change), links missing from the list are revoked.
    async putSettings(req, res, ns, rec) {
      if (!config.publicBaseUrl.startsWith('https://')) {
        throw new HttpError(500, 'configuration-error', 'PUBLIC_BASE_URL must use https for capability URLs');
      }
      const body = await readJsonBody(req, config.maxBodyBytes);
      if (!isObject(body) || !Array.isArray(body.access)) {
        throw new HttpError(400, 'invalid-request', 'access must be an array');
      }
      for (const key of Object.keys(body)) {
        if (key !== 'access' && key !== 'views') throw new HttpError(400, 'unknown-field', key);
      }
      if (body.views !== undefined && !(Array.isArray(body.views) && body.views.length === 0)) {
        throw new HttpError(422, 'views-not-supported', 'views are not supported in this version');
      }
      await requireRecord(ns, rec);

      const existing = await store.listLinks(ns, rec);
      const byId = new Map(existing.map((l) => [l.id, l]));
      const now = Date.now();
      const kept = new Set();
      const create = [];
      const update = [];

      for (const entry of body.access) {
        checkEntry(entry);
        if (entry.id !== undefined) {
          const current = byId.get(entry.id);
          if (!current) throw new HttpError(404, 'unknown-link', '', { id: entry.id });
          if (kept.has(entry.id)) throw new HttpError(400, 'invalid-request', 'duplicate id');
          kept.add(entry.id);
          if (entry.expires !== undefined) update.push({ id: entry.id, expiresAt: parseExpiry(entry.expires, now) });
        } else {
          const expiresAt = entry.expires === undefined
            ? new Date(now + DEFAULT_LINK_DAYS * DAY_MS)
            : parseExpiry(entry.expires, now);
          create.push({ linkId: randomUUID(), token: randomBytes(32).toString('base64url'), expiresAt });
        }
      }
      const revoke = existing.filter((l) => !kept.has(l.id)).map((l) => l.id);

      await store.applyLinkChanges(ns, rec, {
        create: create.map((c) => ({ linkId: c.linkId, tokenHash: sha256Hex(c.token), expiresAt: c.expiresAt })),
        update,
        revoke,
      });

      const urls = new Map(create.map((c) => [c.linkId, linkUrl(c.token)]));
      const settings = await settingsDocument(ns, rec);
      settings.access = settings.access.map((a) => (urls.has(a.id) ? { ...a, url: urls.get(a.id) } : a));
      sendJson(res, 200, settings, { 'Cache-Control': 'no-store', ...settingsLinkHeader(ns, rec) });
    },

    // GET /c/<token>[/versions/<hash>[/content]]. Every kind of invalid link answers 404.
    async handleCapability(req, res, seg) {
      if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed');
      const [, token, ...rest] = seg;
      const link = TOKEN_FORMAT.test(token) ? await store.getLinkByTokenHash(sha256Hex(token)) : null;
      const valid = link && !link.revokedAt && link.expiresAt.getTime() > Date.now()
        && link.namespaceStatus === 'active' && link.modes.includes('read');
      if (!valid) throw new HttpError(404, 'not-found');
      const { namespace: ns, recordId: rec } = link;

      if (rest.length === 0) {
        const sync = await reader.syncDocument(ns, rec, []);
        return sendJson(res, 200, { did: makeDid(ns, rec), ...sync }, { 'Cache-Control': 'no-store' });
      }
      if (rest[0] === 'versions' && rest.length === 2) return reader.sendVersion(res, ns, rec, rest[1]);
      if (rest[0] === 'versions' && rest.length === 3 && rest[2] === 'content') {
        return reader.sendContent(res, ns, rec, rest[1]);
      }
      throw new HttpError(404, 'not-found');
    },

    settingsLinkHeader,
  };
}