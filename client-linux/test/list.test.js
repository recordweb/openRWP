import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../lib/config.js';
import { representationFor } from '../lib/documents.js';
import { formatList, listDocuments } from '../lib/list.js';
import { pathsIn } from '../lib/paths.js';
import { emptyState, saveState, setEntry } from '../lib/state.js';

const NS = '4d3c45e8-1785-4f52-90f7-b9f5811935ad';
const REC = '28b91a20-f7cd-456b-a290-5d7088fdba74';
const H = 'a'.repeat(64);

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'openrwp-list-'));
  const docsDir = join(root, 'docs');
  mkdirSync(join(docsDir, 'subfolder'), { recursive: true });
  const paths = pathsIn(join(root, 'home'));
  const config = validateConfig({ baseUrl: 'https://example.org/openrwp', namespace: NS, deviceLabel: 'T', docsDir });
  const hashOf = (name, text) => representationFor(name, Buffer.from(text)).contentHash;
  const state = emptyState();
  setEntry(state, 'synced.md', { recordId: REC, head: H, contentHash: hashOf('synced.md', 'one') });
  setEntry(state, 'modified.md', { recordId: REC, head: H, contentHash: hashOf('modified.md', 'old') });
  setEntry(state, 'missing.md', { recordId: REC, head: H, contentHash: H });
  saveState(paths.state, state);
  writeFileSync(join(docsDir, 'synced.md'), 'one');
  writeFileSync(join(docsDir, 'modified.md'), 'new');
  writeFileSync(join(docsDir, 'new.md'), 'three');
  writeFileSync(join(docsDir, '.~lock.new.md#'), 'lock');
  return { config, paths };
}

test('status of tracked and untracked documents; hidden files and folders are ignored', () => {
  const rows = listDocuments(setup());
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.name, r.status])), {
    'missing.md': 'missing',
    'modified.md': 'modified',
    'new.md': 'untracked',
    'synced.md': 'in-sync',
  });
});

test('formatList prints a table or a hint', () => {
  assert.equal(formatList([]), 'No documents.');
  const text = formatList(listDocuments(setup()));
  assert.match(text, /^NAME\s+STATUS\s+RECORD\s+HEAD/);
  assert.match(text, /synced\.md\s+in-sync\s+28b91a20\s+aaaaaaaa/);
});