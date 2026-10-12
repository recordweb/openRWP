import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyState, findByRecord, getEntry, loadState, removeEntry, saveState, setEntry, validateFileName,
} from '../lib/state.js';

const REC = '28b91a20-f7cd-456b-a290-5d7088fdba74';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const file = () => join(mkdtempSync(join(tmpdir(), 'openrwp-')), 'sub', 'state.json');

test('missing state file gives an empty state', () => {
  assert.deepEqual(loadState(file()), emptyState());
});

test('set, save, load, get, find, remove', () => {
  const f = file();
  const state = emptyState();
  setEntry(state, 'bericht.odt', { recordId: REC, head: H1, contentHash: H2 });
  saveState(f, state);
  assert.equal(statSync(f).mode & 0o777, 0o600);

  const loaded = loadState(f);
  assert.deepEqual(getEntry(loaded, 'bericht.odt'), { recordId: REC, head: H1, contentHash: H2 });
  assert.equal(getEntry(loaded, 'other.odt'), undefined);
  assert.equal(findByRecord(loaded, REC), 'bericht.odt');
  assert.equal(removeEntry(loaded, 'bericht.odt'), true);
  assert.equal(removeEntry(loaded, 'bericht.odt'), false);
});

test('file names: flat and not hidden', () => {
  assert.equal(validateFileName('a b.odt'), 'a b.odt');
  for (const name of ['', 'dir/a.odt', '../a.odt', '.hidden', '.~lock.a.odt#', 'a\0b', 'x'.repeat(300), 42]) {
    assert.throws(() => validateFileName(name), { code: 'invalid-file-name' }, String(name));
  }
});

test('invalid entries are rejected', () => {
  const state = emptyState();
  for (const entry of [
    { recordId: 'x', head: null, contentHash: null },
    { recordId: REC, head: 'short', contentHash: null },
    { recordId: REC, head: null, contentHash: 'short' },
    null,
  ]) {
    assert.throws(() => setEntry(state, 'a.odt', entry), { code: 'invalid-state' });
  }
});

test('unknown state format and corrupt JSON are reported', () => {
  const f = file();
  saveState(f, emptyState());
  writeFileSync(f, JSON.stringify({ version: 2, files: {} }));
  assert.throws(() => loadState(f), { code: 'invalid-state' });
  writeFileSync(f, 'oops');
  assert.throws(() => loadState(f), { code: 'corrupt-file' });
});

test('names like __proto__ cannot pollute the state', () => {
  const state = emptyState();
  assert.equal(getEntry(state, 'constructor'), undefined);
});