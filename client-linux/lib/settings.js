import { ClientError } from './errors.js';
import { getEntry, loadState } from './state.js';

export const DEFAULT_LINK_DAYS = 7;
export const MAX_LINK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// PUT /settings accepts only these fields, so an entry read from the server is reduced to them.
const KNOWN_FIELDS = ['id', 'agent', 'modes', 'scope', 'expires'];
const pick = (entry) => Object.fromEntries(
  KNOWN_FIELDS.filter((k) => entry[k] !== undefined).map((k) => [k, entry[k]]),
);
const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

function trackedEntry(paths, fileName) {
  const entry = getEntry(loadState(paths.state), fileName);
  if (!entry) throw new ClientError('not-tracked', `${fileName} has not been pushed yet`);
  return entry;
}

async function currentAccess({ config, api }, entry) {
  const settings = await api.getSettings(config.namespace, entry.recordId);
  return (settings?.access ?? []).map(pick);
}

async function replaceAccess({ config, api }, entry, access) {
  const result = await api.putSettings(config.namespace, entry.recordId, { access });
  return result?.access ?? [];
}

// Existing links without their secret.
export async function listLinks({ config, paths, api, fileName }) {
  const entry = trackedEntry(paths, fileName);
  return { links: await currentAccess({ config, api }, entry) };
}

// Creates one read link. PUT replaces the whole list, so the existing links are sent along with their ids.
// The URL is returned once by the server; it is neither stored nor logged here.
export async function createLink({ config, paths, api, fileName, days = DEFAULT_LINK_DAYS, now = () => new Date() }) {
  if (!Number.isInteger(days) || days < 1 || days > MAX_LINK_DAYS) {
    throw new ClientError('invalid-argument', `days must be a whole number from 1 to ${MAX_LINK_DAYS}`);
  }
  const entry = trackedEntry(paths, fileName);
  const existing = await currentAccess({ config, api }, entry);
  const expires = isoSeconds(new Date(now().getTime() + days * DAY_MS));
  const result = await replaceAccess({ config, api }, entry, [
    ...existing,
    { agent: 'link', modes: ['read'], scope: 'record', expires },
  ]);
  const created = result.filter((e) => typeof e.url === 'string');
  if (created.length !== 1) throw new ClientError('unexpected-answer', 'the server did not return exactly one new link');
  const [{ id, url }] = created;
  return {
    id,
    url,
    expires: created[0].expires ?? expires,
    version: entry.head ?? undefined,
    fileUrl: entry.head ? `${url.replace(/\/+$/, '')}/versions/${entry.head}/content` : undefined,
  };
}

// Revokes the link whose id starts with idPrefix (at least 4 characters), or all links.
export async function revokeLinks({ config, paths, api, fileName, idPrefix, all = false }) {
  if (!all && (typeof idPrefix !== 'string' || idPrefix.length < 4)) {
    throw new ClientError('invalid-argument', 'give at least 4 characters of the link id');
  }
  const entry = trackedEntry(paths, fileName);
  const existing = await currentAccess({ config, api }, entry);
  const matches = all ? existing : existing.filter((l) => l.id.startsWith(idPrefix));
  if (matches.length === 0) {
    throw new ClientError('link-not-found', all ? 'there are no links' : `no link with an id starting with ${idPrefix}`);
  }
  if (!all && matches.length > 1) throw new ClientError('ambiguous-link', 'more than one link matches; give more characters');
  const revoked = new Set(matches.map((l) => l.id));
  await replaceAccess({ config, api }, entry, existing.filter((l) => !revoked.has(l.id)));
  return { revoked: [...revoked] };
}

export function formatLinks(links, now = new Date()) {
  if (links.length === 0) return 'No capability links.';
  const lines = ['ID        MODE  SCOPE   EXPIRES'];
  for (const l of links) {
    const expired = l.expires && Date.parse(l.expires) < now.getTime() ? '  (expired)' : '';
    lines.push(`${l.id.slice(0, 8)}  ${(l.modes ?? []).join(',').padEnd(4)}  ${(l.scope ?? 'record').padEnd(6)}  ${l.expires ?? '-'}${expired}`);
  }
  return lines.join('\n');
}

export function formatCreated(r, fileName) {
  return [
    `${fileName}: capability link created (read-only, expires ${r.expires}).`,
    'The link is shown only once and is not stored. Treat it like a password.',
    `  id:    ${r.id.slice(0, 8)}`,
    `  link:  ${r.url}`,
    ...(r.fileUrl ? [`  file:  ${r.fileUrl}  (version ${r.version.slice(0, 8)})`] : []),
    `Revoke with: openrwp settings ${fileName} --revoke ${r.id.slice(0, 8)}`,
  ].join('\n');
}