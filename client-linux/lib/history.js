import { ClientError } from './errors.js';
import { getEntry, loadState } from './state.js';

// All versions (metadata) and heads of a pushed document, from the server.
export async function loadHistory({ config, paths, api, fileName }) {
  const entry = getEntry(loadState(paths.state), fileName);
  if (!entry) throw new ClientError('not-tracked', `${fileName} has not been pushed yet`);
  const { versions, heads } = await api.sync(config.namespace, entry.recordId, []);
  return { entry, versions, heads };
}