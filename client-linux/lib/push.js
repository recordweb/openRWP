import { randomUUID } from 'node:crypto';
import { ApiError } from './api.js';
import { buildVersion, readDocument, representationFor } from './documents.js';
import { ClientError } from './errors.js';
import { getEntry, loadState, saveState, setEntry } from './state.js';

// Pushes the current content of one document as a new version (demo: one head only, no branches).
export async function pushFile({ config, paths, api, fileName, now = () => new Date() }) {
  const bytes = readDocument(config.docsDir, fileName);
  const representation = representationFor(fileName, bytes);
  const { contentHash } = representation;
  const state = loadState(paths.state);
  const entry = getEntry(state, fileName);

  if (entry && entry.head !== null && entry.contentHash === contentHash) {
    return { status: 'unchanged', fileName, recordId: entry.recordId, versionHash: entry.head };
  }

  let recordId;
  let parents = [];
  if (entry) {
    recordId = entry.recordId;
    if (entry.head !== null) {
      parents = [entry.head];
      let remote;
      try {
        remote = await api.sync(config.namespace, recordId, [entry.head]);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          throw new ClientError('record-missing', `the server does not know record ${recordId}; to push ${fileName} as a new record, remove its entry from ${paths.state}`);
        }
        throw err;
      }
      if (remote.heads.length !== 1) {
        throw new ClientError('multiple-heads', `the record has ${remote.heads.length} heads on the server; the demo supports one head only`);
      }
      if (remote.heads[0].versionHash !== entry.head) {
        throw new ClientError('head-changed', 'the server has a newer version than the local one; run "openrwp pull" first');
      }
    }
  } else {
    recordId = randomUUID();
  }

  const version = buildVersion({ representation, parents, now: now() });
  const result = await api.appendVersion(config.namespace, recordId, version);
  if (result.versionHash !== version.versionHash) {
    throw new ClientError('unexpected-answer', 'the versionHash of the server differs from the local one');
  }
  setEntry(state, fileName, { recordId, head: version.versionHash, contentHash });
  saveState(paths.state, state);
  return {
    status: result.created ? 'created' : 'identical',
    fileName,
    recordId,
    did: result.did,
    versionHash: version.versionHash,
    parents,
    newRecord: !entry,
  };
}

export function formatPush(r) {
  if (r.status === 'unchanged') return `${r.fileName}: unchanged (version ${r.versionHash})`;
  const what = r.newRecord ? 'new record' : r.status === 'identical' ? 'version already present' : 'new version';
  return [
    `${r.fileName}: ${what}`,
    `  record:  ${r.did}`,
    `  version: ${r.versionHash}`,
    ...(r.parents.length > 0 ? [`  parent:  ${r.parents[0]}`] : []),
  ].join('\n');
}