import { statSync } from 'node:fs';
import { join } from 'node:path';
import { validateVersion } from '../../core/index.js';
import { readDocument, representationFor } from './documents.js';
import { ClientError } from './errors.js';
import { writeFileAtomic } from './fsutil.js';
import { getEntry, loadState, saveState, setEntry, validateFileName } from './state.js';

// Accepts a full versionHash or a unique prefix of at least 8 characters (as printed by "graph").
export function resolveVersion(versions, arg) {
  if (typeof arg !== 'string' || !/^[0-9a-f]{8,64}$/.test(arg)) {
    throw new ClientError('invalid-argument', 'give at least 8 hex characters of a versionHash');
  }
  const matches = versions.filter((v) => v.versionHash.startsWith(arg));
  if (matches.length === 0) throw new ClientError('version-not-found', `no version starting with ${arg}`);
  if (matches.length > 1) throw new ClientError('ambiguous-version', 'more than one version matches; give more characters');
  return matches[0];
}

// Writes a version of a pushed document into the folder.
// Without `version`: the single head. The base for the next push is always the head of the server:
// after restoring an older version the file counts as modified, and "push" adds a new version on the head.
export async function pullFile({ config, paths, api, fileName, version: versionArg, force = false }) {
  validateFileName(fileName);
  const state = loadState(paths.state);
  const entry = getEntry(state, fileName);
  if (!entry) throw new ClientError('not-tracked', `${fileName} has not been pushed yet`);

  const file = join(config.docsDir, fileName);
  let local;
  try {
    local = readDocument(config.docsDir, fileName);
  } catch (err) {
    if (err.code !== 'file-not-found') throw err;
  }
  const modified = local !== undefined && representationFor(fileName, local).contentHash !== entry.contentHash;
  if (modified && !force) {
    throw new ClientError(
      'local-changes',
      `${fileName} has changes that are not pushed; push it, or use --force to overwrite them (copy the file first to keep them)`,
    );
  }

  const { versions, heads } = await api.sync(config.namespace, entry.recordId, []);
  const onlyHead = heads.length === 1 ? heads[0].versionHash : undefined;
  let target;
  if (versionArg === undefined) {
    if (onlyHead === undefined) {
      throw new ClientError('multiple-heads', `the record has ${heads.length} heads; choose one with --version <hash> (see "openrwp graph ${fileName}")`);
    }
    target = onlyHead;
    if (local !== undefined && !modified && target === entry.head) return { status: 'up-to-date', fileName, versionHash: target };
  } else {
    target = resolveVersion(versions, versionArg).versionHash;
  }

  const version = await api.getVersion(config.namespace, entry.recordId, target);
  let contents;
  try {
    contents = validateVersion(version);
  } catch (err) {
    throw new ClientError('invalid-server-data', err.message);
  }
  if (version.versionHash !== target) throw new ClientError('unexpected-answer', 'the server returned a different version');
  const bytes = contents[version.representations.findIndex((r) => r.primary)];

  const mode = local === undefined ? 0o644 : statSync(file).mode & 0o777;
  writeFileAtomic(file, bytes, mode);

  if (target === onlyHead) {
    setEntry(state, fileName, { recordId: entry.recordId, head: target, contentHash: representationFor(fileName, bytes).contentHash });
  } else if (onlyHead !== undefined) {
    const head = versions.find((v) => v.versionHash === onlyHead);
    setEntry(state, fileName, {
      recordId: entry.recordId,
      head: onlyHead,
      contentHash: head.representations.find((r) => r.primary).contentHash,
    });
  }
  saveState(paths.state, state);

  let status = 'updated';
  if (local === undefined) status = 'created';
  else if (target !== onlyHead) status = 'restored';
  return { status, fileName, versionHash: target };
}

export function formatPull(r) {
  switch (r.status) {
    case 'up-to-date': return `${r.fileName}: up to date (version ${r.versionHash})`;
    case 'created': return `${r.fileName}: written from version ${r.versionHash}`;
    case 'restored': return `${r.fileName}: restored version ${r.versionHash} from the history; the file now counts as modified`;
    default: return `${r.fileName}: updated to version ${r.versionHash}`;
  }
}