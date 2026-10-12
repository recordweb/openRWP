import { readdirSync } from 'node:fs';
import { readDocument, representationFor } from './documents.js';
import { getEntry, loadState } from './state.js';

// Local view, no network. Status: untracked (never pushed), in-sync, modified (changed since the last push), missing.
export function listDocuments({ config, paths }) {
  const state = loadState(paths.state);
  const names = new Set(Object.keys(state.files));
  let entries = [];
  try {
    entries = readdirSync(config.docsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const e of entries) if (e.isFile() && !e.name.startsWith('.')) names.add(e.name);

  return [...names].sort().map((name) => {
    const entry = getEntry(state, name);
    let bytes;
    try {
      bytes = readDocument(config.docsDir, name);
    } catch (err) {
      if (err.code !== 'file-not-found' && err.code !== 'not-a-file') throw err;
    }
    let status = 'untracked';
    if (entry) {
      if (bytes === undefined) status = 'missing';
      else status = representationFor(name, bytes).contentHash === entry.contentHash ? 'in-sync' : 'modified';
    }
    return { name, status, recordId: entry?.recordId, head: entry?.head ?? undefined };
  });
}

export function formatList(rows) {
  if (rows.length === 0) return 'No documents.';
  const short = (s) => (s ? s.slice(0, 8) : '-');
  const width = Math.max(4, ...rows.map((r) => r.name.length));
  const line = (a, b, c, d) => `${a.padEnd(width)}  ${b.padEnd(10)}  ${c.padEnd(8)}  ${d}`;
  return [
    line('NAME', 'STATUS', 'RECORD', 'HEAD'),
    ...rows.map((r) => line(r.name, r.status, short(r.recordId), short(r.head))),
  ].join('\n');
}